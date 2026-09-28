// 一场战斗的状态与回合流程，规则见 docs/GAME_RULES.md §1、§3、§4 与 docs/ENEMY_DESIGN.md。
// 所有函数都是纯函数：输入旧状态，返回新状态与日志；状态可直接序列化存档。
import { ARTIFACT_PARAMS, type ArtifactKey } from './artifacts';
import { createBoard, createIdGen, weightedSpawner } from './board';
import { DEFAULT_CONFIG, type EngineConfig } from './config';
import type { InstalledInsert } from './inserts';
import { resolveAction, type ActionResult } from './resolve';
import { createRng } from './rng';
import { settle, type Settlement } from './score';
import type { Action, Board, Gravity } from './types';

export const RULES_VERSION = 1;

/** 状态必须可序列化存档；用 JSON 往返复制，也顺带保证了这一点 */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// ---- 敌人意图 ----

export type IntentPart =
  | { kind: 'attack'; amount: number }
  | { kind: 'defend'; amount: number }
  /** 蓄力：下次攻击 +amount */
  | { kind: 'charge'; amount: number }
  /** 倍率侵蚀：下一玩家回合首次主动消除的倍率降一档 */
  | { kind: 'erodeMultiplier' }
  /** 嵌片压制：目标在意图展示时固定 */
  | { kind: 'suppressInsert'; targetId?: string }
  /** 重力反转为向上 */
  | { kind: 'gravityUp' };

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
}

export interface PlayerState {
  hp: number;
  maxHp: number;
  shield: number;
  catalystCharges: number;
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
  player: PlayerState;
  enemy: EnemyState;
  turn: number;
  ap: number;
  gravity: Gravity;
  /** 向上重力剩余的玩家回合数；0 表示未生效 */
  gravityTurnsLeft: number;
  /** 敌人本回合成功施加、从下一玩家回合起生效的状态 */
  pending: { erosion: boolean; suppressId: string | null; gravity: boolean; apBonus: number };
  /** 本玩家回合生效中的状态 */
  current: { erosionArmed: boolean; suppressedId: string | null };
  outcome: 'ongoing' | 'won' | 'lost';
  totalScore: number;
}

export interface StartBattleInput {
  seed: number;
  player: PlayerState;
  enemy: EnemyDef;
  inserts?: InstalledInsert[];
  artifacts?: ArtifactKey[];
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
}

export interface EnemyTurnLog {
  /** 不稳定引信：回合末留存炸弹对自己造成的伤害 */
  fuseDamageToShield: number;
  fuseDamageToHp: number;
  cancelledByStun: boolean;
  executed: IntentPart[];
  damageToPlayerShield: number;
  damageToPlayerHp: number;
  poisonDecayed: number;
  /** 反应线圈的反击伤害 */
  counterDamage: number;
  /** 回响钟：下一玩家回合额外获得的 AP */
  apBonusNext: number;
  nextIntent: Intent;
}

// ---- 流程 ----

export function startBattle(input: StartBattleInput, config: EngineConfig = DEFAULT_CONFIG): BattleState {
  const rng = createRng(input.seed);
  const ids = createIdGen();
  const board = createBoard(rng, ids, config);
  const state: BattleState = {
    rulesVersion: RULES_VERSION,
    rngState: rng.state,
    nextId: ids.peek,
    board,
    inserts: clone(input.inserts ?? []),
    artifacts: [...(input.artifacts ?? [])],
    player: clone(input.player),
    enemy: {
      def: input.enemy,
      hp: input.enemy.maxHp,
      shield: input.enemyStartShield ?? 0,
      poison: 0,
      stunPending: false,
      stunnedThisTurn: false,
      chargeBonus: 0,
      scriptIndex: 0,
      intent: { parts: [] },
    },
    turn: 1,
    ap: config.apPerTurn,
    gravity: 'down',
    gravityTurnsLeft: 0,
    pending: { erosion: false, suppressId: null, gravity: false, apBonus: 0 },
    current: { erosionArmed: false, suppressedId: null },
    outcome: 'ongoing',
    totalScore: 0,
  };
  revealNextIntent(state);
  return state;
}

export type PlayerActionOutcome =
  | { ok: true; state: BattleState; log: ActionLog }
  | { ok: false; state: BattleState; reason: 'battleOver' | 'noAp' | NonNullable<ActionResult['reason']> };

/** 玩家的一次交换或点燃：结算、施加效果、扣 AP。击杀立即结束战斗。 */
export function playerAction(prev: BattleState, action: Action, config: EngineConfig = DEFAULT_CONFIG): PlayerActionOutcome {
  if (prev.outcome !== 'ongoing') return { ok: false, state: prev, reason: 'battleOver' };
  if (prev.ap <= 0) return { ok: false, state: prev, reason: 'noAp' };

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
  });
  if (!result.valid) return { ok: false, state: prev, reason: result.reason! };

  state.board = result.board;
  state.rngState = rng.state;
  state.nextId = ids.peek;
  state.ap -= result.apSpent;

  const log: ActionLog = {
    result,
    settlement: null,
    damageToEnemyShield: 0,
    damageToEnemyHp: 0,
    shieldGained: 0,
    poisonAdded: 0,
    stunApplied: false,
    erosionConsumed: false,
  };

  // 没有任何清除（未消除交换）时不结算
  const anyClear = result.hadActiveColorClear || result.passiveClearCount > 0 || result.events.some((e) => e.type === 'wave');
  if (anyClear) {
    // 倍率侵蚀只由本回合首次主动清除有色方块的行动承担
    const erode = state.current.erosionArmed && result.hadActiveColorClear;
    if (erode) state.current.erosionArmed = false;
    // 倍率修正顺序：不稳定引信修正 P → 基础倍率 → 连锁透镜 → 共振底座 → 敌方倍率侵蚀（GAME_RULES §6）
    const has = (k: ArtifactKey) => state.artifacts.includes(k);
    const P = result.passiveClearCount + (has('unstableFuse') ? result.activeBombsDetonated : 0);
    const stepDelta = (has('chainLens') && P >= 3 ? 1 : 0) + (has('resonanceBase') && result.triggeredInsertIds.length >= 2 ? 1 : 0);
    const s = settle(
      {
        activeClearsByType: result.activeClearsByType,
        passiveClearCount: P,
        hadActiveColorClear: result.hadActiveColorClear,
        chargesBefore: state.player.catalystCharges,
        socketBonuses: result.socketBonuses,
        multiplierStepDelta: stepDelta,
        erosionSteps: erode ? 1 : 0,
        zeroShieldEffect: result.overloadFired,
      },
      config,
    );
    log.settlement = s;
    log.erosionConsumed = erode;
    state.player.catalystCharges = s.chargesAfter;
    state.totalScore += s.settlementScore;
    applyPlayerEffects(state, s, log, config);
  }
  return { ok: true, state, log };
}

function applyPlayerEffects(state: BattleState, s: Settlement, log: ActionLog, config: EngineConfig): void {
  const { attack, shield, poison } = s.finalEffects;
  // 护盾增加至上限
  const before = state.player.shield;
  state.player.shield = Math.min(config.playerShieldCap, before + shield);
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
    if (state.enemy.poison >= config.poisonThreshold) {
      state.enemy.stunPending = true;
      state.enemy.stunnedThisTurn = true;
      // 密封毒瓶：眩晕后保留一部分进度，仍低于阈值
      state.enemy.poison = state.artifacts.includes('sealedVial') ? Math.min(ARTIFACT_PARAMS.sealedVialRetain, config.poisonThreshold - 1) : 0;
      log.stunApplied = true;
    }
  }
}

/** 对敌人造成伤害：先扣护盾再扣生命；穿甲针使每点攻击削减 2 点护盾。击杀时结束战斗。 */
function damageEnemy(state: BattleState, amount: number): { toShield: number; toHp: number } {
  const enemy = state.enemy;
  const factor = state.artifacts.includes('piercingNeedle') ? ARTIFACT_PARAMS.piercingShieldFactor : 1;
  let toShield: number;
  let rest: number;
  if (amount * factor <= enemy.shield) {
    toShield = amount * factor;
    rest = 0;
  } else {
    toShield = enemy.shield;
    rest = amount - Math.ceil(enemy.shield / factor);
  }
  enemy.shield -= toShield;
  const toHp = Math.min(enemy.hp, rest);
  enemy.hp -= toHp;
  if (enemy.hp <= 0) state.outcome = 'won';
  return { toShield, toHp };
}

/** 对主角造成伤害：先扣护盾再扣生命。生命归零时失败。 */
function damagePlayer(state: BattleState, amount: number): { toShield: number; toHp: number } {
  const toShield = Math.min(state.player.shield, amount);
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

  // 1. 玩家回合结束：本回合生效的状态到期；向上重力扣减一回合（提前结束也计）
  state.current = { erosionArmed: false, suppressedId: null };
  if (state.gravityTurnsLeft > 0) {
    state.gravityTurnsLeft--;
    if (state.gravityTurnsLeft === 0) state.gravity = 'down';
  }

  const enemy = state.enemy;
  const log: EnemyTurnLog = {
    fuseDamageToShield: 0,
    fuseDamageToHp: 0,
    cancelledByStun: false,
    executed: [],
    damageToPlayerShield: 0,
    damageToPlayerHp: 0,
    poisonDecayed: 0,
    counterDamage: 0,
    apBonusNext: 0,
    nextIntent: enemy.intent,
  };

  // 不稳定引信的代价：回合结束时每枚留存炸弹伤害自己，在敌人行动前结算
  if (state.artifacts.includes('unstableFuse')) {
    const bombs = state.board.flat().filter((t) => t?.kind === 'bomb').length;
    const hurt = damagePlayer(state, bombs * ARTIFACT_PARAMS.unstableFuseDamage);
    log.fuseDamageToShield = hurt.toShield;
    log.fuseDamageToHp = hurt.toHp;
    if (state.outcome === 'lost') return { state, log };
  }

  // 2. 敌人回合：眩晕取消整次意图，否则按部件顺序执行
  if (enemy.stunPending) {
    enemy.stunPending = false;
    log.cancelledByStun = true;
    // 被取消的攻击连带作废已累积的蓄力加成
    if (enemy.intent.parts.some((p) => p.kind === 'attack')) enemy.chargeBonus = 0;
    // 回响钟：眩晕成功取消意图后，下回合多 1 AP
    if (state.artifacts.includes('echoBell')) state.pending.apBonus = ARTIFACT_PARAMS.echoBellAp;
  } else {
    for (const part of enemy.intent.parts) {
      executePart(state, part, log);
      if (state.outcome !== 'ongoing') return { state, log };
    }
  }

  // 3. 回合末毒气衰减（被眩晕跳过意图的回合也衰减），再展示下一次意图
  const decayed = Math.min(enemy.poison, config.poisonDecay);
  enemy.poison -= decayed;
  log.poisonDecayed = decayed;
  revealNextIntent(state);
  log.nextIntent = enemy.intent;

  // 4. 下一玩家回合开始：施加敌人上回合成功施加的状态，AP 恢复
  state.turn++;
  state.ap = config.apPerTurn + state.pending.apBonus;
  log.apBonusNext = state.pending.apBonus;
  enemy.stunnedThisTurn = false;
  if (state.pending.erosion) state.current.erosionArmed = true;
  if (state.pending.suppressId) state.current.suppressedId = state.pending.suppressId;
  if (state.pending.gravity) {
    state.gravity = 'up';
    state.gravityTurnsLeft = config.gravityTurns;
  }
  state.pending = { erosion: false, suppressId: null, gravity: false, apBonus: 0 };
  return { state, log };
}

function executePart(state: BattleState, part: IntentPart, log: EnemyTurnLog): void {
  const enemy = state.enemy;
  log.executed.push(part);
  switch (part.kind) {
    case 'attack': {
      const dmg = part.amount + enemy.chargeBonus;
      enemy.chargeBonus = 0;
      const hurt = damagePlayer(state, dmg);
      log.damageToPlayerShield += hurt.toShield;
      log.damageToPlayerHp += hurt.toHp;
      // 反应线圈：一次攻击被护盾完全挡下时反击
      if (dmg > 0 && hurt.toHp === 0 && state.outcome === 'ongoing' && state.artifacts.includes('reactionCoil')) {
        const back = damageEnemy(state, ARTIFACT_PARAMS.reactionCoilDamage);
        log.counterDamage += back.toHp + back.toShield;
      }
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
  }
}

/**
 * 从脚本取下一次意图并在此刻固定所有目标。
 * 向上重力生效或已排定期间跳过重力反转意图；嵌片压制没有可选目标时改用防御。
 */
function revealNextIntent(state: BattleState): void {
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
  for (const part of chosen.parts) {
    if (part.kind !== 'suppressInsert') {
      parts.push({ ...part });
    } else if (targets.length === 0) {
      parts.push({ kind: 'defend', amount: enemy.def.fallbackDefend });
    } else {
      parts.push({ kind: 'suppressInsert', targetId: targets[rng.int(targets.length)]!.id });
    }
  }
  state.rngState = rng.state;
  enemy.intent = { parts };
}
