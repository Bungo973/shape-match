// 一局的状态与流程：开局神器 → 战斗 → 金币与嵌片三选一 →（精英）神器三选一 → 营地 → 路线页 → 下一战。
// 规则见 docs/MAP.md 与 docs/GAME_RULES.md §7。当前实现第一段落（三战）；事件、商店与后两段落在阶段 3 加入。
import { ARTIFACTS, type ArtifactKey } from './artifacts';
import { endTurn, playerAction, startBattle, type ActionLog, type BattleState, type EnemyTurnLog, type PlayerState } from './battle';
import { DEFAULT_CONFIG, type EngineConfig } from './config';
import { SEGMENT_1, type RouteNode } from './content/enemies';
import { canPlace, expansionCells, isRotationOf, normalize, SHAPES, type InsertType, type InstalledInsert } from './inserts';
import { generateInsertChoices, mixSeed, type InsertCandidate } from './rewards';
import { createRng } from './rng';
import type { Action, Pos } from './types';

export const RUN_RULES_VERSION = 1;

export type RunPhase = 'starter' | 'map' | 'battle' | 'reward' | 'artifact' | 'camp' | 'over';

/** 随身匣中的嵌片：形状用相对坐标保存，嵌入时再旋转与平移 */
export interface InventoryInsert {
  id: string;
  type: InsertType;
  shape: Pos[];
}

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
  installed: InstalledInsert[];
  inventory: InventoryInsert[];
  nextInsertId: number;
  battle: BattleState | null;
  starterChoices: ArtifactKey[];
  reward: { goldGained: number; choices: InsertCandidate[]; rerollCount: number } | null;
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

const ownedTypes = (run: RunState): InsertType[] => [...run.installed.map((i) => i.type), ...run.inventory.map((i) => i.type)];
const current = (run: RunState): RouteNode => run.route[run.battleIndex - 1]!;

export function newRun(seed: number, config: EngineConfig = DEFAULT_CONFIG, route: RouteNode[] = SEGMENT_1): RunState {
  const starters = (Object.keys(ARTIFACTS) as ArtifactKey[]).filter((k) => ARTIFACTS[k].starter);
  return {
    rulesVersion: RUN_RULES_VERSION,
    seed,
    phase: 'starter',
    route,
    battleIndex: 0,
    player: { hp: config.playerMaxHp, maxHp: config.playerMaxHp, shield: 0, catalystCharges: 0 },
    gold: 0,
    artifacts: [],
    installed: [],
    inventory: [],
    nextInsertId: 1,
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
      inserts: run.installed,
      artifacts: run.artifacts,
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
  // 战后保留生命、护盾、催化剂充能；毒气与眩晕随战斗清零
  run.player = b.player;
  const node = current(run);
  if (node.tier === 'boss') {
    run.phase = 'over';
    run.outcome = 'won';
    return;
  }
  const goldGained = node.tier === 'elite' ? config.goldElite : config.goldMinion;
  run.gold += goldGained;
  run.reward = { goldGained, choices: insertChoices(run, 0, config), rerollCount: 0 };
  run.phase = 'reward';
}

function insertChoices(run: RunState, rerollCount: number, config: EngineConfig, previous?: InsertCandidate[], keepIndex?: number): InsertCandidate[] {
  return generateInsertChoices({
    runSeed: run.seed,
    battleIndex: run.battleIndex,
    rerollCount,
    owned: ownedTypes(run),
    artifacts: run.artifacts,
    installed: run.installed,
    size: { rows: config.rows, cols: config.cols },
    maxInstalled: config.maxInstalledInserts,
    ...(previous ? { previous } : {}),
    ...(keepIndex != null ? { keepIndex } : {}),
  });
}

/** 花金币重掷嵌片候选；持有拾荒眼镜时可保留一项 */
export function rerollInserts(prev: RunState, keepIndex?: number, config: EngineConfig = DEFAULT_CONFIG): RunResult {
  if (prev.phase !== 'reward' || !prev.reward) return fail(prev, '当前没有嵌片候选');
  if (prev.gold < config.rerollCost) return fail(prev, '金币不足');
  if (keepIndex != null && !prev.artifacts.includes('scavengerGoggles')) return fail(prev, '没有拾荒眼镜，不能保留候选');
  const run = clone(prev);
  run.gold -= config.rerollCost;
  const n = run.reward!.rerollCount + 1;
  run.reward = { ...run.reward!, rerollCount: n, choices: insertChoices(run, n, config, run.reward!.choices, keepIndex) };
  return { ok: true, run };
}

/** 选一块嵌片放进随身匣；精英战后接神器三选一，否则进入营地 */
export function chooseInsert(prev: RunState, index: number): RunResult {
  const c = prev.reward?.choices[index];
  if (prev.phase !== 'reward' || !c) return fail(prev, '无效的嵌片候选');
  const run = clone(prev);
  run.inventory.push({ id: `ins-${run.nextInsertId++}`, type: c.type, shape: normalize(SHAPES[c.shape]) });
  run.reward = null;
  if (current(run).tier === 'elite') {
    const pool = (Object.keys(ARTIFACTS) as ArtifactKey[]).filter((k) => !run.artifacts.includes(k));
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

// ---- 营地：升级嵌片或休息，二选一 ----

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

/** 升级数量：普通一格，持有精工刻刀时两格 */
export const upgradeCellCount = (run: RunState) => (run.artifacts.includes('fineChisel') ? 2 : 1);

/** 随身匣嵌片可添加的相对坐标：与形状正交相邻且不属于形状；允许负坐标，添加后再归一化 */
export function inventoryExpansionCells(shape: Pos[]): Pos[] {
  const key = (p: Pos) => `${p.r},${p.c}`;
  const own = new Set(shape.map(key));
  const out = new Map<string, Pos>();
  for (const p of shape) {
    for (const d of [{ r: -1, c: 0 }, { r: 1, c: 0 }, { r: 0, c: -1 }, { r: 0, c: 1 }]) {
      const q = { r: p.r + d.r, c: p.c + d.c };
      if (!own.has(key(q))) out.set(key(q), q);
    }
  }
  return [...out.values()].sort((a, b) => a.r - b.r || a.c - b.c);
}

/**
 * 升级一块拥有的嵌片：逐格添加与自身正交相邻的空格。
 * 已安装的原位扩张（不越界、不重叠），随身匣中的在相对形状上扩张。
 */
export function campUpgrade(prev: RunState, insertId: string, cells: Pos[], config: EngineConfig = DEFAULT_CONFIG): RunResult {
  if (prev.phase !== 'camp') return fail(prev, '不在营地');
  if (prev.gold < config.upgradeCost) return fail(prev, '金币不足');
  if (cells.length === 0 || cells.length > upgradeCellCount(prev)) return fail(prev, `一次升级只能添加 ${upgradeCellCount(prev)} 格`);
  const run = clone(prev);
  const installed = run.installed.find((i) => i.id === insertId);
  const stored = run.inventory.find((i) => i.id === insertId);
  if (!installed && !stored) return fail(prev, '没有这块嵌片');
  // 坐标都相对于升级前的形状；随身匣嵌片全部添加完再归一化，避免中途平移
  const work = stored ? [...stored.shape] : null;
  for (const cell of cells) {
    if (installed) {
      const legal = expansionCells({ rows: config.rows, cols: config.cols }, run.installed, installed);
      if (!legal.some((p) => p.r === cell.r && p.c === cell.c)) return fail(prev, '该格不能扩张');
      installed.cells.push(cell);
    } else {
      if (!inventoryExpansionCells(work!).some((p) => p.r === cell.r && p.c === cell.c)) return fail(prev, '该格不能扩张');
      work!.push(cell);
    }
  }
  if (stored) stored.shape = normalize(work!);
  run.gold -= config.upgradeCost;
  leaveCamp(run);
  return { ok: true, run };
}

// ---- 非战斗阶段嵌入棋盘：嵌入即固定 ----

const ADJUSTABLE: RunPhase[] = ['map', 'reward', 'artifact', 'camp'];

/** 把随身匣中的嵌片以给定绝对坐标嵌入；坐标须是该形状某个旋转的平移 */
export function installInsert(prev: RunState, inventoryId: string, cells: Pos[], config: EngineConfig = DEFAULT_CONFIG): RunResult {
  if (!ADJUSTABLE.includes(prev.phase)) return fail(prev, '只能在非战斗阶段嵌入');
  const item = prev.inventory.find((i) => i.id === inventoryId);
  if (!item) return fail(prev, '随身匣中没有这块嵌片');
  if (!isRotationOf(item.shape, cells)) return fail(prev, '形状不符');
  if (!canPlace({ rows: config.rows, cols: config.cols }, prev.installed, cells, config.maxInstalledInserts)) return fail(prev, '越界、重叠或已达安装上限');
  const run = clone(prev);
  run.inventory = run.inventory.filter((i) => i.id !== inventoryId);
  run.installed.push({ id: item.id, type: item.type, cells: cells.map((p) => ({ ...p })) });
  return { ok: true, run };
}
