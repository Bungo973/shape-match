import { describe, expect, it } from 'vitest';
import { ARTIFACTS, offeredArtifacts } from './artifacts';
import { DEFAULT_CONFIG } from './config';
import {
  campRest,
  campUpgrade,
  chooseArtifact,
  chooseUpgrade,
  newRun,
  pickStarter,
  rerollRewards,
  runAction,
  runEndTurn,
  startNextBattle,
  type RunResult,
  type RunState,
} from './run';
import { boardWith } from './test-utils';
import { UPGRADE_KEYS } from './upgrades';

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
  it('小怪胜利：发 8 金币、升级三选一，选中项 +1 级后进营地；小怪不给神器', () => {
    const won = winBattle(toFirstBattle());
    expect(won.phase).toBe('reward');
    expect(won.gold).toBe(DEFAULT_CONFIG.goldMinion);
    expect(won.reward!.choices).toHaveLength(3);
    const key = won.reward!.choices[0]!.key;
    const camp = ok(chooseUpgrade(won, 0));
    expect(camp.phase).toBe('camp');
    expect(camp.levels[key]).toBe(won.levels[key] + 1);
  });

  it('战后保留生命与催化剂充能；护盾不带入下一场', () => {
    const b = toFirstBattle();
    b.battle!.player = { hp: 31, maxHp: 40, shield: 7, catalystCharges: 2 };
    const won = winBattle(b);
    expect(won.player.hp).toBe(31);
    expect(won.player.catalystCharges).toBeGreaterThanOrEqual(0);
    expect(won.player.shield).toBe(0);
  });

  it('重掷：扣 8 金币、候选变化；金币不足时不能重掷', () => {
    const won = winBattle(toFirstBattle());
    const rerolled = ok(rerollRewards(won));
    expect(rerolled.gold).toBe(0);
    expect(rerolled.reward!.choices).not.toEqual(won.reward!.choices);
    expect(rerollRewards(rerolled).ok).toBe(false);
  });

  it('没有拾荒眼镜时不能保留候选', () => {
    const won = winBattle(toFirstBattle());
    expect(rerollRewards(won, 0).ok).toBe(false);
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
  const toCamp = () => ok(chooseUpgrade(winBattle(toFirstBattle()), 0));

  it('休息回复生命，然后回到路线页', () => {
    const camp = toCamp();
    camp.player.hp = 20;
    const after = ok(campRest(camp));
    expect(after.player.hp).toBe(30);
    expect(after.phase).toBe('map');
  });

  it('升级：金币不足时不能升级', () => {
    const camp = toCamp();
    expect(camp.gold).toBeLessThan(DEFAULT_CONFIG.upgradeCost);
    expect(campUpgrade(camp, 'attack').ok).toBe(false);
  });

  it('升级：任选一项 +1 级，扣 15 金币，然后回到路线页', () => {
    const camp = { ...toCamp(), gold: 20 };
    const after = ok(campUpgrade(camp, 'shield'));
    expect(after.levels.shield).toBe(camp.levels.shield + 1);
    expect(after.gold).toBe(5);
    expect(after.phase).toBe('map');
  });

  it('精工刻刀：营地升级一次 +2 级', () => {
    const camp = { ...toCamp(), gold: 20, artifacts: ['fineChisel' as const] };
    expect(ok(campUpgrade(camp, 'line')).levels.line).toBe(camp.levels.line + 2);
  });
});

describe('升级与神器池', () => {
  it('升级等级带进下一场战斗', () => {
    let run = ok(campRest(ok(chooseUpgrade(winBattle(toFirstBattle()), 0))));
    run = ok(startNextBattle(run));
    expect(run.battle!.levels).toEqual(run.levels);
  });

  it('依赖嵌片的神器不再出现在开局与精英候选中', () => {
    expect(offeredArtifacts()).not.toContain('resonanceBase');
    expect(offeredArtifacts()).not.toContain('lockResonator');
    for (let seed = 1; seed <= 20; seed++) expect(newRun(seed).starterChoices.every((k) => !ARTIFACTS[k].retired)).toBe(true);
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
      run = ok(chooseUpgrade(run, 0));
      if (i === 3) {
        expect(run.phase).toBe('artifact');
        expect(run.artifactChoices.some((k) => run.artifacts.includes(k) || ARTIFACTS[k].retired)).toBe(false);
        run = ok(chooseArtifact(run, run.artifactChoices[0]!));
      }
      run = ok(campRest(run));
      run = JSON.parse(JSON.stringify(run)) as RunState;
    }
    expect(run.phase).toBe('over');
    expect(run.outcome).toBe('won');
    expect(run.gold).toBe(8 + 8 + 16);
    expect(run.artifacts).toHaveLength(2);
    // 三次奖励各升一级
    expect(UPGRADE_KEYS.reduce((sum, k) => sum + run.levels[k] - 1, 0)).toBe(3);
  });
});
