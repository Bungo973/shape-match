// 匹配识别与归组，规则见 docs/SPECIAL_TILES.md「匹配识别与归组（已确定）」。
import { posKey } from './board';
import type { Board, BombKind, Color, Gravity, Pos } from './types';

export interface MatchLine {
  dir: 'h' | 'v';
  color: Color;
  cells: Pos[];
}

export interface MatchGroup {
  color: Color;
  lines: MatchLine[];
  /** 组内所有格，按行、再按列排序且去重 */
  cells: Pos[];
  /** 该组应生成的炸弹；普通三连为 null */
  product: BombKind | null;
}

/** 步骤 1：找出所有横、纵同色普通方块连续 ≥3 格的最长线段；炸弹与空格都会打断连续性。 */
export function findLines(board: Board): MatchLine[] {
  const rows = board.length;
  const cols = board[0]!.length;
  const lines: MatchLine[] = [];
  const colorAt = (r: number, c: number): Color | null => {
    const t = board[r]?.[c];
    return t && t.kind === 'normal' ? t.color : null;
  };
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      const color = colorAt(r, c);
      let end = c + 1;
      while (color && end < cols && colorAt(r, end) === color) end++;
      if (color && end - c >= 3) lines.push({ dir: 'h', color, cells: range(c, end).map((cc) => ({ r, c: cc })) });
      c = end;
    }
  }
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      const color = colorAt(r, c);
      let end = r + 1;
      while (color && end < rows && colorAt(end, c) === color) end++;
      if (color && end - r >= 3) lines.push({ dir: 'v', color, cells: range(r, end).map((rr) => ({ r: rr, c })) });
      r = end;
    }
  }
  return lines;
}

/** 步骤 2、3：共享至少一格的线并为一组（传递合并），再按 CB ＞ A ＞ H/V 定产物。 */
export function groupLines(lines: MatchLine[]): MatchGroup[] {
  const parent = lines.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const owner = new Map<number, number>();
  lines.forEach((line, i) => {
    for (const p of line.cells) {
      const k = posKey(p);
      const j = owner.get(k);
      if (j === undefined) owner.set(k, i);
      else parent[find(i)] = find(j);
    }
  });
  const buckets = new Map<number, MatchLine[]>();
  lines.forEach((line, i) => {
    const root = find(i);
    buckets.set(root, [...(buckets.get(root) ?? []), line]);
  });
  const groups: MatchGroup[] = [];
  for (const groupLines of buckets.values()) {
    const keys = new Set<number>();
    for (const l of groupLines) for (const p of l.cells) keys.add(posKey(p));
    const cells = [...keys].sort((a, b) => a - b).map((k) => ({ r: Math.floor(k / 100), c: k % 100 }));
    groups.push({ color: groupLines[0]!.color, lines: groupLines, cells, product: classify(groupLines) });
  }
  // 以组内首格排序，保证结果与扫描顺序无关
  groups.sort((a, b) => posKey(a.cells[0]!) - posKey(b.cells[0]!));
  return groups;
}

function classify(lines: MatchLine[]): BombKind | null {
  if (lines.some((l) => l.cells.length >= 5)) return 'CB';
  const hasH = lines.some((l) => l.dir === 'h');
  const hasV = lines.some((l) => l.dir === 'v');
  if (hasH && hasV) return 'A';
  const only = lines[0]!;
  if (lines.length === 1 && only.cells.length === 4) return only.dir === 'h' ? 'H' : 'V';
  return null;
}

export function findGroups(board: Board): MatchGroup[] {
  return groupLines(findLines(board));
}

/** 被动组的产弹格：沿重力方向最远的一行，并列取最左列。 */
export function passiveBombCell(group: MatchGroup, gravity: Gravity): Pos {
  const rows = group.cells.map((p) => p.r);
  const targetRow = gravity === 'down' ? Math.max(...rows) : Math.min(...rows);
  const cols = group.cells.filter((p) => p.r === targetRow).map((p) => p.c);
  return { r: targetRow, c: Math.min(...cols) };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, i) => from + i);
}
