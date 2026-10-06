import { describe, expect, it } from 'vitest';
import { ARTIFACT_PARAMS, ARTIFACTS, artifactPrice, offeredArtifacts } from './artifacts';
import { DEFAULT_CONFIG } from './config';
import {
  buyHeal,
  buyUpgrade,
  buyArtifact,
  chooseArtifact,
  leaveShop,
  sellArtifact,
  skipArtifact,
  newRun,
  pickStarter,
  runAction,
  runEndTurn,
  startNextBattle,
  upgradePrice,
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
    expect(run.starterChoices.every((k) => ARTIFACTS[k].rarity === 'common')).toBe(true);
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
  it('小怪胜利：发底薪后直接进商店；小怪不给神器', () => {
    const won = winBattle(toFirstBattle());
    expect(won.phase).toBe('shop');
    expect(won.gold).toBe(DEFAULT_CONFIG.goldBase);
    expect(won.income).toMatchObject({ base: DEFAULT_CONFIG.goldBase, elite: 0, steps: 0, total: DEFAULT_CONFIG.goldBase });
  });

  it('冲分模式提前达标：剩下的每一步换金币', () => {
    const config = { ...DEFAULT_CONFIG, scoreMode: true };
    const run = newRun(1, config);
    const b = ok(startNextBattle(ok(pickStarter(run, run.starterChoices[0]!)), config));
    b.battle!.goal = { target: 1, turns: 5 };
    b.battle!.board = boardWith({ '4,0': 'H', '4,1': 'a' });
    const won = ok(runAction(b, { type: 'ignite', at: { r: 4, c: 0 } }, config));
    // 第 1 回合用掉 1 步：本回合剩 2 步，之后 4 回合各 3 步
    expect(won.income).toMatchObject({ steps: 14, fromSteps: 14 * config.goldPerStep });
    expect(won.gold).toBe(config.goldBase + 14 * config.goldPerStep);
  });

  it('战后保留生命；护盾不带入下一场', () => {
    const b = toFirstBattle();
    b.battle!.player = { hp: 31, maxHp: 40, shield: 7, catalystCharges: 2 };
    const won = winBattle(b);
    expect(won.player.hp).toBe(31);
    expect(won.player.shield).toBe(0);
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

describe('商店', () => {
  const toShop = (gold = 0) => ({ ...winBattle(toFirstBattle()), gold });

  it('升级：扣当前价格、该项 +1 级，价格随等级上涨；可连续购买', () => {
    const shop = toShop(100);
    const p1 = upgradePrice(shop, 'block');
    expect(p1).toBe(DEFAULT_CONFIG.upgradePrice);
    const once = ok(buyUpgrade(shop, 'block'));
    expect(once.levels.block).toBe(2);
    expect(once.gold).toBe(100 - p1);
    expect(upgradePrice(once, 'block')).toBe(p1 + DEFAULT_CONFIG.upgradePriceStep);
    // 各项价格各自计
    expect(upgradePrice(once, 'line')).toBe(p1);
    const twice = ok(buyUpgrade(once, 'block'));
    expect(twice.levels.block).toBe(3);
    expect(twice.phase).toBe('shop');
  });

  it('金币不足时不能买', () => {
    expect(buyUpgrade(toShop(0), 'block').ok).toBe(false);
    const hurt = toShop(0);
    hurt.player.hp = 20;
    expect(buyHeal(hurt).ok).toBe(false);
  });

  it('回血：生命已满时不能买；不超过上限', () => {
    const shop = toShop(100);
    expect(buyHeal(shop).ok).toBe(false);
    shop.player.hp = 35;
    const healed = ok(buyHeal(shop));
    expect(healed.player.hp).toBe(40);
    expect(healed.gold).toBe(100 - DEFAULT_CONFIG.healPrice);
  });

  it('离开商店回到路线页', () => {
    const left = ok(leaveShop(toShop()));
    expect(left.phase).toBe('map');
    expect(left.income).toBeNull();
  });
});

describe('升级与神器池', () => {
  it('升级等级带进下一场战斗', () => {
    let run = ok(leaveShop(ok(buyUpgrade({ ...winBattle(toFirstBattle()), gold: 50 }, 'line'))));
    run = ok(startNextBattle(run));
    expect(run.battle!.levels).toEqual(run.levels);
  });

  it('开局三选一只出普通神器', () => {
    for (let seed = 1; seed <= 20; seed++) expect(newRun(seed).starterChoices.every((k) => ARTIFACTS[k].rarity === 'common' && offeredArtifacts().includes(k))).toBe(true);
  });
});

describe('完整一局', () => {
  it('九关走完：第 3、6 关（精英）后先选神器再进商店，终关胜利直接结束；可 JSON 往返存档', () => {
    let run = newRun(9);
    expect(run.route).toHaveLength(9);
    expect(run.route.map((n) => n.layer)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
    run = ok(pickStarter(run, run.starterChoices[0]!));
    for (let i = 1; i <= 9; i++) {
      run = ok(startNextBattle(run));
      run = winBattle(run);
      if (i === 9) break;
      if (i === 3 || i === 6) {
        expect(run.phase).toBe('artifact');
        expect(run.artifactChoices.some((k) => run.artifacts.includes(k))).toBe(false);
        run = ok(chooseArtifact(run, run.artifactChoices[0]!));
      }
      expect(run.phase).toBe('shop');
      run = ok(leaveShop(run));
      run = JSON.parse(JSON.stringify(run)) as RunState;
    }
    expect(run.phase).toBe('over');
    expect(run.outcome).toBe('won');
    // 打怪模式没有剩余步数：九关底薪加三次首领加成（第 3、6、9 关）
    expect(run.gold).toBe(DEFAULT_CONFIG.goldBase * 9 + DEFAULT_CONFIG.goldEliteBonus * 3);
    expect(run.artifacts).toHaveLength(3);
    expect(UPGRADE_KEYS.reduce((sum, k) => sum + run.levels[k] - 1, 0)).toBe(0);
  });
});

describe('神器：商店、栏位与出售', () => {
  const toShop = (gold = 0, seed = 1) => ({ ...winBattle(toFirstBattle(seed)), gold });

  it('商店上架 2 件没有持有的神器；买下进神器栏、扣对应稀有度的价格', () => {
    const shop = toShop(100);
    expect(shop.shopArtifacts).toHaveLength(DEFAULT_CONFIG.artifactsPerShop);
    expect(shop.shopArtifacts.some((k) => shop.artifacts.includes(k))).toBe(false);
    const key = shop.shopArtifacts[0]!;
    const bought = ok(buyArtifact(shop, 0));
    expect(bought.artifacts).toContain(key);
    expect(bought.gold).toBe(100 - artifactPrice(key, DEFAULT_CONFIG));
    expect(bought.shopArtifacts).not.toContain(key);
  });

  it('金币不足或神器栏满了不能买', () => {
    expect(buyArtifact(toShop(0), 0).ok).toBe(false);
    const full = toShop(100);
    full.artifacts = ['chainLens', 'redNose', 'banana', 'loner', 'smallStep'].filter((k) => !full.shopArtifacts.includes(k as never)) as typeof full.artifacts;
    while (full.artifacts.length < DEFAULT_CONFIG.artifactSlots) full.artifacts.push('powderKeg');
    expect(buyArtifact(full, 0).ok).toBe(false);
  });

  it('卖掉神器得半价（向下取整）', () => {
    const shop = toShop(0);
    shop.artifacts = ['glassCannon'];
    const sold = ok(sellArtifact(shop, 'glassCannon'));
    expect(sold.artifacts).toEqual([]);
    expect(sold.gold).toBe(Math.floor(DEFAULT_CONFIG.artifactPrices.rare / 2));
  });

  it('商店的稀有度大致按 70 / 25 / 5', () => {
    const count = { common: 0, uncommon: 0, rare: 0 };
    for (let seed = 1; seed <= 150; seed++) for (const k of toShop(0, seed).shopArtifacts) count[ARTIFACTS[k].rarity]++;
    expect(count.common).toBeGreaterThan(count.uncommon);
    expect(count.uncommon).toBeGreaterThan(count.rare);
    expect(count.rare).toBeGreaterThan(0);
  });

  it('首领奖励只出罕见与稀有；栏满不能选，可以卖掉一件再选或者跳过', () => {
    let run = toFirstBattle();
    run = ok(leaveShop(winBattle(run)));
    run = ok(leaveShop(winBattle(ok(startNextBattle(run)))));
    run = winBattle(ok(startNextBattle(run)));
    expect(run.phase).toBe('artifact');
    expect(run.artifactChoices.every((k) => ARTIFACTS[k].rarity !== 'common')).toBe(true);
    const full = { ...run, artifacts: ['chainLens', 'redNose', 'banana', 'loner', 'smallStep'] as RunState['artifacts'] };
    const pick = full.artifactChoices[0]!;
    expect(chooseArtifact(full, pick).ok).toBe(false);
    const after = ok(chooseArtifact(ok(sellArtifact(full, 'redNose')), pick));
    expect(after.artifacts).toContain(pick);
    expect(after.phase).toBe('shop');
    expect(ok(skipArtifact(full)).phase).toBe('shop');
  });

  it('香蕉：每关结束有时会烂掉，同种子结果相同', () => {
    let rotted = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const b = toFirstBattle(seed);
      b.artifacts = ['banana'];
      const won = winBattle(b);
      if (!won.artifacts.includes('banana')) {
        rotted++;
        expect(won.lostArtifacts).toEqual(['banana']);
      }
    }
    expect(rotted).toBeGreaterThan(2);
    expect(rotted).toBeLessThan(25);
  });
});

describe('第三批：关卡之间', () => {
  const config = { ...DEFAULT_CONFIG, scoreMode: true };
  /** 冲分模式第一关，带上指定神器，用一枚直线炸弹立刻达标（第 1 回合只用 1 步） */
  function quickWin(artifacts: RunState['artifacts'], gold = 0, prep?: (r: RunState) => void): RunState {
    let run = newRun(3, config);
    run = ok(pickStarter(run, run.starterChoices[0]!));
    run.artifacts = artifacts;
    run.gold = gold;
    run = ok(startNextBattle(run, config));
    run.battle!.goal = { target: 1, turns: 5 };
    run.battle!.board = boardWith({ '4,0': 'H', '6,6': 'A', '7,7': 'A' });
    prep?.(run);
    return ok(runAction(run, { type: 'ignite', at: { r: 4, c: 0 } }, config));
  }

  it('存钱罐按结算前的金币给利息、拆弹工按剩下的炸弹、金怀表固定给', () => {
    const won = quickWin(['piggyBank', 'defuser', 'goldWatch'], 37);
    const by = Object.fromEntries(won.income!.artifacts.map((a) => [a.key, a.amount]));
    expect(by.piggyBank).toBe(3);
    expect(by.defuser).toBeGreaterThanOrEqual(1);
    expect(by.goldWatch).toBe(ARTIFACT_PARAMS.goldWatchGold);
    expect(won.gold).toBe(37 + won.income!.total);
  });

  it('冰淇淋每关融化，减到 0 消失', () => {
    const won = quickWin(['iceCream'], 0, (r) => (r.battle!.player.counters = { iceCream: 8 }));
    expect(won.artifacts).not.toContain('iceCream');
    expect(won.lostArtifacts).toEqual(['iceCream']);
    const half = quickWin(['iceCream']);
    expect(half.player.counters!.iceCream).toBe(2);
  });

  it('勋章：提前达标（剩余步数够多），次数 +1', () => {
    expect(quickWin(['medal']).player.counters!.medal).toBe(1);
  });

  it('免检章：首领关不带规则', () => {
    let run = newRun(3, config);
    run = ok(pickStarter(run, run.starterChoices[0]!));
    run.battleIndex = 2;
    expect(ok(startNextBattle(run, config)).battle!.rule).toBeDefined();
    run.artifacts = ['exemption'];
    expect(ok(startNextBattle(run, config)).battle!.rule).toBeUndefined();
  });

  it('替身用掉后从整局移除', () => {
    let run = newRun(3, config);
    run = ok(pickStarter(run, run.starterChoices[0]!));
    run.artifacts = ['standIn'];
    run = ok(startNextBattle(run, config));
    run.battle!.turn = 5;
    run.battle!.player.hp = 1;
    const after = ok(runEndTurn(run, config));
    expect(after.phase).toBe('shop');
    expect(after.artifacts).not.toContain('standIn');
    expect(after.lostArtifacts).toEqual(['standIn']);
  });
});
