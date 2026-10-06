// 死局判定与自动重排：只允许可匹配交换，棋盘可能无步可走，见 docs/GAME_RULES.md §1。
import { cloneBoard, createBoard, createIdGen, getTile, setTile, type TileMove } from './board';
import type { EngineConfig } from './config';
import { findGroups, findLines } from './match';
import type { Rng } from './rng';
import type { Board, BombKind, NormalTile, Pos } from './types';

/** 交换 from、to 两格后是否形成匹配（不修改原棋盘） */
export function swapMakesMatch(board: Board, from: Pos, to: Pos): boolean {
  const a = getTile(board, from);
  const b = getTile(board, to);
  if (a?.kind !== 'normal' || b?.kind !== 'normal' || a.color === b.color) return false;
  const trial = cloneBoard(board);
  setTile(trial, from, b);
  setTile(trial, to, a);
  return findLines(trial).length > 0;
}

/**
 * 是否还有可走的步：场上有炸弹就总能点燃；否则需要至少一对相邻普通方块交换后成匹配。
 */
export function hasLegalMove(board: Board): boolean {
  const rows = board.length;
  const cols = board[0]!.length;
  if (board.some((row) => row.some((t) => t?.kind === 'bomb'))) return true;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && swapMakesMatch(board, { r, c }, { r, c: c + 1 })) return true;
      if (r + 1 < rows && swapMakesMatch(board, { r, c }, { r: r + 1, c })) return true;
    }
  }
  return false;
}

/** 提示的一步：交换 from、to；bomb 为这一步亲手能做出的最好的炸弹（普通三消为 null） */
export interface Hint {
  from: Pos;
  to: Pos;
  bomb: BombKind | null;
}

const BOMB_RANK: Record<BombKind, number> = { CB: 3, A: 2, H: 1, V: 1 };

/**
 * 弱引导：找一步可走的交换。优先能亲手做出炸弹的（五连 > 3×3 > 直线），其次普通三消；
 * 同档取消除格数多的，再按扫描顺序。只看交换当下形成的匹配，不模拟连锁。没有可走的交换时返回 null。
 */
export function findHint(board: Board): Hint | null {
  const rows = board.length;
  const cols = board[0]!.length;
  let best: (Hint & { score: number }) | null = null;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (const to of [{ r, c: c + 1 }, { r: r + 1, c }]) {
        if (to.r >= rows || to.c >= cols) continue;
        const from = { r, c };
        if (!swapMakesMatch(board, from, to)) continue;
        const trial = cloneBoard(board);
        const a = getTile(board, from)!;
        setTile(trial, from, getTile(board, to)!);
        setTile(trial, to, a);
        const groups = findGroups(trial);
        const bomb = groups.reduce<BombKind | null>((b, g) => (g.product && (!b || BOMB_RANK[g.product] > BOMB_RANK[b]) ? g.product : b), null);
        const score = (bomb ? BOMB_RANK[bomb] * 1000 : 0) + groups.reduce((n, g) => n + g.cells.length, 0);
        if (!best || score > best.score) best = { from, to, bomb, score };
      }
    }
  }
  return best && { from: best.from, to: best.to, bomb: best.bomb };
}

/** 重排的尝试上限；超出后改为按新颜色重新生成普通方块 */
const SHUFFLE_TRIES = 200;

/**
 * 死局时自动重排：只在普通方块之间按种子打乱位置（石块与炸弹不动），
 * 要求重排后没有现成三连且至少有一步可走。返回新棋盘与方块移动，供动画使用。
 * 反复失败时改为重新生成普通方块的颜色（此时 moves 为空，界面直接同步棋盘）。
 */
export function reshuffle(board: Board, rng: Rng, config: EngineConfig): { board: Board; moves: TileMove[] } {
  const cells: Pos[] = [];
  board.forEach((row, r) => row.forEach((t, c) => t?.kind === 'normal' && cells.push({ r, c })));
  for (let attempt = 0; attempt < SHUFFLE_TRIES; attempt++) {
    const order = cells.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const next = cloneBoard(board);
    cells.forEach((p, i) => setTile(next, p, getTile(board, cells[order[i]!]!)));
    if (findLines(next).length === 0 && hasLegalMove(next)) {
      const moves = cells.flatMap((to, i) => {
        const from = cells[order[i]!]!;
        return from.r === to.r && from.c === to.c ? [] : [{ id: getTile(board, from)!.id, from, to }];
      });
      return { board: next, moves };
    }
  }
  // 兜底：沿用无初始三连的生成规则，重新给普通方块上色，ID 延续原方块
  for (let attempt = 0; attempt < SHUFFLE_TRIES; attempt++) {
    const fresh = createBoard(rng, createIdGen(), { ...config, rows: board.length, cols: board[0]!.length });
    const next = cloneBoard(board);
    for (const p of cells) setTile(next, p, { ...(getTile(fresh, p) as NormalTile), id: getTile(board, p)!.id });
    if (findLines(next).length === 0 && hasLegalMove(next)) return { board: next, moves: [] };
  }
  throw new Error('重排失败：棋盘上可交换的普通方块太少');
}
