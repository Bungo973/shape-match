// 嵌片的数据定义与几何。精确规则见 docs/INSERT_DESIGN.md「首版嵌片池」。
import { posKey } from './board';
import type { Color, Pos } from './types';

export type InsertType =
  // 第一批
  | 'blade' // 锋刃
  | 'bulwark' // 壁垒
  | 'venomSac' // 毒囊
  | 'catalystSalt' // 催化盐
  | 'earthPowder' // 土质火药
  | 'flammable' // 易燃物质
  | 'emberClay' // 火星陶
  | 'quakeStone' // 震裂石
  | 'blastPowder'; // 火药嵌片

export type Rarity = 'common' | 'rare' | 'epic' | 'perfect';

export interface InsertDef {
  type: InsertType;
  name: string;
  rarity: Rarity;
  /** 基数嵌片对应的方块颜色 */
  baseColor?: Exclude<Color, 'catalyst'>;
}

export const INSERT_DEFS: Record<InsertType, InsertDef> = {
  blade: { type: 'blade', name: '锋刃', rarity: 'common', baseColor: 'attack' },
  bulwark: { type: 'bulwark', name: '壁垒', rarity: 'common', baseColor: 'shield' },
  venomSac: { type: 'venomSac', name: '毒囊', rarity: 'common', baseColor: 'poison' },
  catalystSalt: { type: 'catalystSalt', name: '催化盐', rarity: 'common' },
  earthPowder: { type: 'earthPowder', name: '土质火药', rarity: 'rare' },
  flammable: { type: 'flammable', name: '易燃物质', rarity: 'rare' },
  emberClay: { type: 'emberClay', name: '火星陶', rarity: 'rare' },
  quakeStone: { type: 'quakeStone', name: '震裂石', rarity: 'epic' },
  blastPowder: { type: 'blastPowder', name: '火药嵌片', rarity: 'epic' },
};

/** 已安装在棋盘上的嵌片；cells 为棋盘绝对坐标 */
export interface InstalledInsert {
  /** 实例 ID；同时决定日志与动画中的顺序 */
  id: string;
  type: InsertType;
  cells: Pos[];
  /** 被敌人压制时整条规则失效 */
  suppressed?: boolean;
}

// ---- 几何：形状、旋转、落位与扩张 ----

export type ShapeName = 'I' | 'O' | 'T' | 'L' | 'S';

/** 初始四格形状的相对坐标 */
export const SHAPES: Record<ShapeName, Pos[]> = {
  I: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }, { r: 0, c: 3 }],
  O: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 0 }, { r: 1, c: 1 }],
  T: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }, { r: 1, c: 1 }],
  L: [{ r: 0, c: 0 }, { r: 1, c: 0 }, { r: 2, c: 0 }, { r: 2, c: 1 }],
  S: [{ r: 0, c: 1 }, { r: 0, c: 2 }, { r: 1, c: 0 }, { r: 1, c: 1 }],
};

/** 平移到左上角为 (0,0)，并按行、再按列排序，便于比较 */
export function normalize(cells: Pos[]): Pos[] {
  const minR = Math.min(...cells.map((p) => p.r));
  const minC = Math.min(...cells.map((p) => p.c));
  return cells.map((p) => ({ r: p.r - minR, c: p.c - minC })).sort((a, b) => posKey(a) - posKey(b));
}

/** 顺时针旋转 90° */
export function rotate(cells: Pos[]): Pos[] {
  return normalize(cells.map((p) => ({ r: p.c, c: -p.r })));
}

export function translate(cells: Pos[], at: Pos): Pos[] {
  return cells.map((p) => ({ r: p.r + at.r, c: p.c + at.c }));
}

export interface BoardSize {
  rows: number;
  cols: number;
}

const occupied = (inserts: readonly InstalledInsert[], exceptId?: string) => {
  const set = new Set<number>();
  for (const ins of inserts) if (ins.id !== exceptId) for (const p of ins.cells) set.add(posKey(p));
  return set;
};

const inside = (size: BoardSize, p: Pos) => p.r >= 0 && p.r < size.rows && p.c >= 0 && p.c < size.cols;

/** 嵌入是否合法：全部在棋盘内、不与已安装嵌片重叠、未超过安装上限 */
export function canPlace(size: BoardSize, inserts: readonly InstalledInsert[], cells: Pos[], maxInstalled: number): boolean {
  if (inserts.length >= maxInstalled) return false;
  const taken = occupied(inserts);
  return cells.every((p) => inside(size, p) && !taken.has(posKey(p)));
}

/** 升级可添加的格：与该嵌片某格正交相邻、在棋盘内、未被任何嵌片占用 */
export function expansionCells(size: BoardSize, inserts: readonly InstalledInsert[], target: InstalledInsert): Pos[] {
  const taken = occupied(inserts);
  const own = new Set(target.cells.map(posKey));
  const out = new Map<number, Pos>();
  for (const p of target.cells) {
    for (const d of [{ r: -1, c: 0 }, { r: 1, c: 0 }, { r: 0, c: -1 }, { r: 0, c: 1 }]) {
      const q = { r: p.r + d.r, c: p.c + d.c };
      const k = posKey(q);
      if (inside(size, q) && !taken.has(k) && !own.has(k)) out.set(k, q);
    }
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([, q]) => q);
}
