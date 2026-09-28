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
  /** 卡面规则文案 */
  text: string;
}

export const INSERT_DEFS: Record<InsertType, InsertDef> = {
  blade: { type: 'blade', name: '锋刃', rarity: 'common', baseColor: 'attack', text: '主动清除覆盖格上的攻击方块，每格攻击基数 +2。' },
  bulwark: { type: 'bulwark', name: '壁垒', rarity: 'common', baseColor: 'shield', text: '主动清除覆盖格上的护盾方块，每格护盾基数 +2。' },
  venomSac: { type: 'venomSac', name: '毒囊', rarity: 'common', baseColor: 'poison', text: '主动清除覆盖格上的毒气方块，每格毒气基数 +2。' },
  catalystSalt: { type: 'catalystSalt', name: '催化盐', rarity: 'common', text: '主动清除覆盖格上的催化剂，每个多算一个。' },
  earthPowder: { type: 'earthPowder', name: '土质火药', rarity: 'rare', text: '普通三连碰到覆盖格时，也会留下一枚同向直线炸弹。' },
  flammable: { type: 'flammable', name: '易燃物质', rarity: 'rare', text: '炸弹在覆盖格上生成时立即引爆，不花行动力。' },
  emberClay: { type: 'emberClay', name: '火星陶', rarity: 'rare', text: '覆盖格上的直线炸弹引爆时，额外炸开周围 3×3。' },
  quakeStone: { type: 'quakeStone', name: '震裂石', rarity: 'epic', text: '覆盖格上的 3×3 炸弹引爆时，范围扩大为 5×5。' },
  blastPowder: { type: 'blastPowder', name: '火药嵌片', rarity: 'epic', text: '爆炸碰到任一覆盖格时，连带清除整块嵌片上的方块。' },
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

/** cells 是否为 shape 某个旋转的平移 */
export function isRotationOf(shape: Pos[], cells: Pos[]): boolean {
  const target = JSON.stringify(normalize(cells));
  let s = normalize(shape);
  for (let i = 0; i < 4; i++) {
    if (JSON.stringify(s) === target) return true;
    s = rotate(s);
  }
  return false;
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
