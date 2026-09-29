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
import { ARTIFACT_PARAMS, type ArtifactKey } from './artifacts';
import type { EngineConfig } from './config';
import { INSERT_DEFS, type InsertType, type InstalledInsert } from './inserts';
import { findGroups, passiveBombCell } from './match';
import type { Rng } from './rng';
import type { EffectValues } from './score';
import { blockValue, bombMakeBonus, type UpgradeLevels } from './upgrades';
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
  /** 已安装的嵌片；被压制的嵌片不参与结算 */
  inserts?: readonly InstalledInsert[];
  /** 持有的神器；这里只处理作用于爆炸过程的几件 */
  artifacts?: readonly ArtifactKey[];
  /** 方块与炸弹的升级等级；缺省全为 1 级 */
  levels?: UpgradeLevels;
}

export type ExplosionShape = BombKind | 'cross' | 'rows3' | 'cols3' | 'square5' | 'board' | 'card' | 'lightning';

export interface Explosion {
  shape: ExplosionShape;
  origin: Pos;
  /** 引爆的炸弹实体；组合技为参与组合的第一枚 */
  sourceId: number;
  cells: Pos[];
  /** 仅 CB：本次清除的目标类型；随机池为空时为 null */
  targetColor?: Color | null;
  /** 由嵌片追加或改变范围时，记录该嵌片 */
  byInsert?: string;
  /** 由神器改变范围时，记录该神器 */
  byArtifact?: ArtifactKey;
}

export interface ClearedEntry {
  id: number;
  pos: Pos;
  tile: Tile;
}

/** 一次有效的嵌片触发；空触发不记录 */
export interface InsertTrigger {
  insertId: string;
  type: InsertType;
  /**
   * base 基数嵌片加基数；catalyst 催化盐多计一枚；produce 土质火药让三连产弹；
   * ignite 易燃物质点火；ember 火星陶追加 3×3；quake 震裂石扩为 5×5；powder 火药嵌片连带清除
   */
  effect: 'base' | 'catalyst' | 'produce' | 'ignite' | 'ember' | 'quake' | 'powder';
  at: Pos[];
  amount?: number;
  /** 经锁位共鸣器传递而被视为波及 */
  via?: 'lockResonator';
}

export type ResolutionEvent =
  | { type: 'swap'; from: Pos; to: Pos }
  | { type: 'ignite'; at: Pos; bomb: BombKind }
  | { type: 'noMatch' }
  | {
      type: 'matches';
      phase: Phase;
      /** bonus：亲手做出炸弹时追加给该组颜色的基数（炸弹等级 × 基础值） */
      groups: { color: Color; cells: Pos[]; product: BombKind | null; bombCell: Pos | null; bonus: number }[];
      cleared: ClearedEntry[];
      created: { id: number; bomb: BombKind; at: Pos }[];
      insertTriggers: InsertTrigger[];
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
      insertTriggers: InsertTrigger[];
    }
  | { type: 'gravity'; gravity: Gravity; moves: TileMove[]; spawns: TileSpawn[] };

export interface ActionResult {
  valid: boolean;
  /** 无效时的原因，供界面提示 */
  reason?: 'outOfBounds' | 'notAdjacent' | 'sameColor' | 'notBomb' | 'emptyCell' | 'stone';
  apSpent: 0 | 1;
  board: Board;
  events: ResolutionEvent[];
  activeClearsByType: ClearsByType;
  passiveClearCount: number;
  /** 本次行动是否主动清除了至少一枚有色普通方块 */
  hadActiveColorClear: boolean;
  /** 主动消除触发的嵌片基础值 E */
  socketBonuses: EffectValues;
  /** 本次行动中发生过有效触发的嵌片，按 ID 排序 */
  triggeredInsertIds: string[];
  /** 主动阶段作为来源被引爆或消耗的炸弹数（不稳定引信） */
  activeBombsDetonated: number;
  /** 是否有过载直线炸弹引爆（过载引线的代价） */
  overloadFired: boolean;
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

type CreatedBomb = { id: number; bomb: BombKind; at: Pos };

const waveOf = (detonations: Detonation[]): WaveInput => ({ detonations, explosions: [], consume: [], conversions: [] });

class Resolver {
  readonly board: Board;
  readonly events: ResolutionEvent[] = [];
  readonly activeClears = emptyClears();
  readonly socket: EffectValues = { attack: 0, shield: 0, poison: 0 };
  readonly triggeredIds = new Set<string>();
  passiveCount = 0;
  activeBombsDetonated = 0;
  overloadFired = false;
  /** 本次行动中已引爆或已消耗的炸弹，保证每枚只引爆一次 */
  private readonly spent = new Set<number>();
  private readonly insertAt = new Map<number, InstalledInsert>();
  private readonly activeInserts: InstalledInsert[];
  /** 尚未写入事件的嵌片触发，随下一条 matches／wave 事件输出 */
  private triggers: InsertTrigger[] = [];
  private phaseCount = 0;

  constructor(
    board: Board,
    private readonly ctx: ResolveContext,
  ) {
    this.board = cloneBoard(board);
    this.activeInserts = (ctx.inserts ?? []).filter((i) => !i.suppressed).sort((a, b) => a.id.localeCompare(b.id));
    for (const ins of this.activeInserts) for (const p of ins.cells) this.insertAt.set(posKey(p), ins);
  }

  private has(key: ArtifactKey): boolean {
    return this.ctx.artifacts?.includes(key) ?? false;
  }

  private insertOn(pos: Pos, type: InsertType): InstalledInsert | undefined {
    const ins = this.insertAt.get(posKey(pos));
    return ins?.type === type ? ins : undefined;
  }

  private trigger(t: InsertTrigger): void {
    this.triggers.push(t);
    this.triggeredIds.add(t.insertId);
  }

  private takeTriggers(): InsertTrigger[] {
    const out = this.triggers;
    this.triggers = [];
    return out;
  }

  private count(phase: Phase, tile: Tile, pos: Pos): void {
    if (phase === 'passive') {
      this.passiveCount++;
      return;
    }
    if (tile.kind !== 'normal') return;
    // 方块等级：主动清除一块计入“等级”份基数
    this.activeClears[tile.color] += blockValue(this.ctx.levels, tile.color);
    // 主动阶段的覆盖格清除：基数嵌片认同色，催化盐认催化剂
    const ins = this.insertAt.get(posKey(pos));
    if (!ins) return;
    const def = INSERT_DEFS[ins.type];
    if (def.baseColor && def.baseColor === tile.color) {
      this.socket[def.baseColor] += this.ctx.config.socketPerCell;
      this.trigger({ insertId: ins.id, type: ins.type, effect: 'base', at: [pos], amount: this.ctx.config.socketPerCell });
    } else if (ins.type === 'catalystSalt' && tile.color === 'catalyst') {
      this.activeClears.catalyst++;
      this.trigger({ insertId: ins.id, type: ins.type, effect: 'catalyst', at: [pos], amount: 1 });
    }
  }

  private clearAt(phase: Phase, pos: Pos): ClearedEntry | null {
    const tile = getTile(this.board, pos);
    if (!tile) return null;
    setTile(this.board, pos, null);
    this.count(phase, tile, pos);
    return { id: tile.id, pos, tile };
  }

  /** 按归组规则结算匹配；active 时 landings 为两枚交换方块的落点。 */
  resolveMatches(phase: Phase, landings: Pos[] = []): { matched: boolean; created: CreatedBomb[] } {
    const groups = findGroups(this.board);
    if (groups.length === 0) return { matched: false, created: [] };
    const cleared: ClearedEntry[] = [];
    const created: CreatedBomb[] = [];
    const summary: Extract<ResolutionEvent, { type: 'matches' }>['groups'] = [];
    // 先确定所有组的产物与产弹格，再统一清除，保证各组同时判定
    const plans = groups.map((g) => {
      let product = g.product;
      // 土质火药：只含一条三连线、原本不产弹的组，任一格在覆盖格上就产同向直线炸弹
      if (!product && g.lines.length === 1) {
        const ins = g.cells.map((p) => this.insertOn(p, 'earthPowder')).find(Boolean);
        if (ins) {
          product = g.lines[0]!.dir === 'h' ? 'H' : 'V';
          this.trigger({ insertId: ins.id, type: ins.type, effect: 'produce', at: g.cells.filter((p) => this.insertOn(p, 'earthPowder')) });
        }
      }
      let bombCell: Pos | null = null;
      if (product) {
        if (phase === 'active') {
          const inGroup = landings.filter((l) => g.cells.some((p) => samePos(p, l)));
          // 主动阶段不变量：每个主动组恰好包含一个交换落点
          if (inGroup.length !== 1) throw new Error(`主动组包含 ${inGroup.length} 个交换落点，违反不变量`);
          bombCell = inGroup[0]!;
        } else {
          bombCell = passiveBombCell(g, this.ctx.gravity);
        }
      }
      return { g, product, bombCell };
    });
    for (const { g, product, bombCell } of plans) {
      for (const p of g.cells) {
        if (bombCell && samePos(p, bombCell)) continue;
        const entry = this.clearAt(phase, p);
        if (entry) cleared.push(entry);
      }
      // 亲手做出炸弹：按炸弹等级给该组颜色追加基数；被动产弹没有这笔加成
      let bonus = 0;
      if (phase === 'active' && product) {
        bonus = bombMakeBonus(this.ctx.levels, product, this.ctx.config);
        this.activeClears[g.color] += bonus;
      }
      if (bombCell && product) {
        // 产弹格原方块不计清除，直接替换为无属性炸弹
        const b = makeBomb(this.ctx.ids, product);
        setTile(this.board, bombCell, b);
        created.push({ id: b.id, bomb: product, at: bombCell });
      }
      summary.push({ color: g.color, cells: g.cells, product, bombCell, bonus });
    }
    this.events.push({ type: 'matches', phase, groups: summary, cleared, created, insertTriggers: this.takeTriggers() });
    return { matched: true, created };
  }

  /** 易燃物质：匹配产出的炸弹若生成在覆盖格上，下一波引爆（改造出的炸弹本就会引爆，不重复处理） */
  flammableDetonations(created: CreatedBomb[]): Detonation[] {
    const out: Detonation[] = [];
    for (const b of created) {
      const ins = this.insertOn(b.at, 'flammable');
      if (!ins) continue;
      this.trigger({ insertId: ins.id, type: ins.type, effect: 'ignite', at: [b.at] });
      out.push({ id: b.id, pos: b.at, bomb: b.bomb });
    }
    return out;
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

      // a. 定范围（含火星陶、震裂石的范围修正）；来源炸弹在此消耗
      const detonations = [...input.detonations].sort((x, y) => posKey(x.pos) - posKey(y.pos));
      for (const d of detonations) explosions.push(...this.explosionsOf(d, snapshot));
      for (const d of [...detonations, ...input.consume]) {
        this.spent.add(d.id);
        if (phase === 'active') this.activeBombsDetonated++;
        const entry = this.clearAt(phase, d.pos);
        if (entry) consumed.push(entry);
      }

      // b. 清除：所有范围的并集，加上火药嵌片的连带清除；范围内尚未引爆的炸弹进入下一波
      const hit = new Map<number, Pos>();
      for (const e of explosions) for (const p of e.cells) hit.set(posKey(p), p);
      const targets = new Map(hit);
      const direct = this.activeInserts.filter((ins) => ins.cells.some((p) => hit.has(posKey(p))));
      // 锁位共鸣器：与被直接波及的嵌片有边相接的嵌片也视为被波及，只传一层
      const resonated = this.has('lockResonator')
        ? this.activeInserts.filter((ins) => !direct.includes(ins) && direct.some((d) => edgeAdjacent(d, ins)))
        : [];
      for (const ins of [...direct, ...resonated]) {
        if (ins.type !== 'blastPowder') continue;
        // 只有覆盖格上仍有方块、且未被爆炸本身覆盖时才算有效触发
        const extra = ins.cells.filter((p) => !hit.has(posKey(p)) && getTile(this.board, p));
        if (extra.length === 0) continue;
        for (const p of extra) targets.set(posKey(p), p);
        this.trigger({ insertId: ins.id, type: ins.type, effect: 'powder', at: extra, ...(resonated.includes(ins) ? { via: 'lockResonator' as const } : {}) });
      }
      for (const [, p] of [...targets].sort((x, y) => x[0] - y[0])) {
        const tile = getTile(this.board, p);
        if (!tile) continue;
        if (tile.kind === 'bomb') {
          if (!this.spent.has(tile.id)) queued.set(tile.id, p);
          continue;
        }
        const entry = this.clearAt(phase, p);
        if (entry) cleared.push(entry);
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

      // d. 生成触发：第一批中只有易燃物质，且改造出的炸弹本就在下一波引爆，无需额外处理

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
        insertTriggers: this.takeTriggers(),
      });

      for (const [id, pos] of queued) {
        const t = getTile(this.board, pos) as BombTile;
        next.push({ id, pos, bomb: t.bomb });
      }
      input = next.length > 0 ? waveOf(next) : null;
      index++;
    }
  }

  private explosionsOf(d: Detonation, snapshot: Board): Explosion[] {
    const rows = this.board.length;
    const cols = this.board[0]!.length;
    const { r, c } = d.pos;
    const base = { origin: d.pos, sourceId: d.id };
    switch (d.bomb) {
      case 'H':
      case 'V': {
        // 过载引线：单枚直线炸弹清三行／三列
        const w = this.has('overloadFuse') ? 1 : 0;
        if (w) this.overloadFired = true;
        const line: Explosion =
          d.bomb === 'H'
            ? { ...base, shape: 'H', cells: rect(rows, cols, r - w, r + w, 0, cols - 1) }
            : { ...base, shape: 'V', cells: rect(rows, cols, 0, rows - 1, c - w, c + w) };
        if (w) line.byArtifact = 'overloadFuse';
        const out: Explosion[] = [line];
        // 雷鸣引线：直线两侧的闪电，属于“修改范围”，在同一波内与直线一并清除
        if (this.has('thunderFuse')) out.push({ ...base, shape: 'lightning', cells: this.lightningCells(d.bomb, d.pos, w), byArtifact: 'thunderFuse' });
        const ember = this.insertOn(d.pos, 'emberClay');
        if (!ember) return out;
        this.trigger({ insertId: ember.id, type: ember.type, effect: 'ember', at: [d.pos] });
        return [...out, { ...base, shape: 'A', cells: rect(rows, cols, r - 1, r + 1, c - 1, c + 1), byInsert: ember.id }];
      }
      case 'A': {
        const quake = this.insertOn(d.pos, 'quakeStone');
        if (!quake) return [{ ...base, shape: 'A', cells: rect(rows, cols, r - 1, r + 1, c - 1, c + 1) }];
        this.trigger({ insertId: quake.id, type: quake.type, effect: 'quake', at: [d.pos] });
        return [{ ...base, shape: 'square5', cells: rect(rows, cols, r - 2, r + 2, c - 2, c + 2), byInsert: quake.id }];
      }
      case 'CB': {
        const target = d.forcedColor ?? this.pickExistingColor(snapshot);
        const cells = target ? cellsOfColor(snapshot, target) : [];
        return [{ ...base, shape: 'CB', cells, targetColor: target }];
      }
    }
  }

  /**
   * 雷鸣引线的闪电落点：在直线两侧、离直线不超过 thunderReach 行（列）的格中，按种子随机取 5–8 格。
   * 先挑彼此不上下左右相邻的格让落点错落（斜向相邻可以），不够时再从其余格补足；候选不足时有几格取几格。
   */
  lightningCells(bomb: 'H' | 'V', at: Pos, halfWidth: number): Pos[] {
    const rows = this.board.length;
    const cols = this.board[0]!.length;
    const reach = halfWidth + ARTIFACT_PARAMS.thunderReach;
    const pool: Pos[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const off = bomb === 'H' ? Math.abs(r - at.r) : Math.abs(c - at.c);
        if (off > halfWidth && off <= reach) pool.push({ r, c });
      }
    }
    const rng = this.ctx.rng;
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    const want = Math.min(pool.length, ARTIFACT_PARAMS.thunderMin + rng.int(ARTIFACT_PARAMS.thunderMax - ARTIFACT_PARAMS.thunderMin + 1));
    const picked: Pos[] = [];
    for (const p of pool) {
      if (picked.length >= want) break;
      if (picked.every((q) => Math.abs(q.r - p.r) + Math.abs(q.c - p.c) > 1)) picked.push(p);
    }
    for (const p of pool) {
      if (picked.length >= want) break;
      if (!picked.includes(p)) picked.push(p);
    }
    return picked.sort((a, b) => a.r - b.r || a.c - b.c);
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

  /** 匹配结算后，若易燃物质点火，就在同一阶段进入波次 */
  matchesThenWaves(phase: Phase, landings?: Pos[]): boolean {
    const { matched, created } = this.resolveMatches(phase, landings);
    const lit = this.flammableDetonations(created);
    if (lit.length > 0) this.runWaves(phase, waveOf(lit));
    return matched;
  }

  /** 第一次重力移动之后：反复找匹配直到棋盘稳定。 */
  runPassive(): void {
    while (this.gravityStep()) {
      if (++this.phaseCount > this.ctx.config.maxPhases) throw new Error('单次行动阶段数超过工程保护上限');
      this.matchesThenWaves('passive');
    }
  }
}

function edgeAdjacent(a: InstalledInsert, b: InstalledInsert): boolean {
  return a.cells.some((p) => b.cells.some((q) => Math.abs(p.r - q.r) + Math.abs(p.c - q.c) === 1));
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
    socketBonuses: { attack: 0, shield: 0, poison: 0 },
    triggeredInsertIds: [],
    activeBombsDetonated: 0,
    overloadFired: false,
  });

  const res = new Resolver(board, ctx);
  const rows = board.length;
  const cols = board[0]!.length;

  if (action.type === 'play') {
    // 嵌片卡：与一次爆炸同样结算——覆盖的普通方块被清除，覆盖的炸弹被引爆并接力
    if (action.cells.length === 0 || action.cells.some((p) => !inBounds(board, p))) return invalid('outOfBounds');
    const bonus = action.bonus;
    if (bonus) {
      // 颜色词条按打出前的棋盘计算：覆盖到的该颜色普通方块数
      const n = action.cells.filter((p) => {
        const t = getTile(board, p);
        return t?.kind === 'normal' && t.color === bonus.color;
      }).length;
      if (bonus.color === 'catalyst') res.activeClears.catalyst += n * bonus.perTile;
      else res.socket[bonus.color] += n * bonus.perTile;
    }
    res.runWaves('active', {
      detonations: [],
      explosions: [{ shape: 'card', origin: action.cells[0]!, sourceId: -1, cells: action.cells }],
      consume: [],
      conversions: [],
    });
    res.runPassive();
  } else if (action.type === 'ignite') {
    if (!inBounds(board, action.at)) return invalid('outOfBounds');
    const t = getTile(board, action.at);
    if (!t || t.kind !== 'bomb') return invalid('notBomb');
    res.events.push({ type: 'ignite', at: action.at, bomb: t.bomb });
    res.runWaves('active', waveOf([{ id: t.id, pos: action.at, bomb: t.bomb }]));
    res.runPassive();
  } else {
    const { from, to } = action;
    if (!inBounds(board, from) || !inBounds(board, to)) return invalid('outOfBounds');
    if (!isAdjacent(from, to)) return invalid('notAdjacent');
    const a = getTile(board, from);
    const b = getTile(board, to);
    if (!a || !b) return invalid('emptyCell');
    // 石块不能交换，只能被爆炸清除
    if (a.kind === 'stone' || b.kind === 'stone') return invalid('stone');
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
      res.runWaves('active', waveOf([{ id: cb.id, pos: cbPos, bomb: 'CB', forcedColor: (other as { color: Color }).color }]));
      res.runPassive();
    } else if (res.matchesThenWaves('active', [to, from])) {
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
    socketBonuses: res.socket,
    triggeredInsertIds: [...res.triggeredIds].sort(),
    activeBombsDetonated: res.activeBombsDetonated,
    overloadFired: res.overloadFired,
  };
}
