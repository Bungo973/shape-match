// 一次行动的结算：阶段与波次，规则见 docs/INSERT_DESIGN.md「触发引擎与消除结算」。
import {
  applyGravity,
  bomb as makeBomb,
  cloneBoard,
  getTile,
  inBounds,
  isAdjacent,
  posKey,
  samePos,
  setTile,
  type IdGen,
  type Spawner,
  type TileMove,
  type TileSpawn,
} from './board';
import type { EngineConfig } from './config';
import { findGroups, passiveBombCell } from './match';
import type { Rng } from './rng';
import {
  COLORS,
  emptyClears,
  type Action,
  type Board,
  type BombKind,
  type BombTile,
  type ClearsByType,
  type Color,
  type Gravity,
  type Phase,
  type Pos,
  type Tile,
} from './types';

export interface ResolveContext {
  config: EngineConfig;
  rng: Rng;
  ids: IdGen;
  spawn: Spawner;
  gravity: Gravity;
}

export type ExplosionShape = BombKind | 'cross' | 'rows3' | 'cols3' | 'square5' | 'board';

export interface Explosion {
  shape: ExplosionShape;
  origin: Pos;
  /** 引爆的炸弹实体；组合技为参与组合的第一枚 */
  sourceId: number;
  cells: Pos[];
  /** 仅 CB：本次清除的目标类型；随机池为空时为 null */
  targetColor?: Color | null;
}

export interface ClearedEntry {
  id: number;
  pos: Pos;
  tile: Tile;
}

export type ResolutionEvent =
  | { type: 'swap'; from: Pos; to: Pos }
  | { type: 'ignite'; at: Pos; bomb: BombKind }
  | { type: 'noMatch' }
  | {
      type: 'matches';
      phase: Phase;
      groups: { color: Color; cells: Pos[]; product: BombKind | null; bombCell: Pos | null }[];
      cleared: ClearedEntry[];
      created: { id: number; bomb: BombKind; at: Pos }[];
    }
  | {
      type: 'wave';
      phase: Phase;
      index: number;
      explosions: Explosion[];
      /** 本波作为来源被消耗的炸弹（含组合技的两枚） */
      consumed: ClearedEntry[];
      cleared: ClearedEntry[];
      converted: { from: ClearedEntry | null; id: number; bomb: BombKind; at: Pos }[];
      /** 被波及、将在下一波引爆的炸弹 */
      queued: { id: number; at: Pos }[];
    }
  | { type: 'gravity'; gravity: Gravity; moves: TileMove[]; spawns: TileSpawn[] };

export interface ActionResult {
  valid: boolean;
  /** 无效时的原因，供界面提示 */
  reason?: 'outOfBounds' | 'notAdjacent' | 'sameColor' | 'notBomb' | 'emptyCell';
  apSpent: 0 | 1;
  board: Board;
  events: ResolutionEvent[];
  activeClearsByType: ClearsByType;
  passiveClearCount: number;
  /** 本次行动是否主动清除了至少一枚有色普通方块 */
  hadActiveColorClear: boolean;
}

interface Detonation {
  id: number;
  pos: Pos;
  bomb: BombKind;
  /** CB 与普通方块交换时由对方给出的目标类型 */
  forcedColor?: Color;
}

interface Conversion {
  /** 从本波快照中选取此类型的普通方块改造 */
  color: Color;
  /** 'line' 表示每枚独立随机横／竖 */
  into: 'line' | 'A';
}

interface WaveInput {
  detonations: Detonation[];
  /** 组合技直接给出的范围 */
  explosions: Explosion[];
  /** 组合技中不单独爆炸、直接消耗的炸弹 */
  consume: Detonation[];
  conversions: Conversion[];
}

class Resolver {
  readonly board: Board;
  readonly events: ResolutionEvent[] = [];
  readonly activeClears = emptyClears();
  passiveCount = 0;
  /** 本次行动中已引爆或已消耗的炸弹，保证每枚只引爆一次 */
  private readonly spent = new Set<number>();
  private phaseCount = 0;

  constructor(
    board: Board,
    private readonly ctx: ResolveContext,
  ) {
    this.board = cloneBoard(board);
  }

  private count(phase: Phase, tile: Tile): void {
    if (phase === 'active') {
      if (tile.kind === 'normal') this.activeClears[tile.color]++;
    } else {
      this.passiveCount++;
    }
  }

  private clearAt(phase: Phase, pos: Pos): ClearedEntry | null {
    const tile = getTile(this.board, pos);
    if (!tile) return null;
    setTile(this.board, pos, null);
    this.count(phase, tile);
    return { id: tile.id, pos, tile };
  }

  /** 按归组规则结算匹配；active 时 landings 为两枚交换方块的落点。返回是否有匹配。 */
  resolveMatches(phase: Phase, landings: Pos[] = []): boolean {
    const groups = findGroups(this.board);
    if (groups.length === 0) return false;
    const cleared: ClearedEntry[] = [];
    const created: { id: number; bomb: BombKind; at: Pos }[] = [];
    const summary: Extract<ResolutionEvent, { type: 'matches' }>['groups'] = [];
    // 先确定所有组的产弹格，再统一清除，保证各组同时判定
    const plans = groups.map((g) => {
      let bombCell: Pos | null = null;
      if (g.product) {
        if (phase === 'active') {
          const inGroup = landings.filter((l) => g.cells.some((p) => samePos(p, l)));
          // 主动阶段不变量：每个主动组恰好包含一个交换落点
          if (inGroup.length !== 1) throw new Error(`主动组包含 ${inGroup.length} 个交换落点，违反不变量`);
          bombCell = inGroup[0]!;
        } else {
          bombCell = passiveBombCell(g, this.ctx.gravity);
        }
      }
      return { g, bombCell };
    });
    for (const { g, bombCell } of plans) {
      for (const p of g.cells) {
        if (bombCell && samePos(p, bombCell)) continue;
        const entry = this.clearAt(phase, p);
        if (entry) cleared.push(entry);
      }
      if (bombCell && g.product) {
        // 产弹格原方块不计清除，直接替换为无属性炸弹
        const b = makeBomb(this.ctx.ids, g.product);
        setTile(this.board, bombCell, b);
        created.push({ id: b.id, bomb: g.product, at: bombCell });
      }
      summary.push({ color: g.color, cells: g.cells, product: g.product, bombCell });
    }
    this.events.push({ type: 'matches', phase, groups: summary, cleared, created });
    return true;
  }

  /** 波次循环：同一波内清除取并集、改造在清除之后，结果与处理先后无关。 */
  runWaves(phase: Phase, first: WaveInput): void {
    let input: WaveInput | null = first;
    let index = 0;
    while (input) {
      const snapshot = cloneBoard(this.board);
      const explosions: Explosion[] = [...input.explosions];
      const consumed: ClearedEntry[] = [];
      const cleared: ClearedEntry[] = [];
      const converted: Extract<ResolutionEvent, { type: 'wave' }>['converted'] = [];
      const queued = new Map<number, Pos>();

      // a. 定范围；来源炸弹在此消耗
      const detonations = [...input.detonations].sort((x, y) => posKey(x.pos) - posKey(y.pos));
      for (const d of detonations) {
        explosions.push(this.explosionOf(d, snapshot));
      }
      for (const d of [...detonations, ...input.consume]) {
        this.spent.add(d.id);
        const entry = this.clearAt(phase, d.pos);
        if (entry) consumed.push(entry);
      }

      // b. 清除：所有范围的并集；范围内尚未引爆的炸弹进入下一波
      const hit = new Map<number, Pos>();
      for (const e of explosions) for (const p of e.cells) hit.set(posKey(p), p);
      const clearedKeys = new Set<number>();
      for (const [k, p] of [...hit].sort((x, y) => x[0] - y[0])) {
        const tile = getTile(this.board, p);
        if (!tile) continue;
        if (tile.kind === 'bomb') {
          if (!this.spent.has(tile.id)) queued.set(tile.id, p);
          continue;
        }
        const entry = this.clearAt(phase, p);
        if (entry) {
          cleared.push(entry);
          clearedKeys.add(k);
        }
      }

      // c. 改造 = 清除原有色方块（若 b 未清除，此时计数）+ 放下炸弹；对象按本波开始时的快照判定
      const next: Detonation[] = [];
      for (const conv of input.conversions) {
        for (const p of cellsOfColor(snapshot, conv.color)) {
          const current = getTile(this.board, p);
          if (current?.kind === 'bomb') continue;
          const from = current ? this.clearAt(phase, p) : null;
          const kind: BombKind = conv.into === 'A' ? 'A' : this.ctx.rng.int(2) === 0 ? 'H' : 'V';
          const b = makeBomb(this.ctx.ids, kind) as BombTile;
          setTile(this.board, p, b);
          converted.push({ from, id: b.id, bomb: kind, at: p });
          next.push({ id: b.id, pos: p, bomb: kind });
        }
      }

      // d. 生成触发：留给嵌片接入（易燃物质、星火矿脉）

      // e. 记录
      this.events.push({
        type: 'wave',
        phase,
        index,
        explosions,
        consumed,
        cleared,
        converted,
        queued: [...queued].map(([id, at]) => ({ id, at })),
      });

      for (const [id, pos] of queued) {
        const t = getTile(this.board, pos) as BombTile;
        next.push({ id, pos, bomb: t.bomb });
      }
      input = next.length > 0 ? { detonations: next, explosions: [], consume: [], conversions: [] } : null;
      index++;
    }
  }

  private explosionOf(d: Detonation, snapshot: Board): Explosion {
    const rows = this.board.length;
    const cols = this.board[0]!.length;
    const { r, c } = d.pos;
    switch (d.bomb) {
      case 'H':
        return { shape: 'H', origin: d.pos, sourceId: d.id, cells: rect(rows, cols, r, r, 0, cols - 1) };
      case 'V':
        return { shape: 'V', origin: d.pos, sourceId: d.id, cells: rect(rows, cols, 0, rows - 1, c, c) };
      case 'A':
        return { shape: 'A', origin: d.pos, sourceId: d.id, cells: rect(rows, cols, r - 1, r + 1, c - 1, c + 1) };
      case 'CB': {
        const target = d.forcedColor ?? this.pickExistingColor(snapshot);
        const cells = target ? cellsOfColor(snapshot, target) : [];
        return { shape: 'CB', origin: d.pos, sourceId: d.id, cells, targetColor: target };
      }
    }
  }

  /** 从棋盘现存的基础方块类型中随机抽一种；池为空时返回 null。 */
  pickExistingColor(snapshot: Board): Color | null {
    const pool = COLORS.filter((col) => cellsOfColor(snapshot, col).length > 0);
    if (pool.length === 0) return null;
    return pool[this.ctx.rng.int(pool.length)]!;
  }

  /** 若有空格则重力移动并补位，返回是否发生了移动。 */
  gravityStep(): boolean {
    if (!this.board.some((row) => row.some((t) => t === null))) return false;
    const { moves, spawns } = applyGravity(this.board, this.ctx.gravity, this.ctx.ids, this.ctx.spawn);
    this.events.push({ type: 'gravity', gravity: this.ctx.gravity, moves, spawns });
    return true;
  }

  /** 第一次重力移动之后：反复找匹配直到棋盘稳定。 */
  runPassive(): void {
    while (this.gravityStep()) {
      if (++this.phaseCount > this.ctx.config.maxPhases) throw new Error('单次行动阶段数超过工程保护上限');
      this.resolveMatches('passive');
      // 被动爆炸只来自嵌片；接入嵌片后在此调用 runWaves('passive', ...)
    }
  }
}

function rect(rows: number, cols: number, r0: number, r1: number, c0: number, c1: number): Pos[] {
  const out: Pos[] = [];
  for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
    for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) out.push({ r, c });
  }
  return out;
}

function cellsOfColor(board: Board, color: Color): Pos[] {
  const out: Pos[] = [];
  board.forEach((row, r) =>
    row.forEach((t, c) => {
      if (t?.kind === 'normal' && t.color === color) out.push({ r, c });
    }),
  );
  return out;
}

/** 两枚炸弹直接交换的组合技；first 为先选中的炸弹，已位于 to。 */
function comboWave(first: Detonation, second: Detonation, to: Pos, rows: number, cols: number, resolver: Resolver, snapshot: Board): WaveInput {
  const kinds = [first.bomb, second.bomb];
  const has = (k: BombKind) => kinds.includes(k);
  const isLine = (k: BombKind) => k === 'H' || k === 'V';
  const base: WaveInput = { detonations: [], explosions: [], consume: [first, second], conversions: [] };
  const explosion = (shape: ExplosionShape, cells: Pos[]): WaveInput => ({
    ...base,
    explosions: [{ shape, origin: to, sourceId: first.id, cells }],
  });

  if (isLine(first.bomb) && isLine(second.bomb)) {
    return explosion('cross', [...rect(rows, cols, to.r, to.r, 0, cols - 1), ...rect(rows, cols, 0, rows - 1, to.c, to.c)]);
  }
  if (first.bomb === 'A' && second.bomb === 'A') {
    return explosion('square5', rect(rows, cols, to.r - 2, to.r + 2, to.c - 2, to.c + 2));
  }
  if (has('A') && !has('CB')) {
    const line = first.bomb === 'A' ? second : first;
    return line.bomb === 'H'
      ? explosion('rows3', rect(rows, cols, line.pos.r - 1, line.pos.r + 1, 0, cols - 1))
      : explosion('cols3', rect(rows, cols, 0, rows - 1, line.pos.c - 1, line.pos.c + 1));
  }
  if (first.bomb === 'CB' && second.bomb === 'CB') {
    return explosion('board', rect(rows, cols, 0, rows - 1, 0, cols - 1));
  }
  // CB + H/V/A：随机抽现存类型，把该类普通方块全部改造后一起引爆
  const other = first.bomb === 'CB' ? second : first;
  const color = resolver.pickExistingColor(snapshot);
  if (!color) return base;
  return { ...base, conversions: [{ color, into: other.bomb === 'A' ? 'A' : 'line' }] };
}

/**
 * 结算一次玩家行动。纯函数：不修改传入的棋盘，随机数与 ID 通过 ctx 推进。
 * 无效操作不消耗 AP，棋盘不变。
 */
export function resolveAction(board: Board, action: Action, ctx: ResolveContext): ActionResult {
  const invalid = (reason: ActionResult['reason']): ActionResult => ({
    valid: false,
    ...(reason ? { reason } : {}),
    apSpent: 0,
    board,
    events: [],
    activeClearsByType: emptyClears(),
    passiveClearCount: 0,
    hadActiveColorClear: false,
  });

  const res = new Resolver(board, ctx);
  const rows = board.length;
  const cols = board[0]!.length;

  if (action.type === 'ignite') {
    if (!inBounds(board, action.at)) return invalid('outOfBounds');
    const t = getTile(board, action.at);
    if (!t || t.kind !== 'bomb') return invalid('notBomb');
    res.events.push({ type: 'ignite', at: action.at, bomb: t.bomb });
    res.runWaves('active', { detonations: [{ id: t.id, pos: action.at, bomb: t.bomb }], explosions: [], consume: [], conversions: [] });
    res.runPassive();
  } else {
    const { from, to } = action;
    if (!inBounds(board, from) || !inBounds(board, to)) return invalid('outOfBounds');
    if (!isAdjacent(from, to)) return invalid('notAdjacent');
    const a = getTile(board, from);
    const b = getTile(board, to);
    if (!a || !b) return invalid('emptyCell');
    if (a.kind === 'normal' && b.kind === 'normal' && a.color === b.color) return invalid('sameColor');

    // 交换后 a 位于 to，b 位于 from
    setTile(res.board, to, a);
    setTile(res.board, from, b);
    res.events.push({ type: 'swap', from, to });

    if (a.kind === 'bomb' && b.kind === 'bomb') {
      const first: Detonation = { id: a.id, pos: to, bomb: a.bomb };
      const second: Detonation = { id: b.id, pos: from, bomb: b.bomb };
      res.runWaves('active', comboWave(first, second, to, rows, cols, res, cloneBoard(res.board)));
      res.runPassive();
    } else if ((a.kind === 'bomb' && a.bomb === 'CB') || (b.kind === 'bomb' && b.bomb === 'CB')) {
      // CB 与普通方块交换：按对方类型清除
      const [cb, cbPos, other] = a.kind === 'bomb' && a.bomb === 'CB' ? [a, to, b] : [b as BombTile, from, a];
      res.runWaves('active', {
        detonations: [{ id: cb.id, pos: cbPos, bomb: 'CB', forcedColor: (other as { color: Color }).color }],
        explosions: [],
        consume: [],
        conversions: [],
      });
      res.runPassive();
    } else if (res.resolveMatches('active', [to, from])) {
      // 主动匹配本身不引爆炸弹；接入易燃物质等嵌片后，生成触发的爆炸在此进入主动波次
      res.runPassive();
    } else {
      res.events.push({ type: 'noMatch' });
    }
  }

  const colorClears = COLORS.reduce((sum, col) => sum + res.activeClears[col], 0);
  return {
    valid: true,
    apSpent: 1,
    board: res.board,
    events: res.events,
    activeClearsByType: res.activeClears,
    passiveClearCount: res.passiveCount,
    hadActiveColorClear: colorClears > 0,
  };
}
