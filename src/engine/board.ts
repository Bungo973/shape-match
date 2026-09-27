import type { EngineConfig } from './config';
import { pickWeighted, type Rng } from './rng';
import { COLORS, type Board, type BombKind, type Color, type Gravity, type NormalTile, type Pos, type Tile } from './types';

/** 实体 ID 生成器；ID 用于动画追踪同一方块，随存档保存。 */
export interface IdGen {
  next(): number;
  readonly peek: number;
}

export function createIdGen(start = 1): IdGen {
  let n = start;
  return {
    next: () => n++,
    get peek() {
      return n;
    },
  };
}

/** 补位时决定新方块颜色；默认按权重随机，测试可注入固定序列。 */
export type Spawner = (col: number) => Color;

export function weightedSpawner(rng: Rng, config: EngineConfig): Spawner {
  return () => pickWeighted(rng, COLORS, config.colorWeights);
}

export const normal = (ids: IdGen, color: Color): NormalTile => ({ id: ids.next(), kind: 'normal', color });
export const bomb = (ids: IdGen, kind: BombKind): Tile => ({ id: ids.next(), kind: 'bomb', bomb: kind });

export const samePos = (a: Pos, b: Pos) => a.r === b.r && a.c === b.c;
export const posKey = (p: Pos) => p.r * 100 + p.c;
export const keyPos = (k: number): Pos => ({ r: Math.floor(k / 100), c: k % 100 });

export function inBounds(board: Board, p: Pos): boolean {
  return p.r >= 0 && p.r < board.length && p.c >= 0 && p.c < board[0]!.length;
}

export function isAdjacent(a: Pos, b: Pos): boolean {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

export function getTile(board: Board, p: Pos): Tile | null {
  return board[p.r]?.[p.c] ?? null;
}

export function setTile(board: Board, p: Pos, t: Tile | null): void {
  board[p.r]![p.c] = t;
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => row.slice());
}

/**
 * 生成没有初始三连的新棋盘。逐格按行、再按列填充；若某颜色会与左侧或上方两格组成三连，
 * 就从候选中排除，再按权重抽取。
 */
export function createBoard(rng: Rng, ids: IdGen, config: EngineConfig): Board {
  const board: Board = [];
  for (let r = 0; r < config.rows; r++) {
    const row: (Tile | null)[] = [];
    board.push(row);
    for (let c = 0; c < config.cols; c++) {
      const banned = new Set<Color>();
      const l1 = row[c - 1], l2 = row[c - 2];
      if (l1?.kind === 'normal' && l2?.kind === 'normal' && l1.color === l2.color) banned.add(l1.color);
      const u1 = board[r - 1]?.[c], u2 = board[r - 2]?.[c];
      if (u1?.kind === 'normal' && u2?.kind === 'normal' && u1.color === u2.color) banned.add(u1.color);
      const allowed = COLORS.filter((col) => !banned.has(col));
      row.push(normal(ids, pickWeighted(rng, allowed, config.colorWeights)));
    }
  }
  return board;
}

export interface TileMove {
  id: number;
  from: Pos;
  to: Pos;
}

export interface TileSpawn {
  id: number;
  color: Color;
  to: Pos;
  /** 从棋盘边缘外第几格进入，1 表示紧贴边缘；供动画决定起点 */
  entryOffset: number;
}

/**
 * 重力移动与补位（就地修改）。向下时方块沉向最下行，新方块从上边缘进入；向上时相反。
 * 补位顺序固定：列从左到右；同列内从最靠近已落定方块的空格开始，向进入边缘依次补入。
 */
export function applyGravity(board: Board, gravity: Gravity, ids: IdGen, spawn: Spawner): { moves: TileMove[]; spawns: TileSpawn[] } {
  const rows = board.length;
  const cols = board[0]!.length;
  const moves: TileMove[] = [];
  const spawns: TileSpawn[] = [];
  // 沿重力方向从“底”到“顶”的行序
  const order = gravity === 'down' ? [...Array(rows).keys()].reverse() : [...Array(rows).keys()];
  for (let c = 0; c < cols; c++) {
    const stack: { tile: Tile; from: number }[] = [];
    for (const r of order) {
      const t = board[r]![c];
      if (t) stack.push({ tile: t, from: r });
    }
    order.forEach((r, i) => {
      const item = stack[i];
      if (item) {
        board[r]![c] = item.tile;
        if (item.from !== r) moves.push({ id: item.tile.id, from: { r: item.from, c }, to: { r, c } });
      } else {
        const t = normal(ids, spawn(c));
        board[r]![c] = t;
        spawns.push({ id: t.id, color: t.color, to: { r, c }, entryOffset: rows - i });
      }
    });
  }
  return { moves, spawns };
}
