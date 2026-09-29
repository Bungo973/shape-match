// 一局的状态与流程：开局神器 → 战斗 → 金币与升级三选一 →（精英）神器三选一 → 营地 → 路线页 → 下一战。
// 规则见 docs/MAP.md 与 docs/GAME_RULES.md §7。当前实现第一段落（三战）；事件、商店与后两段落在阶段 3 加入。
import { ARTIFACTS, offeredArtifacts, type ArtifactKey } from './artifacts';
import { defaultLevels, UPGRADE_KEYS, type UpgradeKey, type UpgradeLevels } from './upgrades';
import { endTurn, playerAction, startBattle, type ActionLog, type BattleState, type EnemyTurnLog, type PlayerState } from './battle';
import { DEFAULT_CONFIG, type EngineConfig } from './config';
import { SEGMENT_1, type RouteNode } from './content/enemies';
import { generateUpgradeChoices, mixSeed, type UpgradeCandidate } from './rewards';
import { createRng } from './rng';
import type { Action } from './types';

export const RUN_RULES_VERSION = 3;

export type RunPhase = 'starter' | 'map' | 'battle' | 'reward' | 'artifact' | 'camp' | 'over';

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
  reward: { goldGained: number; choices: UpgradeCandidate[]; rerollCount: number } | null;
  artifactChoices: ArtifactKey[];
  outcome: 'ongoing' | 'won' | 'lost';
  totalScore: number;
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

export function newRun(seed: number, config: EngineConfig = DEFAULT_CONFIG, route: RouteNode[] = SEGMENT_1): RunState {
  const starters = offeredArtifacts().filter((k) => ARTIFACTS[k].starter);
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
    reward: null,
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

/** 战斗结束时结转状态：胜利发金币与嵌片三选一，失败结束本局 */
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
  // 战后保留生命与催化剂充能；毒气与眩晕随战斗清零；护盾按配置决定是否带入下一场
  run.player = config.playerShieldCarryOver ? b.player : { ...b.player, shield: 0 };
  const node = current(run);
  if (node.tier === 'boss') {
    run.phase = 'over';
    run.outcome = 'won';
    return;
  }
  const goldGained = node.tier === 'elite' ? config.goldElite : config.goldMinion;
  run.gold += goldGained;
  run.reward = { goldGained, choices: upgradeChoices(run, 0), rerollCount: 0 };
  run.phase = 'reward';
}

function upgradeChoices(run: RunState, rerollCount: number, previous?: UpgradeCandidate[], keepIndex?: number): UpgradeCandidate[] {
  return generateUpgradeChoices({
    runSeed: run.seed,
    battleIndex: run.battleIndex,
    rerollCount,
    levels: run.levels,
    artifacts: run.artifacts,
    ...(previous ? { previous } : {}),
    ...(keepIndex != null ? { keepIndex } : {}),
  });
}

/** 花金币重掷升级候选；持有拾荒眼镜时可保留一项 */
export function rerollRewards(prev: RunState, keepIndex?: number, config: EngineConfig = DEFAULT_CONFIG): RunResult {
  if (prev.phase !== 'reward' || !prev.reward) return fail(prev, '当前没有升级候选');
  if (prev.gold < config.rerollCost) return fail(prev, '金币不足');
  if (keepIndex != null && !prev.artifacts.includes('scavengerGoggles')) return fail(prev, '没有拾荒眼镜，不能保留候选');
  const run = clone(prev);
  run.gold -= config.rerollCost;
  const n = run.reward!.rerollCount + 1;
  run.reward = { ...run.reward!, rerollCount: n, choices: upgradeChoices(run, n, run.reward!.choices, keepIndex) };
  return { ok: true, run };
}

/** 选一项升级 +1 级；精英战后接神器三选一，否则进入营地 */
export function chooseUpgrade(prev: RunState, index: number): RunResult {
  const c = prev.reward?.choices[index];
  if (prev.phase !== 'reward' || !c) return fail(prev, '无效的升级候选');
  const run = clone(prev);
  run.levels[c.key]++;
  run.reward = null;
  if (current(run).tier === 'elite') {
    const pool = offeredArtifacts().filter((k) => !run.artifacts.includes(k));
    run.artifactChoices = sample(pool, 3, mixSeed(run.seed, 0xe, run.battleIndex));
    run.phase = 'artifact';
  } else {
    run.phase = 'camp';
  }
  return { ok: true, run };
}

export function chooseArtifact(prev: RunState, key: ArtifactKey): RunResult {
  if (prev.phase !== 'artifact' || !prev.artifactChoices.includes(key)) return fail(prev, '无效的神器候选');
  const run = clone(prev);
  run.artifacts.push(key);
  run.artifactChoices = [];
  run.phase = 'camp';
  return { ok: true, run };
}

// ---- 营地：升级或休息，二选一 ----

function leaveCamp(run: RunState): void {
  if (run.battleIndex >= run.route.length) {
    run.phase = 'over';
    run.outcome = 'won';
  } else {
    run.phase = 'map';
  }
}

export function campRest(prev: RunState, config: EngineConfig = DEFAULT_CONFIG): RunResult {
  if (prev.phase !== 'camp') return fail(prev, '不在营地');
  const run = clone(prev);
  run.player.hp = Math.min(run.player.maxHp, run.player.hp + config.restHeal);
  leaveCamp(run);
  return { ok: true, run };
}

/** 营地一次升级的级数：普通一级，持有精工刻刀时两级 */
export const campUpgradeAmount = (run: RunState) => (run.artifacts.includes('fineChisel') ? 2 : 1);

/** 花金币任选一项升级；奖励决定方向，营地决定加码 */
export function campUpgrade(prev: RunState, key: UpgradeKey, config: EngineConfig = DEFAULT_CONFIG): RunResult {
  if (prev.phase !== 'camp') return fail(prev, '不在营地');
  if (!UPGRADE_KEYS.includes(key)) return fail(prev, '没有这项升级');
  if (prev.gold < config.upgradeCost) return fail(prev, '金币不足');
  const run = clone(prev);
  run.levels[key] += campUpgradeAmount(run);
  run.gold -= config.upgradeCost;
  leaveCamp(run);
  return { ok: true, run };
}

/** 调试／原型：直接把一项升级 +1 级（战斗中同步到当前战斗）。正式的奖励与营地接入见 docs/BLOCK_BUILD.md */
export function debugLevelUp(prev: RunState, key: UpgradeKey, delta = 1): RunState {
  const run = clone(prev);
  run.levels[key] = Math.max(1, run.levels[key] + delta);
  if (run.battle) run.battle.levels = { ...run.levels };
  return run;
}

