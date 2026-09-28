import { describe, expect, it } from 'vitest';
import { ARTIFACTS } from './artifacts';
import { DEFAULT_CONFIG } from './config';
import {
  campRest,
  campUpgrade,
  chooseArtifact,
  chooseInsert,
  installInsert,
  newRun,
  pickStarter,
  rerollInserts,
  runAction,
  runEndTurn,
  startNextBattle,
  type RunResult,
  type RunState,
} from './run';
import { boardWith } from './test-utils';

const ok = (r: RunResult): RunState => {
  if (!r.ok) throw new Error(r.reason);
  return r.run;
};

/** 把当前战斗的敌人打到 1 血，再点燃一枚炸弹结束战斗 */
function winBattle(run: RunState): RunState {
  const r = JSON.parse(JSON.stringify(run)) as RunState;
  r.battle!.enemy.hp = 1;
  r.battle!.enemy.shield = 0;
  r.battle!.board = boardWith({ '4,0': 'H', '4,1': 'a' });
  return ok(runAction(r, { type: 'ignite', at: { r: 4, c: 0 } }));
}

function toFirstBattle(seed = 1): RunState {
  const run = newRun(seed);
  return ok(startNextBattle(ok(pickStarter(run, run.starterChoices[0]!))));
}

describe('开局', () => {
  it('从开局池给出 3 件不同的神器；同种子相同', () => {
    const run = newRun(5);
    expect(run.starterChoices).toHaveLength(3);
    expect(new Set(run.starterChoices).size).toBe(3);
    expect(run.starterChoices.every((k) => ARTIFACTS[k].starter)).toBe(true);
    expect(newRun(5).starterChoices).toEqual(run.starterChoices);
  });

  it('选神器后进入路线页，再开始第一战', () => {
    const run = toFirstBattle();
    expect(run.phase).toBe('battle');
    expect(run.battleIndex).toBe(1);
    expect(run.battle!.enemy.def.name).toBe('晶背鼹鼠');
    expect(run.battle!.artifacts).toEqual(run.artifacts);
  });
});

describe('战后流程', () => {
  it('小怪胜利：发 8 金币、嵌片三选一，选完进营地；小怪不给神器', () => {
    const won = winBattle(toFirstBattle());
    expect(won.phase).toBe('reward');
    expect(won.gold).toBe(DEFAULT_CONFIG.goldMinion);
    expect(won.reward!.choices).toHaveLength(3);
    const camp = ok(chooseInsert(won, 0));
    expect(camp.phase).toBe('camp');
    expect(camp.inventory).toHaveLength(1);
    expect(camp.inventory[0]!.shape).toHaveLength(4);
  });

  it('战后保留生命、护盾与催化剂充能', () => {
    const b = toFirstBattle();
    b.battle!.player = { hp: 31, maxHp: 40, shield: 7, catalystCharges: 2 };
    const won = winBattle(b);
    expect(won.player.hp).toBe(31);
    expect(won.player.catalystCharges).toBeGreaterThanOrEqual(0);
    expect(won.player.shield).toBeGreaterThanOrEqual(7);
  });

  it('重掷：扣 8 金币、候选变化；金币不足时不能重掷', () => {
    const won = winBattle(toFirstBattle());
    const rerolled = ok(rerollInserts(won));
    expect(rerolled.gold).toBe(0);
    expect(rerolled.reward!.choices).not.toEqual(won.reward!.choices);
    expect(rerollInserts(rerolled).ok).toBe(false);
  });

  it('没有拾荒眼镜时不能保留候选', () => {
    const won = winBattle(toFirstBattle());
    expect(rerollInserts(won, 0).ok).toBe(false);
  });

  it('失败时本局结束', () => {
    const run = toFirstBattle();
    run.battle!.player.hp = 1;
    run.battle!.player.shield = 0;
    const lost = ok(runEndTurn(run));
    expect(lost.phase).toBe('over');
    expect(lost.outcome).toBe('lost');
  });
});

describe('营地', () => {
  const toCamp = () => ok(chooseInsert(winBattle(toFirstBattle()), 0));

  it('休息回复生命，然后回到路线页', () => {
    const camp = toCamp();
    camp.player.hp = 20;
    const after = ok(campRest(camp));
    expect(after.player.hp).toBe(30);
    expect(after.phase).toBe('map');
  });

  it('升级：金币不足时不能升级', () => {
    const camp = toCamp();
    expect(campUpgrade(camp, camp.inventory[0]!.id, [{ r: -1, c: 0 }]).ok).toBe(false);
  });

  it('升级随身匣嵌片：增加一个正交相邻格，扣 15 金币', () => {
    const camp = toCamp();
    camp.gold = 20;
    const item = camp.inventory[0]!;
    const cell = { r: item.shape[0]!.r - 1, c: item.shape[0]!.c };
    const after = ok(campUpgrade(camp, item.id, [cell]));
    expect(after.inventory[0]!.shape).toHaveLength(5);
    expect(after.gold).toBe(5);
    expect(campUpgrade(camp, item.id, [{ r: 9, c: 9 }]).ok).toBe(false);
  });

  it('精工刻刀：一次升级可加两格，坐标都相对于升级前的形状', () => {
    const camp = toCamp();
    camp.gold = 20;
    camp.artifacts.push('fineChisel');
    camp.inventory[0]!.shape = [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }, { r: 0, c: 3 }];
    const after = ok(campUpgrade(camp, camp.inventory[0]!.id, [{ r: -1, c: 0 }, { r: -2, c: 0 }]));
    expect(after.inventory[0]!.shape).toHaveLength(6);
  });

  it('升级已安装嵌片：原位扩张，不能越界或重叠', () => {
    const camp = toCamp();
    camp.gold = 40;
    const id = camp.inventory[0]!.id;
    camp.inventory[0]!.shape = [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }, { r: 0, c: 3 }];
    const placed = ok(installInsert(camp, id, [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }, { r: 0, c: 3 }]));
    expect(campUpgrade(placed, id, [{ r: -1, c: 0 }]).ok).toBe(false);
    const up = ok(campUpgrade(placed, id, [{ r: 1, c: 0 }]));
    expect(up.installed[0]!.cells).toHaveLength(5);
  });
});

describe('嵌入棋盘', () => {
  const withInventory = () => ok(chooseInsert(winBattle(toFirstBattle()), 0));

  it('非战斗阶段可以旋转嵌入，嵌入后从随身匣移到棋盘', () => {
    const camp = withInventory();
    const item = camp.inventory[0]!;
    item.shape = [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }, { r: 0, c: 3 }];
    const vertical = [0, 1, 2, 3].map((r) => ({ r, c: 5 }));
    const placed = ok(installInsert(camp, item.id, vertical));
    expect(placed.inventory).toHaveLength(0);
    expect(placed.installed[0]!.cells).toEqual(vertical);
  });

  it('形状不符、越界或战斗中都不能嵌入', () => {
    const camp = withInventory();
    const item = camp.inventory[0]!;
    item.shape = [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }, { r: 0, c: 3 }];
    expect(installInsert(camp, item.id, [{ r: 0, c: 0 }, { r: 1, c: 0 }, { r: 1, c: 1 }, { r: 0, c: 1 }]).ok).toBe(false);
    expect(installInsert(camp, item.id, [0, 1, 2, 3].map((c) => ({ r: 0, c: c + 6 }))).ok).toBe(false);
    const battle = toFirstBattle();
    battle.inventory.push({ ...item });
    expect(installInsert(battle, item.id, [0, 1, 2, 3].map((c) => ({ r: 0, c }))).ok).toBe(false);
  });

  it('已嵌入的嵌片带进下一场战斗', () => {
    const camp = withInventory();
    const item = camp.inventory[0]!;
    item.shape = [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }, { r: 0, c: 3 }];
    const placed = ok(installInsert(camp, item.id, [0, 1, 2, 3].map((c) => ({ r: 2, c }))));
    const next = ok(startNextBattle(ok(campRest(placed))));
    expect(next.battleIndex).toBe(2);
    expect(next.battle!.inserts.map((i) => i.id)).toEqual([item.id]);
  });
});

describe('完整段落', () => {
  it('三战走完：精英战后多一次神器三选一，最后营地后段落胜利；可 JSON 往返存档', () => {
    let run = newRun(9);
    run = ok(pickStarter(run, run.starterChoices[0]!));
    for (let i = 1; i <= 3; i++) {
      run = ok(startNextBattle(run));
      run = winBattle(run);
      expect(run.phase).toBe('reward');
      run = ok(chooseInsert(run, 0));
      if (i === 3) {
        expect(run.phase).toBe('artifact');
        expect(run.artifactChoices.some((k) => run.artifacts.includes(k))).toBe(false);
        run = ok(chooseArtifact(run, run.artifactChoices[0]!));
      }
      run = ok(campRest(run));
      run = JSON.parse(JSON.stringify(run)) as RunState;
    }
    expect(run.phase).toBe('over');
    expect(run.outcome).toBe('won');
    expect(run.gold).toBe(8 + 8 + 16);
    expect(run.artifacts).toHaveLength(2);
    expect(new Set(run.inventory.map((i) => i.type)).size).toBe(3);
  });
});
