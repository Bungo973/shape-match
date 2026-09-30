// 一局的状态与流程：开局神器 → 关卡 → 结算金币 →（精英）神器三选一 → 商店 → 路线页 → 下一关。
// 2026-09-30 起所有升级都在商店用金币买，取代原来的升级三选一与营地；见 docs/DESIGN_JOURNAL.md。
import { ARTIFACTS, offeredArtifacts, type ArtifactKey } from './artifacts';
import { defaultLevels, UPGRADE_KEYS, type UpgradeKey, type UpgradeLevels } from './upgrades';
import { endTurn, playerAction, startBattle, stepsLeft, type ActionLog, type BattleState, type EnemyTurnLog, type PlayerState } from './battle';
import { DEFAULT_CONFIG, type EngineConfig } from './config';
import { FULL_ROUTE, type RouteNode } from './content/enemies';
import { createRng, mixSeed } from './rng';
import type { Action } from './types';

export const RUN_RULES_VERSION = 6;

export type RunPhase = 'starter' | 'map' | 'battle' | 'artifact' | 'shop' | 'over';

export interface RunState {
  rulesVersion: number;
  seed: number;
  phase: RunPhase;
  route: RouteNode[];
  /** 当前或刚结束的战斗序号（1 起）；开局前为 0 */
  battleIndex: number;
  player: PlayerState;
  gold: number;
  artifacts: ArtifactKey[];
  /** 方块与炸弹的升级等级，整局持续 */
  levels: UpgradeLevels;
  battle: BattleState | null;
  starterChoices: ArtifactKey[];
  /** 上一关的金币收入明细，供结算与商店展示 */
  income: Income | null;
  artifactChoices: ArtifactKey[];
  outcome: 'ongoing' | 'won' | 'lost';
  totalScore: number;
}

export interface Income {
  base: number;
  elite: number;
  /** 提前达标时剩下的步数 */
  steps: number;
  fromSteps: number;
  total: number;
}

export type RunResult =
  | { ok: true; run: RunState }
  | { ok: false; run: RunState; reason: string };

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const fail = (run: RunState, reason: string): RunResult => ({ ok: false, run, reason });

/** 从候选中不放回地抽取 n 项（顺序固定，保证复现） */
function sample<T>(items: T[], n: number, seed: number): T[] {
  const rng = createRng(seed);
  const pool = [...items];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) out.push(pool.splice(rng.int(pool.length), 1)[0]!);
  return out;
}

const current = (run: RunState): RouteNode => run.route[run.battleIndex - 1]!;

export function newRun(seed: number, config: EngineConfig = DEFAULT_CONFIG, route: RouteNode[] = FULL_ROUTE): RunState {
  const starters = offeredArtifacts(config.scoreMode).filter((k) => ARTIFACTS[k].starter);
  return {
    rulesVersion: RUN_RULES_VERSION,
    seed,
    phase: 'starter',
    route,
    battleIndex: 0,
    player: { hp: config.playerMaxHp, maxHp: config.playerMaxHp, shield: 0, catalystCharges: 0 },
    gold: 0,
    artifacts: [],
    levels: defaultLevels(),
    battle: null,
    starterChoices: sample(starters, 3, mixSeed(seed, 0x5)),
    income: null,
    artifactChoices: [],
    outcome: 'ongoing',
    totalScore: 0,
  };
}

export function pickStarter(prev: RunState, key: ArtifactKey): RunResult {
  if (prev.phase !== 'starter' || !prev.starterChoices.includes(key)) return fail(prev, '不在开局神器选择中');
  const run = clone(prev);
  run.artifacts.push(key);
  run.starterChoices = [];
  run.phase = 'map';
  return { ok: true, run };
}

/** 从路线页进入下一场战斗；进入后棋盘布局锁定 */
export function startNextBattle(prev: RunState, config: EngineConfig = DEFAULT_CONFIG): RunResult {
  if (prev.phase !== 'map') return fail(prev, '只能从路线页开始战斗');
  const run = clone(prev);
  run.battleIndex++;
  const node = current(run);
  run.battle = startBattle(
    {
      seed: mixSeed(run.seed, 0xb, run.battleIndex),
      player: config.playerShieldCarryOver ? run.player : { ...run.player, shield: 0 },
      enemy: node.enemy,
      artifacts: run.artifacts,
      levels: run.levels,
    },
    config,
  );
  run.phase = 'battle';
  return { ok: true, run };
}

export function runAction(prev: RunState, action: Action, config: EngineConfig = DEFAULT_CONFIG): RunResult & { log?: ActionLog } {
  if (prev.phase !== 'battle' || !prev.battle) return fail(prev, '当前不在战斗中');
  const out = playerAction(prev.battle, action, config);
  if (!out.ok) return fail(prev, out.reason);
  const run = clone(prev);
  run.battle = out.state;
  settleBattle(run, config);
  return { ok: true, run, log: out.log };
}

export function runEndTurn(prev: RunState, config: EngineConfig = DEFAULT_CONFIG): RunResult & { log?: EnemyTurnLog } {
  if (prev.phase !== 'battle' || !prev.battle) return fail(prev, '当前不在战斗中');
  const { state, log } = endTurn(prev.battle, config);
  const run = clone(prev);
  run.battle = state;
  settleBattle(run, config);
  return { ok: true, run, ...(log ? { log } : {}) };
}

/** 关卡结束时结转状态：发金币；精英关后先选神器，然后进商店；终关或失败则结束本局 */
function settleBattle(run: RunState, config: EngineConfig): void {
  const b = run.battle!;
  if (b.outcome === 'ongoing') return;
  run.totalScore += b.totalScore;
  if (b.outcome === 'lost') {
    run.player = b.player;
    run.phase = 'over';
    run.outcome = 'lost';
    return;
  }
  // 关后保留生命；护盾按配置决定是否带入下一关
  run.player = config.playerShieldCarryOver ? b.player : { ...b.player, shield: 0 };
  const node = current(run);
  if (node.tier === 'boss') {
    run.phase = 'over';
    run.outcome = 'won';
    return;
  }
  // 冲分模式：未达标（按差距扣过血）的关没有剩余步数，也照发底薪
  const steps = b.goal && b.totalScore >= b.goal.target ? stepsLeft(b, config) : 0;
  const income: Income = {
    base: config.goldBase,
    elite: node.tier === 'elite' ? config.goldEliteBonus : 0,
    steps,
    fromSteps: steps * config.goldPerStep,
    total: 0,
  };
  income.total = income.base + income.elite + income.fromSteps;
  run.gold += income.total;
  run.income = income;
  if (node.tier === 'elite') {
    const pool = offeredArtifacts(config.scoreMode).filter((k) => !run.artifacts.includes(k));
    run.artifactChoices = sample(pool, 3, mixSeed(run.seed, 0xe, run.battleIndex));
    run.phase = run.artifactChoices.length ? 'artifact' : 'shop';
  } else {
    run.phase = 'shop';
  }
}

export function chooseArtifact(prev: RunState, key: ArtifactKey): RunResult {
  if (prev.phase !== 'artifact' || !prev.artifactChoices.includes(key)) return fail(prev, '无效的神器候选');
  const run = clone(prev);
  run.artifacts.push(key);
  run.artifactChoices = [];
  run.phase = 'shop';
  return { ok: true, run };
}

// ---- 商店：升级与回血都用金币买，可买多次，离开后进入下一关 ----

/** 某项升级当前的价格：随该项等级上涨 */
export const upgradePrice = (run: RunState, key: UpgradeKey, config: EngineConfig = DEFAULT_CONFIG): number =>
  config.upgradePrice + config.upgradePriceStep * (run.levels[key] - 1);

export function buyUpgrade(prev: RunState, key: UpgradeKey, config: EngineConfig = DEFAULT_CONFIG): RunResult {
  if (prev.phase !== 'shop') return fail(prev, '不在商店');
  if (!UPGRADE_KEYS.includes(key)) return fail(prev, '没有这项升级');
  const price = upgradePrice(prev, key, config);
  if (prev.gold < price) return fail(prev, '金币不足');
  const run = clone(prev);
  run.levels[key]++;
  run.gold -= price;
  return { ok: true, run };
}

export function buyHeal(prev: RunState, config: EngineConfig = DEFAULT_CONFIG): RunResult {
  if (prev.phase !== 'shop') return fail(prev, '不在商店');
  if (prev.player.hp >= prev.player.maxHp) return fail(prev, '生命已满');
  if (prev.gold < config.healPrice) return fail(prev, '金币不足');
  const run = clone(prev);
  run.player.hp = Math.min(run.player.maxHp, run.player.hp + config.healAmount);
  run.gold -= config.healPrice;
  return { ok: true, run };
}

export function leaveShop(prev: RunState): RunResult {
  if (prev.phase !== 'shop') return fail(prev, '不在商店');
  const run = clone(prev);
  run.income = null;
  if (run.battleIndex >= run.route.length) {
    run.phase = 'over';
    run.outcome = 'won';
  } else {
    run.phase = 'map';
  }
  return { ok: true, run };
}

/** 调试／原型：直接把一项升级 +1 级（战斗中同步到当前战斗） */
export function debugLevelUp(prev: RunState, key: UpgradeKey, delta = 1): RunState {
  const run = clone(prev);
  run.levels[key] = Math.max(1, run.levels[key] + delta);
  if (run.battle) {
    run.battle.levels = { ...run.levels };
    // 调试：炸弹等级同时改动本场的爆破等级
    if (key === 'line' || key === 'area' || key === 'color') run.battle.bombHeat[key].level = Math.max(1, run.battle.bombHeat[key].level + delta);
  }
  return run;
}
