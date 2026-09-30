import { describe, expect, it } from 'vitest';
import { ARTIFACTS } from './artifacts';
import { playerAction, startBattle, type BattleState } from './battle';
import { DEFAULT_CONFIG } from './config';
import { CRYSTAL_MOLE } from './content/enemies';
import { BOSS_RULE_KEYS, bossRuleFor, isBossLevel, scoreTarget, type BossRule } from './levels';
import { continueEndless, leaveShop, levelInfo, newRun, pickStarter, runAction, startNextBattle, type RunResult, type RunState } from './run';
import { multiplierCap } from './score';
import { boardWith } from './test-utils';

const config = { ...DEFAULT_CONFIG, scoreMode: true };
const ok = (r: RunResult): RunState => {
  if (!r.ok) throw new Error(r.reason);
  return r.run;
};

const boss = (rule: BossRule, seed = 3): BattleState =>
  startBattle({ seed, player: { hp: 40, maxHp: 40, shield: 0, catalystCharges: 0 }, enemy: CRYSTAL_MOLE, artifacts: ['powderKeg'], rule }, config);

describe('关卡与目标分', () => {
  it('前 9 关按配置，之后每关乘以无尽增长系数', () => {
    expect([1, 9].map((l) => scoreTarget(l, config))).toEqual([config.scoreTargets[0], config.scoreTargets[8]]);
    expect(scoreTarget(10, config)).toBe(Math.round((config.scoreTargets[8]! * config.endlessGrowth) / 50) * 50);
    expect(scoreTarget(12, config)).toBeGreaterThan(scoreTarget(11, config));
  });

  it('每三关一个首领关；规则由种子决定，且不与上一个首领关重复', () => {
    expect([1, 2, 3, 4, 5, 6].map(isBossLevel)).toEqual([false, false, true, false, false, true]);
    for (let seed = 1; seed <= 50; seed++) {
      expect(bossRuleFor(seed, 2)).toBeNull();
      expect(bossRuleFor(seed, 6)).toBe(bossRuleFor(seed, 6));
      for (let l = 6; l <= 30; l += 3) expect(bossRuleFor(seed, l)).not.toBe(bossRuleFor(seed, l - 3));
    }
    expect(new Set(Array.from({ length: 60 }, (_, i) => bossRuleFor(i + 1, 3))).size).toBe(BOSS_RULE_KEYS.length);
  });
});

describe('首领规则', () => {
  it('倒悬：整关重力向上', () => {
    expect(boss('inverted').gravity).toBe('up');
  });

  it('色封：抽中的颜色主动清除不计基数，其他颜色照常', () => {
    const s = boss('sealed');
    s.rule = { key: 'sealed', color: 'attack' };
    s.board = boardWith({ '0,0': 'a', '0,1': 'a', '0,2': 's', '1,2': 'a' });
    const out = playerAction(s, { type: 'swap', from: { r: 1, c: 2 }, to: { r: 0, c: 2 } }, config);
    expect(out.ok && out.log.result.activeClearsByType.attack).toBe(0);
    const plain = boss('sealed');
    plain.rule = { key: 'sealed', color: 'shield' };
    plain.board = boardWith({ '0,0': 'a', '0,1': 'a', '0,2': 's', '1,2': 'a' });
    const hit = playerAction(plain, { type: 'swap', from: { r: 1, c: 2 }, to: { r: 0, c: 2 } }, config);
    expect(hit.ok && hit.log.result.activeClearsByType.attack).toBe(3);
  });

  it('石阵：开局放下配置数量的石块', () => {
    expect(boss('stones').board.flat().filter((t) => t?.kind === 'stone')).toHaveLength(config.stoneRuleCount);
  });

  it('低压：倍率不超过 ×3', () => {
    const s = boss('lowCap');
    s.board = boardWith({ '2,0': 'a', '3,0': 'a', '4,0': 'H', '5,0': 'a' });
    const out = playerAction(s, { type: 'ignite', at: { r: 4, c: 0 } }, config);
    expect(multiplierCap({ ...config, multiplierUncapped: false, multiplierSegments: config.multiplierSegments.slice(0, config.lowCapSegments) })).toBe(3);
    expect(out.ok && out.log.settlement!.multiplier).toBeLessThanOrEqual(3);
  });

  it('冷却：引爆不累计爆破等级', () => {
    const s = boss('cooldown');
    s.board = boardWith({ '4,0': 'H', '4,1': 'a' });
    const out = playerAction(s, { type: 'ignite', at: { r: 4, c: 0 } }, config);
    expect(out.ok && out.state.bombHeat.line.count).toBe(0);
  });

  it('哑火：本关没有神器（回合开始的火药桶也不生效）', () => {
    const s = boss('silence');
    expect(s.artifacts).toEqual([]);
    expect(s.board.flat().some((t) => t?.kind === 'bomb')).toBe(false);
    expect(ARTIFACTS.powderKeg).toBeDefined();
  });
});

describe('局流程中的首领关与无尽模式', () => {
  const win = (run: RunState): RunState => {
    const r = JSON.parse(JSON.stringify(run)) as RunState;
    r.battle!.goal!.target = 1;
    delete r.battle!.rule;
    r.battle!.board = boardWith({ '4,0': 'H', '4,1': 'a' });
    return ok(runAction(r, { type: 'ignite', at: { r: 4, c: 0 } }, config));
  };

  it('首领关带上路线页展示的规则；第 9 关后可继续无尽模式，目标继续上涨', () => {
    let run = newRun(4, config);
    run = ok(pickStarter(run, run.starterChoices[0]!));
    for (let i = 1; i <= 9; i++) {
      const info = levelInfo(run, i, config);
      run = ok(startNextBattle(run, config));
      expect(run.battle!.goal!.target).toBe(info.target);
      expect(run.battle!.rule?.key ?? null).toBe(info.rule);
      run = win(run);
      if (i === 9) break;
      if (run.phase === 'artifact') run = { ...run, phase: 'shop' };
      run = ok(leaveShop(run));
    }
    expect(run.phase).toBe('over');
    expect(run.outcome).toBe('won');
    run = ok(continueEndless(run));
    expect(run.phase).toBe('shop');
    run = ok(startNextBattle(ok(leaveShop(run)), config));
    expect(run.battleIndex).toBe(10);
    expect(run.battle!.goal!.target).toBe(scoreTarget(10, config));
    expect(continueEndless(run).ok).toBe(false);
  });
});
