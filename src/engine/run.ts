// 一局的状态与流程：开局神器 → 关卡 → 结算金币 →（精英）神器三选一 → 商店 → 路线页 → 下一关。
// 2026-09-30 起所有升级都在商店用金币买，取代原来的升级三选一与营地；见 docs/DESIGN_JOURNAL.md。
import { ARTIFACT_PARAMS, ARTIFACTS, artifactPrice, artifactSellPrice, offeredArtifacts, type ArtifactKey, type ArtifactRarity } from './artifacts';
import { defaultLevels, UPGRADE_KEYS, type UpgradeKey, type UpgradeLevels } from './upgrades';
import { endTurn, playerAction, startBattle, stepsLeft, useItem, type ActionLog, type BattleState, type EnemyTurnLog, type ItemUse, type PlayerState } from './battle';
import { ITEM_KEYS, ITEM_PARAMS, type ItemKey } from './items';
import type { ResolutionEvent } from './resolve';
import { DEFAULT_CONFIG, type EngineConfig } from './config';
import { FULL_ROUTE, type RouteNode } from './content/enemies';
import { bossRuleFor, isBossLevel, scoreTarget } from './levels';
import { createRng, mixSeed } from './rng';
import { finishTask, taskOptions, type TaskDef } from './tasks';
import type { Action } from './types';

export const RUN_RULES_VERSION = 10;

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
  /** 冲分模式：通关后选择继续，进入无尽模式 */
  endless: boolean;
  /** 背包里的道具（最多 config.itemSlots 件）与本次商店上架的道具 */
  items: ItemKey[];
  shopItems: ItemKey[];
  /** 本次商店上架的神器（买走即下架） */
  shopArtifacts: ArtifactKey[];
  /** 本次商店已经刷新的次数（决定下一次刷新的价格） */
  rerolls?: number;
  /** 上一关结束时消失的神器（香蕉烂掉、冰淇淋化完、替身用掉），供结算展示 */
  lostArtifacts: ArtifactKey[];
  /** 上一关任务的结果，供结算展示 */
  taskResult?: TaskResult | null;
}

export interface TaskResult {
  def: TaskDef;
  done: boolean;
  progress: number;
  /** 难任务奖励的神器；栏满时为 null，改给金币 */
  artifact?: ArtifactKey | null;
  gold: number;
}

export interface Income {
  base: number;
  elite: number;
  /** 提前达标时剩下的步数 */
  steps: number;
  fromSteps: number;
  /** 金币类神器的收入（存钱罐、拆弹工、金怀表） */
  artifacts: { key: ArtifactKey; amount: number }[];
  /** 易任务的金币；难任务栏满时折成的金币也算在这里 */
  task: number;
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

/**
 * 第 level 关（1 起）的路线节点。无尽模式超出路线的关沿用最后一关的敌人数据，
 * 每三关一个精英位（即冲分的首领关），其余为小怪位。
 */
function nodeAt(run: RunState, level: number): RouteNode {
  const node = run.route[level - 1];
  if (node) return node;
  const last = run.route[run.route.length - 1]!;
  return { ...last, tier: isBossLevel(level) ? 'elite' : 'minion', enemy: { ...last.enemy, id: `endless-${level}`, name: `第 ${level} 关` } };
}

const current = (run: RunState): RouteNode => nodeAt(run, run.battleIndex);

/**
 * 按稀有度权重不放回地抽 n 件神器：每件先按权重抽稀有度，该稀有度抽空时在剩下的候选里按权重重抽。
 * 权重为 0 的稀有度不会出现（开局只出普通，首领奖励只出罕见与稀有）。
 */
function sampleArtifacts(candidates: ArtifactKey[], n: number, weights: Record<ArtifactRarity, number>, seed: number): ArtifactKey[] {
  const rng = createRng(seed);
  const pool = candidates.filter((k) => weights[ARTIFACTS[k].rarity] > 0);
  const out: ArtifactKey[] = [];
  while (out.length < n && pool.length > 0) {
    const rarities = (['common', 'uncommon', 'rare'] as const).filter((r) => pool.some((k) => ARTIFACTS[k].rarity === r));
    const total = rarities.reduce((t, r) => t + weights[r], 0);
    let roll = rng.int(total);
    const rarity = rarities.find((r) => (roll -= weights[r]) < 0)!;
    const ofRarity = pool.filter((k) => ARTIFACTS[k].rarity === rarity);
    const pick = ofRarity[rng.int(ofRarity.length)]!;
    pool.splice(pool.indexOf(pick), 1);
    out.push(pick);
  }
  return out;
}

const STARTER_WEIGHTS: Record<ArtifactRarity, number> = { common: 1, uncommon: 0, rare: 0 };
const BOSS_REWARD_WEIGHTS: Record<ArtifactRarity, number> = { common: 0, uncommon: 25, rare: 5 };
const TASK_REWARD_WEIGHTS: Record<ArtifactRarity, number> = { common: 70, uncommon: 30, rare: 0 };

export interface LevelInfo {
  level: number;
  target: number;
  boss: boolean;
  rule: ReturnType<typeof bossRuleFor>;
}

/** 冲分模式下第 level 关的目标与首领规则，供路线页提前展示 */
export function levelInfo(run: RunState, level: number, config: EngineConfig = DEFAULT_CONFIG): LevelInfo {
  return { level, target: scoreTarget(level, config), boss: isBossLevel(level), rule: bossRuleFor(run.seed, level) };
}

export function newRun(seed: number, config: EngineConfig = DEFAULT_CONFIG, route: RouteNode[] = FULL_ROUTE): RunState {
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
    starterChoices: sampleArtifacts(offeredArtifacts(config.scoreMode), 3, STARTER_WEIGHTS, mixSeed(seed, 0x5)),
    income: null,
    artifactChoices: [],
    outcome: 'ongoing',
    totalScore: 0,
    endless: false,
    items: [],
    shopItems: [],
    shopArtifacts: [],
    lostArtifacts: [],
  };
}

export function pickStarter(prev: RunState, key: ArtifactKey): RunResult {
  if (prev.phase !== 'starter' || !prev.starterChoices.includes(key)) return fail(prev, '不在开局印记选择中');
  const run = clone(prev);
  run.artifacts.push(key);
  run.starterChoices = [];
  run.phase = 'map';
  return { ok: true, run };
}

/** 从路线页进入下一场战斗；进入后棋盘布局锁定 */
/** 第 level 关开关前的两条任务候选（一易一难）；按局种子固定，路线页与开关共用 */
export function levelTasks(run: RunState, level: number, config: EngineConfig = DEFAULT_CONFIG): [TaskDef, TaskDef] {
  // 首领规则会让某些任务做不到：“低压”倍率封顶 ×3，不出倍率任务（持有免检章时规则无效，照常）
  const rule = run.artifacts.includes('exemption') ? null : bossRuleFor(run.seed, level);
  return taskOptions(run.seed, level, scoreTarget(level, config), rule === 'lowCap' ? ['mult'] : []);
}

/** 从路线页开始下一关；taskIndex 为选中的任务（0 易、1 难） */
export function startNextBattle(prev: RunState, config: EngineConfig = DEFAULT_CONFIG, taskIndex: 0 | 1 = 0): RunResult {
  if (prev.phase !== 'map') return fail(prev, '只能从路线页开始战斗');
  const run = clone(prev);
  run.battleIndex++;
  const task = config.scoreMode ? levelTasks(run, run.battleIndex, config)[taskIndex] : undefined;
  const node = current(run);
  const info = config.scoreMode ? levelInfo(run, run.battleIndex, config) : null;
  run.battle = startBattle(
    {
      seed: mixSeed(run.seed, 0xb, run.battleIndex),
      player: config.playerShieldCarryOver ? run.player : { ...run.player, shield: 0 },
      enemy: info ? { ...node.enemy, targetScore: info.target } : node.enemy,
      artifacts: run.artifacts,
      levels: run.levels,
      gold: run.gold,
      ...(task ? { task } : {}),
      // 免检章：首领规则对你无效
      ...(info?.rule && !run.artifacts.includes('exemption') ? { rule: info.rule } : {}),
    },
    config,
  );
  run.phase = 'battle';
  return { ok: true, run };
}

export function runAction(prev: RunState, action: Action, config: EngineConfig = DEFAULT_CONFIG): RunResult & { log?: ActionLog; drop?: ItemKey } {
  if (prev.phase !== 'battle' || !prev.battle) return fail(prev, '当前不在战斗中');
  const out = playerAction(prev.battle, action, config);
  if (!out.ok) return fail(prev, out.reason);
  const run = clone(prev);
  run.battle = out.state;
  const drop = dropItem(run, out.log, config);
  settleBattle(run, config);
  return { ok: true, run, log: out.log, ...(drop ? { drop } : {}) };
}

/**
 * 道具掉落（2026-10-06）：这一步做出了五连炸弹，或连锁达到 8 层以上，步末往背包放一件随机道具。
 * 每步最多一件、每关最多 ITEM_PARAMS.dropsPerLevel 件，背包满了不掉；在结算之外发生，不影响本步得分。
 */
function dropItem(run: RunState, log: ActionLog, config: EngineConfig): ItemKey | null {
  const b = run.battle!;
  if (!config.scoreMode || (b.itemDrops ?? 0) >= ITEM_PARAMS.dropsPerLevel || run.items.length >= config.itemSlots) return null;
  const ev = log.result.events;
  const madeColor = ev.some((e) => e.type === 'matches' && e.created.some((c) => c.bomb === 'CB'));
  const chain = ev.filter((e) => e.type === 'matches' && e.phase === 'passive').length;
  if (!madeColor && chain < ITEM_PARAMS.dropChain) return null;
  b.itemDrops = (b.itemDrops ?? 0) + 1;
  const key = sample(ITEM_KEYS, 1, mixSeed(run.seed, 0xd7, run.battleIndex, b.itemDrops, b.stepsTaken ?? 0))[0]!;
  run.items.push(key);
  return key;
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
  // 关内用掉的神器（替身）从整局里移除
  const spent = b.spentArtifacts ?? [];
  run.artifacts = run.artifacts.filter((k) => !spent.includes(k));
  if (b.outcome === 'lost') {
    run.player = b.player;
    run.phase = 'over';
    run.outcome = 'lost';
    return;
  }
  // 关后保留生命；护盾按配置决定是否带入下一关
  run.player = config.playerShieldCarryOver ? b.player : { ...b.player, shield: 0 };
  const node = current(run);
  // 冲分模式：未达标（按差距扣过血）的关没有剩余步数，也照发底薪；首领关（精英位与终关）多给
  const steps = b.goal && b.totalScore >= b.goal.target ? stepsLeft(b, config) : 0;
  const income: Income = {
    base: config.goldBase,
    elite: node.tier === 'elite' || node.tier === 'boss' ? config.goldEliteBonus : 0,
    steps,
    fromSteps: steps * config.goldPerStep,
    artifacts: artifactIncome(run, b),
    task: 0,
    total: 0,
  };
  run.taskResult = settleTask(run, b, steps, node.tier !== 'minion', config);
  income.task = run.taskResult?.gold ?? 0;
  income.total = income.base + income.elite + income.fromSteps + income.task + income.artifacts.reduce((n, a) => n + a.amount, 0);
  run.gold += income.total;
  run.income = income;
  run.lostArtifacts = [...spent];
  if (b.rule?.key !== 'silence') {
    // 勋章：提前 3 步以上达标，永久倍率 +0.2
    if (run.artifacts.includes('medal') && steps >= ARTIFACT_PARAMS.medalSteps) {
      const c = (run.player.counters ??= {});
      c.medal = (c.medal ?? 0) + 1;
    }
    meltIceCream(run);
  }
  rotArtifacts(run, b);
  // 终关：通关，本局结束；冲分模式可以选择继续进入无尽模式（continueEndless）
  if (node.tier === 'boss') {
    run.phase = 'over';
    run.outcome = 'won';
    return;
  }
  if (node.tier === 'elite') {
    const pool = offeredArtifacts(config.scoreMode).filter((k) => !run.artifacts.includes(k));
    run.artifactChoices = sampleArtifacts(pool, 3, BOSS_REWARD_WEIGHTS, mixSeed(run.seed, 0xe, run.battleIndex));
    if (run.artifactChoices.length) run.phase = 'artifact';
    else enterShop(run, config);
  } else {
    enterShop(run, config);
  }
}

/**
 * 判定本关任务并发奖励（没达标也照发）：易任务给金币（首领关多给），难任务给一件随机神器（普通 70、罕见 30，不重复），
 * 神器栏满时改给金币。速通与轻装只能在达标时完成。
 */
function settleTask(run: RunState, b: BattleState, steps: number, boss: boolean, config: EngineConfig): TaskResult | null {
  if (!b.task) return null;
  const task = b.task;
  if (b.goal && b.totalScore >= b.goal.target) finishTask(task, steps);
  const result: TaskResult = { def: task.def, done: task.done, progress: task.progress, gold: 0 };
  if (!task.done) return result;
  if (task.def.tier === 'easy') {
    result.gold = boss ? config.taskGoldBoss : config.taskGold;
    return result;
  }
  const pool = offeredArtifacts(config.scoreMode).filter((k) => !run.artifacts.includes(k));
  const [pick] = run.artifacts.length < config.artifactSlots ? sampleArtifacts(pool, 1, TASK_REWARD_WEIGHTS, mixSeed(run.seed, 0x7a5d, run.battleIndex)) : [];
  if (pick) {
    run.artifacts.push(pick);
    result.artifact = pick;
  } else {
    result.artifact = null;
    result.gold = config.taskFullGold;
  }
  return result;
}

/**
 * 金币类神器在关卡结束时的收入：存钱罐按结算前手上的金币算利息，拆弹工按棋盘上剩的炸弹，金怀表固定。
 * “哑火”关里神器失效，不给。
 */
function artifactIncome(run: RunState, b: BattleState): Income['artifacts'] {
  if (b.rule?.key === 'silence') return [];
  const P = ARTIFACT_PARAMS;
  const out: Income['artifacts'] = [];
  const add = (key: ArtifactKey, amount: number) => amount > 0 && out.push({ key, amount });
  if (run.artifacts.includes('piggyBank')) add('piggyBank', Math.min(P.piggyMax, Math.floor(run.gold / P.piggyPer)));
  if (run.artifacts.includes('defuser')) add('defuser', Math.min(P.defuserMax, b.board.flat().filter((t) => t?.kind === 'bomb').length));
  if (run.artifacts.includes('goldWatch')) add('goldWatch', P.goldWatchGold);
  return out;
}

/** 冰淇淋每过一关少一截，减到 0 就消失 */
function meltIceCream(run: RunState): void {
  if (!run.artifacts.includes('iceCream')) return;
  const c = (run.player.counters ??= {});
  c.iceCream = (c.iceCream ?? 0) + ARTIFACT_PARAMS.iceCreamMelt;
  if (c.iceCream >= ARTIFACT_PARAMS.iceCreamBase) {
    run.artifacts = run.artifacts.filter((k) => k !== 'iceCream');
    delete c.iceCream;
    run.lostArtifacts.push('iceCream');
  }
}

/** 关卡结束时会消失的神器：香蕉每关有 1/6 的概率烂掉；“哑火”关里神器失效，不会烂 */
function rotArtifacts(run: RunState, b: BattleState): void {
  if (!run.artifacts.includes('banana') || b.rule?.key === 'silence') return;
  const rng = createRng(mixSeed(run.seed, 0xba, run.battleIndex));
  if (rng.int(ARTIFACT_PARAMS.bananaOdds) === 0) {
    run.artifacts = run.artifacts.filter((k) => k !== 'banana');
    run.lostArtifacts.push('banana');
  }
}

/** 进商店：按局种子与关卡序号随机上架几种道具，并按稀有度权重上架没有持有的神器 */
function enterShop(run: RunState, config: EngineConfig): void {
  run.rerolls = 0;
  stockShop(run, config);
  run.phase = 'shop';
}

/** 摆货架：第几次刷新也混进种子，同一局同一次刷新结果固定 */
function stockShop(run: RunState, config: EngineConfig): void {
  const n = run.rerolls ?? 0;
  const salt = n ? [n] : [];
  run.shopItems = sample(ITEM_KEYS, config.itemsPerShop, mixSeed(run.seed, 0x17e, run.battleIndex, ...salt));
  const pool = offeredArtifacts(config.scoreMode).filter((k) => !run.artifacts.includes(k));
  run.shopArtifacts = sampleArtifacts(pool, config.artifactsPerShop, config.artifactShopWeights, mixSeed(run.seed, 0x5a, run.battleIndex, ...salt));
}

/** 下一次刷新商店的价格 */
export const rerollPrice = (run: RunState, config: EngineConfig = DEFAULT_CONFIG): number => config.rerollPrice + config.rerollPriceStep * (run.rerolls ?? 0);

/** 付费刷新商店：神器和道具两排货架一起重抽（升级与回血不变） */
export function rerollShop(prev: RunState, config: EngineConfig = DEFAULT_CONFIG): RunResult {
  if (prev.phase !== 'shop') return fail(prev, '不在商店');
  const price = rerollPrice(prev, config);
  if (prev.gold < price) return fail(prev, '金币不足');
  const run = clone(prev);
  run.gold -= price;
  run.rerolls = (run.rerolls ?? 0) + 1;
  stockShop(run, config);
  return { ok: true, run };
}

export function chooseArtifact(prev: RunState, key: ArtifactKey, config: EngineConfig = DEFAULT_CONFIG): RunResult {
  if (prev.phase !== 'artifact' || !prev.artifactChoices.includes(key)) return fail(prev, '无效的印记候选');
  if (prev.artifacts.length >= config.artifactSlots) return fail(prev, '印记栏已满');
  const run = clone(prev);
  run.artifacts.push(key);
  run.artifactChoices = [];
  enterShop(run, config);
  return { ok: true, run };
}

/** 首领奖励一件都不要（神器栏满了又不想卖时） */
export function skipArtifact(prev: RunState, config: EngineConfig = DEFAULT_CONFIG): RunResult {
  if (prev.phase !== 'artifact') return fail(prev, '不在印记选择中');
  const run = clone(prev);
  run.artifactChoices = [];
  enterShop(run, config);
  return { ok: true, run };
}

/** 买下商店里第 index 件上架的神器 */
export function buyArtifact(prev: RunState, index: number, config: EngineConfig = DEFAULT_CONFIG): RunResult {
  if (prev.phase !== 'shop') return fail(prev, '不在商店');
  const key = prev.shopArtifacts[index];
  if (!key) return fail(prev, '没有这枚印记');
  if (prev.artifacts.length >= config.artifactSlots) return fail(prev, '印记栏已满');
  const price = artifactPrice(key, config);
  if (prev.gold < price) return fail(prev, '金币不足');
  const run = clone(prev);
  run.gold -= price;
  run.artifacts.push(key);
  run.shopArtifacts.splice(index, 1);
  return { ok: true, run };
}

/** 卖掉持有的一件神器，得半价；在商店和首领奖励时都可以卖 */
export function sellArtifact(prev: RunState, key: ArtifactKey, config: EngineConfig = DEFAULT_CONFIG): RunResult {
  if (prev.phase !== 'shop' && prev.phase !== 'artifact') return fail(prev, '只能在商店或领奖时卖印记');
  if (!prev.artifacts.includes(key)) return fail(prev, '没有这枚印记');
  const run = clone(prev);
  run.artifacts = run.artifacts.filter((k) => k !== key);
  run.gold += artifactSellPrice(key, config);
  if (key in (run.player.counters ?? {})) delete run.player.counters![key];
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

/** 通关后继续：进入无尽模式，先去商店花掉终关的收入，之后每关目标按倍数上涨，直到生命耗尽 */
export function continueEndless(prev: RunState, config: EngineConfig = DEFAULT_CONFIG): RunResult {
  if (prev.phase !== 'over' || prev.outcome !== 'won' || prev.endless) return fail(prev, '只能在通关后继续');
  const run = clone(prev);
  run.endless = true;
  run.outcome = 'ongoing';
  enterShop(run, config);
  return { ok: true, run };
}

/** 关内使用背包第 slot 件道具；用手套、吸管、回声直接达标时和普通一步一样结算本关 */
export function runUseItem(
  prev: RunState,
  slot: number,
  use: ItemUse,
  config: EngineConfig = DEFAULT_CONFIG,
): RunResult & { log?: ActionLog | null; events?: ResolutionEvent[]; gained?: number; drop?: ItemKey } {
  if (prev.phase !== 'battle' || !prev.battle) return fail(prev, '当前不在关卡中');
  if (prev.items[slot] !== use.key) return fail(prev, '背包里没有这件道具');
  const out = useItem(prev.battle, use, config);
  if (!out.ok) return fail(prev, out.reason);
  const run = clone(prev);
  run.items.splice(slot, 1);
  run.battle = out.state;
  const drop = out.log ? dropItem(run, out.log, config) : null;
  settleBattle(run, config);
  return { ok: true, run, log: out.log, events: out.events, ...(out.gained ? { gained: out.gained } : {}), ...(drop ? { drop } : {}) };
}

export function leaveShop(prev: RunState): RunResult {
  if (prev.phase !== 'shop') return fail(prev, '不在商店');
  const run = clone(prev);
  run.income = null;
  run.shopItems = [];
  run.shopArtifacts = [];
  run.lostArtifacts = [];
  run.taskResult = null;
  if (!run.endless && run.battleIndex >= run.route.length) {
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
