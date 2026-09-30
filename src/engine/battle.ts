// 一场战斗的状态与回合流程，规则见 docs/GAME_RULES.md §1、§3、§4 与 docs/ENEMY_DESIGN.md。
// 所有函数都是纯函数：输入旧状态，返回新状态与日志；状态可直接序列化存档。
import { ARTIFACT_PARAMS, ARTIFACTS, type ArtifactKey } from './artifacts';
import { addDetonations, BOMB_UPGRADES, defaultLevels, initialBombHeat, type BombHeat, type BombUpgrade, type UpgradeLevels } from './upgrades';
import { createBoard, createIdGen, weightedSpawner } from './board';
import { CARD_DEFS, cardBonus, drawCards, shuffle, type CardInstance, type CardPiles } from './cards';
import { isRotationOf } from './inserts';
import { DEFAULT_CONFIG, type EngineConfig } from './config';
import type { InstalledInsert } from './inserts';
import { resolveAction, type ActionResult } from './resolve';
import { hasLegalMove, reshuffle } from './shuffle';
import { createRng } from './rng';
import { settle, type Settlement } from './score';
import { COLORS, emptyClears, type Action, type BombKind, type Board, type ClearsByType, type Color, type Gravity, type Pos } from './types';

export const RULES_VERSION = 3;

/** 状态必须可序列化存档；用 JSON 往返复制，也顺带保证了这一点 */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// ---- 敌人意图 ----

export type IntentPart =
  /** pierce：穿刺，其中一部分（pierceRatio）无视护盾直接扣生命 */
  | { kind: 'attack'; amount: number; pierce?: boolean }
  | { kind: 'defend'; amount: number }
  /** 蓄力：下次攻击 +amount */
  | { kind: 'charge'; amount: number }
  /** 倍率侵蚀：下一玩家回合首次主动消除的倍率降一档 */
  | { kind: 'erodeMultiplier' }
  /** 嵌片压制：目标在意图展示时固定 */
  | { kind: 'suppressInsert'; targetId?: string }
  /** 重力反转为向上 */
  | { kind: 'gravityUp' }
  /** 色封：目标颜色在意图展示时固定（玩家等级最高的方块颜色），下一玩家回合该色方块等级视为 1 */
  | { kind: 'sealColor'; color?: Color }
  /** 石化：目标行在意图展示时固定，敌人行动时把该行 count 个普通方块变成石块 */
  | { kind: 'petrify'; count: number; row?: number }
  /** 碎甲：下一玩家回合主角护盾上限降为 playerShieldCap × shatterCapRatio */
  | { kind: 'shatter' }
  /** 强化：此后每次攻击永久 +amount，可叠加（被眩晕取消的回合不强化） */
  | { kind: 'empower'; amount: number };

export interface Intent {
  parts: IntentPart[];
}

export interface EnemyDef {
  id: string;
  name: string;
  maxHp: number;
  /** 循环执行的意图脚本 */
  script: Intent[];
  /** 嵌片压制找不到目标、或脚本只剩不可用意图时改用的防御值 */
  fallbackDefend: number;
  /** 冲分模式的目标分 */
  targetScore?: number;
}

export interface PlayerState {
  hp: number;
  maxHp: number;
  shield: number;
  catalystCharges: number;
  /** 累加触发类神器的进度，跨战斗保留 */
  counters?: Partial<Record<ArtifactKey, number>>;
}

export interface EnemyState {
  def: EnemyDef;
  hp: number;
  shield: number;
  /** 毒气控制进度 */
  poison: number;
  /** 已挂上、将在敌人回合取消意图的眩晕 */
  stunPending: boolean;
  /** 本玩家回合是否已挂过眩晕；挂过后本回合的毒气不再积累 */
  stunnedThisTurn: boolean;
  /** 蓄力累积的下次攻击加成 */
  chargeBonus: number;
  /** 强化累积的永久攻击加成；旧存档没有此字段，按 0 处理 */
  strength: number;
  scriptIndex: number;
  intent: Intent;
}

export interface BattleState {
  rulesVersion: number;
  rngState: number;
  nextId: number;
  board: Board;
  /** 战斗中布局锁定 */
  inserts: InstalledInsert[];
  /** 持有的神器，整局持续生效 */
  artifacts: ArtifactKey[];
  /** 方块与炸弹的升级等级，战斗中不变 */
  levels: UpgradeLevels;
  /** 本场的爆破等级：从炸弹升级等级开始，越炸越高，每场重置 */
  bombHeat: BombHeat;
  player: PlayerState;
  enemy: EnemyState;
  turn: number;
  ap: number;
  gravity: Gravity;
  /** 向上重力剩余的玩家回合数；0 表示未生效 */
  gravityTurnsLeft: number;
  /** 敌人本回合成功施加、从下一玩家回合起生效的状态 */
  pending: { erosion: boolean; suppressId: string | null; gravity: boolean; sealColor: Color | null; shatter?: boolean };
  /** 本玩家回合生效中的状态；shattered 为碎甲（护盾上限降低） */
  current: { erosionArmed: boolean; suppressedId: string | null; sealedColor: Color | null; shattered?: boolean; fuseBoxFired?: boolean };
  outcome: 'ongoing' | 'won' | 'lost';
  totalScore: number;
  /** 嵌片卡模式：抽牌堆、手牌、弃牌堆；交换模式下不存在 */
  cards?: CardPiles;
  /** 冲分模式：在 turns 个回合内让 totalScore 达到 target；敌人不行动 */
  goal?: { target: number; turns: number };
}

export interface StartBattleInput {
  seed: number;
  player: PlayerState;
  enemy: EnemyDef;
  inserts?: InstalledInsert[];
  artifacts?: ArtifactKey[];
  levels?: UpgradeLevels;
  /** 嵌片卡模式的牌组；提供时进入卡牌模式，不能再交换或点燃 */
  deck?: CardInstance[];
  /** 事件等给敌人的初始护盾 */
  enemyStartShield?: number;
}

// ---- 日志 ----

export interface ActionLog {
  result: ActionResult;
  settlement: Settlement | null;
  damageToEnemyShield: number;
  damageToEnemyHp: number;
  shieldGained: number;
  poisonAdded: number;
  stunApplied: boolean;
  erosionConsumed: boolean;
  /** 本步结算后升级的爆破等级类别（每升一级记一次）；新等级从下一次行动起生效 */
  bombLevelUps: BombUpgrade[];
  /** 本步结束时触发的累加神器 */
  counterTriggers: CounterTrigger[];
}

export type CounterTrigger =
  | { key: 'fuseBox'; ap: number }
  | { key: 'aftershockCore'; at: Pos | null };

export interface EnemyTurnLog {
  cancelledByStun: boolean;
  executed: IntentPart[];
  damageToPlayerShield: number;
  damageToPlayerHp: number;
  poisonDecayed: number;
  /** 反应线圈的反击伤害 */
  counterDamage: number;
  /** 石化：本回合被变成石块的格 */
  petrified: Pos[];
  /** 石化后无步可走而自动重排了棋盘 */
  reshuffled: boolean;
  /** 冲分模式：回合用完仍未达标时扣的生命（已计入 damageToPlayerHp） */
  scorePenalty?: number;
  /** 下一玩家回合开始时，神器放到棋盘上的炸弹 */
  turnStartBombs?: Pos[];
  nextIntent: Intent;
}

// ---- 流程 ----

export function startBattle(input: StartBattleInput, config: EngineConfig = DEFAULT_CONFIG): BattleState {
  const rng = createRng(input.seed);
  const ids = createIdGen();
  let board = createBoard(rng, ids, config);
  if (!hasLegalMove(board)) board = reshuffle(board, rng, config).board;
  const state: BattleState = {
    rulesVersion: RULES_VERSION,
    rngState: rng.state,
    nextId: ids.peek,
    board,
    inserts: clone(input.inserts ?? []),
    artifacts: [...(input.artifacts ?? [])],
    levels: { ...defaultLevels(), ...input.levels },
    bombHeat: initialBombHeat({ ...defaultLevels(), ...input.levels }),
    player: clone(input.player),
    enemy: {
      def: input.enemy,
      hp: input.enemy.maxHp,
      shield: input.enemyStartShield ?? 0,
      poison: 0,
      stunPending: false,
      stunnedThisTurn: false,
      chargeBonus: 0,
      strength: 0,
      scriptIndex: 0,
      intent: { parts: [] },
    },
    turn: 1,
    ap: config.apPerTurn,
    gravity: 'down',
    gravityTurnsLeft: 0,
    pending: { erosion: false, suppressId: null, gravity: false, sealColor: null },
    current: { erosionArmed: false, suppressedId: null, sealedColor: null },
    outcome: 'ongoing',
    totalScore: 0,
  };
  if (config.scoreMode && input.enemy.targetScore) state.goal = { target: input.enemy.targetScore, turns: config.scoreTurns };
  applyTurnStartArtifacts(state);
  if (input.deck) {
    // 洗牌与抽牌沿用同一个种子随机数，保证复现
    const cardRng = createRng(state.rngState);
    state.cards = { draw: shuffle(clone(input.deck), cardRng), hand: [], discard: [] };
    drawCards(state.cards, config.drawPerTurn, config.handLimit, cardRng);
    state.rngState = cardRng.state;
  }
  revealNextIntent(state, config);
  return state;
}

/** 嵌片卡模式的行动：打出手牌中第 index 张，覆盖 cells */
export type PlayCardAction = { type: 'playCard'; index: number; cells: Pos[] };
export type BattleAction = Action | PlayCardAction;

export type PlayerActionOutcome =
  | { ok: true; state: BattleState; log: ActionLog }
  | { ok: false; state: BattleState; reason: 'battleOver' | 'noAp' | 'cardMode' | 'noCard' | 'badShape' | NonNullable<ActionResult['reason']> };

/** 玩家的一次交换或点燃：结算、施加效果、扣 AP。击杀立即结束战斗。 */
export function playerAction(prev: BattleState, input: BattleAction, config: EngineConfig = DEFAULT_CONFIG): PlayerActionOutcome {
  if (prev.outcome !== 'ongoing') return { ok: false, state: prev, reason: 'battleOver' };

  // 卡牌模式只接受打出卡片；把卡片换算成一次“按形状清除”的结算
  let action: Action;
  let cost = 1;
  let played: CardInstance | null = null;
  if (input.type === 'playCard') {
    const card = prev.cards?.hand[input.index];
    if (!card) return { ok: false, state: prev, reason: 'noCard' };
    cost = CARD_DEFS[card.defId]!.cost;
    if (!isRotationOf(card.cells, input.cells)) return { ok: false, state: prev, reason: 'badShape' };
    const bonus = cardBonus(card);
    action = { type: 'play', cells: input.cells, ...(bonus ? { bonus } : {}) };
    played = card;
  } else {
    if (prev.cards) return { ok: false, state: prev, reason: 'cardMode' };
    action = input;
  }
  if (prev.ap < cost) return { ok: false, state: prev, reason: 'noAp' };

  const state = clone(prev);
  const rng = createRng(state.rngState);
  const ids = createIdGen(state.nextId);
  const inserts = state.inserts.map((i) => (i.id === state.current.suppressedId ? { ...i, suppressed: true } : i));
  const result = resolveAction(state.board, action, {
    config,
    rng,
    ids,
    spawn: weightedSpawner(rng, config),
    gravity: state.gravity,
    inserts,
    artifacts: state.artifacts,
    levels: state.levels,
    // 色封：本回合被封颜色的方块等级视为 1
    sealedColor: state.current.sealedColor,
    bombLevels: Object.fromEntries(BOMB_UPGRADES.map((k) => [k, state.bombHeat[k].level])) as Record<BombUpgrade, number>,
  });
  if (!result.valid) return { ok: false, state: prev, reason: result.reason! };

  state.board = result.board;
  state.rngState = rng.state;
  state.nextId = ids.peek;
  state.ap -= played ? cost : result.apSpent;
  if (played && state.cards) {
    state.cards.hand.splice(input.type === 'playCard' ? input.index : 0, 1);
    state.cards.discard.push(played);
  }

  const log: ActionLog = {
    result,
    settlement: null,
    damageToEnemyShield: 0,
    damageToEnemyHp: 0,
    shieldGained: 0,
    poisonAdded: 0,
    stunApplied: false,
    erosionConsumed: false,
    bombLevelUps: [],
    counterTriggers: [],
  };

  // 爆破等级：本步的引爆在结算完之后计入，新等级从下一次行动起生效
  const heat = addDetonations(state.bombHeat, result.detonatedByType, config);
  state.bombHeat = heat.heat;
  log.bombLevelUps = heat.levelUps;

  // 没有任何清除（未消除交换）时不结算
  const anyClear = result.hadActiveColorClear || result.passiveClearCount > 0 || result.events.some((e) => e.type === 'wave');
  if (anyClear) {
    // 倍率侵蚀只由本回合首次主动清除有色方块的行动承担
    const erode = state.current.erosionArmed && result.hadActiveColorClear;
    if (erode) state.current.erosionArmed = false;
    // 倍率修正顺序：不稳定引信修正 P → 基础倍率 → 连锁透镜 → 共振底座 → 敌方倍率侵蚀（GAME_RULES §6）
    const has = (k: ArtifactKey) => state.artifacts.includes(k);
    const P = result.passiveClearCount;
    const stepDelta = has('chainLens') && P >= 3 ? 1 : 0;
    const s = settle(
      {
        activeClearsByType: result.activeClearsByType,
        passiveClearCount: P,
        hadActiveColorClear: result.hadActiveColorClear,
        // 冲分模式没有催化剂充能（颜色不再有各自的作用）
        chargesBefore: state.goal ? 0 : state.player.catalystCharges,
        socketBonuses: result.socketBonuses,
        multiplierStepDelta: stepDelta,
        erosionSteps: erode ? 1 : 0,
      },
      config,
    );
    log.settlement = s;
    log.erosionConsumed = erode;
    if (!state.goal) state.player.catalystCharges = s.chargesAfter;
    state.totalScore += s.settlementScore;
    // 冲分模式只累计结算分，达到目标立即过关；攻击、护盾、毒气不生效
    if (state.goal) {
      if (state.totalScore >= state.goal.target) state.outcome = 'won';
    } else {
      applyPlayerEffects(state, s, log, config);
    }
  }
  if (state.outcome === 'ongoing') applyCounterArtifacts(state, result, log, config);
  return { ok: true, state, log };
}

/**
 * 累加触发类神器：本步结算完成后累加进度，达到门槛就在本步结束时触发，每步每件最多一次，多余进度留到下次。
 * 效果都发生在结算之外（加行动力、直接伤害、往稳定的棋盘上放炸弹），不会引发新的结算。
 */
function applyCounterArtifacts(state: BattleState, result: ActionResult, log: ActionLog, config: EngineConfig): void {
  const counters = (state.player.counters ??= {});
  const gains: Partial<Record<ArtifactKey, number>> = {
    fuseBox: result.detonatedByType.line + result.detonatedByType.area + result.detonatedByType.color,
    aftershockCore: result.passiveClearCount,
  };
  // 同一时机按神器 ID 顺序结算
  for (const key of ['fuseBox', 'aftershockCore'] as const) {
    if (!state.artifacts.includes(key)) continue;
    const every = ARTIFACTS[key].every!;
    counters[key] = (counters[key] ?? 0) + (gains[key] ?? 0);
    if (counters[key]! < every) continue;
    if (key === 'fuseBox') {
      // 每回合最多一次；本回合已触发时进度保留，下回合的行动再触发
      if (state.current.fuseBoxFired) continue;
      state.current.fuseBoxFired = true;
      state.ap += ARTIFACT_PARAMS.fuseBoxAp;
      log.counterTriggers.push({ key, ap: ARTIFACT_PARAMS.fuseBoxAp });
    } else {
      log.counterTriggers.push({ key, at: placeBombOnRandomTile(state, 'A') });
    }
    counters[key]! -= every;
    if (state.outcome !== 'ongoing') return;
  }
}

/** 把棋盘上按种子选出的一个普通方块变成炸弹；炸弹不参与匹配，稳定棋盘放下后仍然稳定 */
function placeBombOnRandomTile(state: BattleState, bomb: BombKind): Pos | null {
  const cells: Pos[] = [];
  state.board.forEach((row, r) => row.forEach((t, c) => t?.kind === 'normal' && cells.push({ r, c })));
  if (cells.length === 0) return null;
  const rng = createRng(state.rngState);
  const at = cells[rng.int(cells.length)]!;
  state.rngState = rng.state;
  state.board[at.r]![at.c] = { id: state.nextId++, kind: 'bomb', bomb };
  return at;
}

function applyPlayerEffects(state: BattleState, s: Settlement, log: ActionLog, config: EngineConfig): void {
  const { attack, shield, poison } = s.finalEffects;
  // 护盾增加至上限（碎甲时上限降低）
  const before = state.player.shield;
  state.player.shield = Math.max(before, Math.min(playerShieldCap(state, config), before + shield));
  log.shieldGained = state.player.shield - before;
  // 攻击先扣敌人护盾再扣生命
  const hit = damageEnemy(state, attack);
  log.damageToEnemyShield = hit.toShield;
  log.damageToEnemyHp = hit.toHp;
  if (state.outcome === 'won') return;
  // 毒气：一回合至多挂一次眩晕，挂上后本回合的毒气不再积累
  if (poison > 0 && !state.enemy.stunnedThisTurn) {
    state.enemy.poison += poison;
    log.poisonAdded = poison;
    const threshold = poisonThreshold(state.enemy.def.maxHp, config);
    if (state.enemy.poison >= threshold) {
      state.enemy.stunPending = true;
      state.enemy.stunnedThisTurn = true;
      // 密封毒瓶：眩晕后保留一部分进度，仍低于阈值
      state.enemy.poison = 0;
      log.stunApplied = true;
    }
  }
}

/** 冲分模式里还没用掉的步数（本回合剩余 + 之后各回合）；打怪模式为 0 */
export function stepsLeft(state: BattleState, config: EngineConfig = DEFAULT_CONFIG): number {
  if (!state.goal) return 0;
  return Math.max(0, state.ap + (state.goal.turns - state.turn) * config.apPerTurn);
}

/** 本玩家回合的护盾上限：碎甲生效时按比例降低 */
export function playerShieldCap(state: BattleState, config: EngineConfig = DEFAULT_CONFIG): number {
  return state.current.shattered ? Math.floor(config.playerShieldCap * config.shatterCapRatio) : config.playerShieldCap;
}

/** 敌人一次攻击的实际数值：基础 + 蓄力 + 强化 */
export function attackAmount(enemy: EnemyState, base: number): number {
  return base + enemy.chargeBonus + (enemy.strength ?? 0);
}

/** 穿刺攻击中无视护盾的部分 */
export function piercedPart(amount: number, config: EngineConfig = DEFAULT_CONFIG): number {
  return Math.ceil(amount * config.pierceRatio);
}

/** 眩晕阈值随敌人最大生命变化 */
export function poisonThreshold(enemyMaxHp: number, config: EngineConfig = DEFAULT_CONFIG): number {
  return Math.max(1, Math.round(enemyMaxHp * config.poisonThresholdRatio));
}

/** 敌人回合末的毒气进度衰减量 */
export function poisonDecay(enemyMaxHp: number, config: EngineConfig = DEFAULT_CONFIG): number {
  return Math.max(1, Math.round(poisonThreshold(enemyMaxHp, config) * config.poisonDecayRatio));
}

/** 对敌人造成伤害：先扣护盾再扣生命。击杀时结束战斗。 */
function damageEnemy(state: BattleState, amount: number): { toShield: number; toHp: number } {
  const enemy = state.enemy;
  const toShield = Math.min(enemy.shield, amount);
  enemy.shield -= toShield;
  const toHp = Math.min(enemy.hp, amount - toShield);
  enemy.hp -= toHp;
  if (enemy.hp <= 0) state.outcome = 'won';
  return { toShield, toHp };
}

/** 对主角造成伤害：先扣护盾再扣生命；pierced 部分无视护盾直接扣生命。生命归零时失败。 */
function damagePlayer(state: BattleState, amount: number, pierced = 0): { toShield: number; toHp: number } {
  const toShield = Math.min(state.player.shield, amount - pierced);
  state.player.shield -= toShield;
  const toHp = Math.min(state.player.hp, amount - toShield);
  state.player.hp -= toHp;
  if (state.player.hp <= 0) state.outcome = 'lost';
  return { toShield, toHp };
}

/** 玩家结束回合：回合末结算 → 敌人回合 → 下一玩家回合开始。 */
export function endTurn(prev: BattleState, config: EngineConfig = DEFAULT_CONFIG): { state: BattleState; log: EnemyTurnLog | null } {
  if (prev.outcome !== 'ongoing') return { state: prev, log: null };
  const state = clone(prev);

  if (state.goal) return endScoreTurn(state, config);

  // 碎甲回合的护盾挡住的攻击不触发反应线圈；回合状态马上到期，先记下
  const shatteredTurn = !!state.current.shattered;
  // 1. 玩家回合结束：本回合生效的状态到期；向上重力扣减一回合（提前结束也计）；手牌进弃牌堆
  state.current = { erosionArmed: false, suppressedId: null, sealedColor: null, shattered: false };
  if (state.cards) {
    state.cards.discard.push(...state.cards.hand);
    state.cards.hand = [];
  }
  if (state.gravityTurnsLeft > 0) {
    state.gravityTurnsLeft--;
    if (state.gravityTurnsLeft === 0) state.gravity = 'down';
  }

  const enemy = state.enemy;
  const log: EnemyTurnLog = {
    cancelledByStun: false,
    executed: [],
    damageToPlayerShield: 0,
    damageToPlayerHp: 0,
    poisonDecayed: 0,
    counterDamage: 0,
    petrified: [],
    reshuffled: false,
    nextIntent: enemy.intent,
  };

  // 2. 敌人回合：眩晕取消整次意图，否则按部件顺序执行
  if (enemy.stunPending) {
    enemy.stunPending = false;
    log.cancelledByStun = true;
    // 被取消的攻击连带作废已累积的蓄力加成
    if (enemy.intent.parts.some((p) => p.kind === 'attack')) enemy.chargeBonus = 0;
  } else {
    for (const part of enemy.intent.parts) {
      executePart(state, part, log, config, shatteredTurn);
      if (state.outcome !== 'ongoing') return { state, log };
    }
  }

  // 石化可能让棋盘无步可走
  if (!hasLegalMove(state.board)) {
    const rng = createRng(state.rngState);
    state.board = reshuffle(state.board, rng, config).board;
    state.rngState = rng.state;
    log.reshuffled = true;
  }

  // 3. 回合末毒气衰减（被眩晕跳过意图的回合也衰减），再展示下一次意图
  const decayed = Math.min(enemy.poison, poisonDecay(enemy.def.maxHp, config));
  enemy.poison -= decayed;
  log.poisonDecayed = decayed;
  // 主角护盾在敌人行动之后按比例保留（默认全部保留）
  state.player.shield = Math.floor(state.player.shield * config.playerShieldRetain);
  revealNextIntent(state, config);
  log.nextIntent = enemy.intent;

  // 4. 下一玩家回合开始：施加敌人上回合成功施加的状态，AP 恢复
  state.turn++;
  state.ap = config.apPerTurn;
  if (state.cards) {
    const cardRng = createRng(state.rngState);
    drawCards(state.cards, config.drawPerTurn, config.handLimit, cardRng);
    state.rngState = cardRng.state;
  }
  enemy.stunnedThisTurn = false;
  if (state.pending.erosion) state.current.erosionArmed = true;
  if (state.pending.suppressId) state.current.suppressedId = state.pending.suppressId;
  if (state.pending.sealColor) state.current.sealedColor = state.pending.sealColor;
  if (state.pending.shatter) state.current.shattered = true;
  if (state.pending.gravity) {
    state.gravity = 'up';
    state.gravityTurnsLeft = config.gravityTurns;
  }
  log.turnStartBombs = applyTurnStartArtifacts(state);
  state.pending = { erosion: false, suppressId: null, gravity: false, sealColor: null, shatter: false };
  return { state, log };
}

/** 冲分模式的回合结束：敌人不行动；最后一回合结束仍未达标，按差距比例扣生命后过关（生命归零则失败） */
function endScoreTurn(state: BattleState, config: EngineConfig): { state: BattleState; log: EnemyTurnLog } {
  const log: EnemyTurnLog = {
    cancelledByStun: false,
    executed: [],
    damageToPlayerShield: 0,
    damageToPlayerHp: 0,
    poisonDecayed: 0,
    counterDamage: 0,
    petrified: [],
    reshuffled: false,
    nextIntent: state.enemy.intent,
  };
  state.current = { erosionArmed: false, suppressedId: null, sealedColor: null, shattered: false };
  const goal = state.goal!;
  if (state.turn >= goal.turns) {
    const shortfall = Math.max(0, goal.target - state.totalScore) / goal.target;
    const penalty = Math.ceil(state.player.maxHp * shortfall);
    const hurt = damagePlayer(state, penalty);
    log.damageToPlayerHp = hurt.toHp;
    log.scorePenalty = hurt.toHp;
    if (state.outcome === 'ongoing') state.outcome = 'won';
    return { state, log };
  }
  state.turn++;
  state.ap = config.apPerTurn;
  log.turnStartBombs = applyTurnStartArtifacts(state);
  return { state, log };
}

/** 玩家回合开始时生效的神器（开战的第一回合也算）；按 ID 顺序，返回放下炸弹的格 */
function applyTurnStartArtifacts(state: BattleState): Pos[] {
  const placed: Pos[] = [];
  const put = (bomb: BombKind) => {
    const at = placeBombOnRandomTile(state, bomb);
    if (at) placed.push(at);
  };
  if (state.artifacts.includes('powderKeg')) put('A');
  if (state.artifacts.includes('prismOre')) put('CB');
  return placed;
}

function executePart(state: BattleState, part: IntentPart, log: EnemyTurnLog, config: EngineConfig, shatteredTurn: boolean): void {
  const enemy = state.enemy;
  log.executed.push(part);
  switch (part.kind) {
    case 'attack': {
      const dmg = attackAmount(enemy, part.amount);
      enemy.chargeBonus = 0;
      const hurt = damagePlayer(state, dmg, part.pierce ? piercedPart(dmg, config) : 0);
      log.damageToPlayerShield += hurt.toShield;
      log.damageToPlayerHp += hurt.toHp;
      return;
    }
    case 'defend':
      enemy.shield += part.amount;
      return;
    case 'charge':
      enemy.chargeBonus += part.amount;
      return;
    case 'erodeMultiplier':
      state.pending.erosion = true;
      return;
    case 'suppressInsert':
      if (part.targetId) state.pending.suppressId = part.targetId;
      return;
    case 'gravityUp':
      state.pending.gravity = true;
      return;
    case 'sealColor':
      if (part.color) state.pending.sealColor = part.color;
      return;
    case 'petrify':
      if (part.row != null) log.petrified.push(...petrifyRow(state, part.row, part.count, config));
      return;
    case 'shatter':
      state.pending.shatter = true;
      return;
    case 'empower':
      enemy.strength = (enemy.strength ?? 0) + part.amount;
      return;
  }
}

export const stoneCount = (board: Board) => board.flat().filter((t) => t?.kind === 'stone').length;

/** 把指定行中按种子选出的普通方块变成石块，受棋盘石块上限约束；返回被石化的格 */
function petrifyRow(state: BattleState, row: number, count: number, config: EngineConfig): Pos[] {
  const room = Math.max(0, config.stoneCap - stoneCount(state.board));
  const cols: number[] = [];
  state.board[row]?.forEach((t, c) => t?.kind === 'normal' && cols.push(c));
  const rng = createRng(state.rngState);
  const picked: Pos[] = [];
  while (picked.length < Math.min(count, room) && cols.length > 0) picked.push({ r: row, c: cols.splice(rng.int(cols.length), 1)[0]! });
  state.rngState = rng.state;
  for (const p of picked) state.board[p.r]![p.c] = { id: state.nextId++, kind: 'stone' };
  return picked.sort((a, b) => a.c - b.c);
}

/**
 * 从脚本取下一次意图并在此刻固定所有目标。
 * 向上重力生效或已排定期间跳过重力反转意图；嵌片压制、色封、石化没有可用目标时改用防御。
 */
function revealNextIntent(state: BattleState, config: EngineConfig): void {
  const enemy = state.enemy;
  const script = enemy.def.script;
  const gravityBusy = state.gravityTurnsLeft > 0 || state.pending.gravity;
  let chosen: Intent | null = null;
  for (let tries = 0; tries < script.length; tries++) {
    const candidate = script[enemy.scriptIndex % script.length]!;
    enemy.scriptIndex++;
    if (gravityBusy && candidate.parts.some((p) => p.kind === 'gravityUp')) continue;
    chosen = candidate;
    break;
  }
  if (!chosen) {
    enemy.intent = { parts: [{ kind: 'defend', amount: enemy.def.fallbackDefend }] };
    return;
  }
  const rng = createRng(state.rngState);
  const targets = [...state.inserts].sort((a, b) => a.id.localeCompare(b.id));
  const parts: IntentPart[] = [];
  const fallback: IntentPart = { kind: 'defend', amount: enemy.def.fallbackDefend };
  for (const part of chosen.parts) {
    if (part.kind === 'suppressInsert') {
      parts.push(targets.length === 0 ? fallback : { kind: 'suppressInsert', targetId: targets[rng.int(targets.length)]!.id });
    } else if (part.kind === 'sealColor') {
      // 按种子封住一种颜色；方块基数还是 1 级时色封无效，改用防御
      parts.push(state.levels.block <= 1 ? fallback : { kind: 'sealColor', color: COLORS[rng.int(COLORS.length)]! });
    } else if (part.kind === 'petrify') {
      // 棋盘石块已达上限时改用防御，避免棋盘被堵死
      parts.push(stoneCount(state.board) >= config.stoneCap ? fallback : { ...part, row: rng.int(state.board.length) });
    } else {
      parts.push({ ...part });
    }
  }
  state.rngState = rng.state;
  enemy.intent = { parts };
}
