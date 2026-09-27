// 引擎的基础数据类型。坐标记作 { r, c }，第 0 行在最上方。

export const COLORS = ['attack', 'shield', 'poison', 'catalyst'] as const;
export type Color = (typeof COLORS)[number];

export type BombKind = 'H' | 'V' | 'A' | 'CB';

export interface Pos {
  r: number;
  c: number;
}

export interface NormalTile {
  id: number;
  kind: 'normal';
  color: Color;
}

export interface BombTile {
  id: number;
  kind: 'bomb';
  bomb: BombKind;
}

export type Tile = NormalTile | BombTile;

/** board[r][c]；null 只在结算过程中出现，稳定棋盘上没有空格。 */
export type Board = (Tile | null)[][];

export type Gravity = 'down' | 'up';

/** 第一次重力移动之前为主动阶段，之后为被动阶段。 */
export type Phase = 'active' | 'passive';

export type Action =
  /** from 为先选中或拖动起点的格；炸弹组合的锚点取其交换后的落点，即 to。 */
  | { type: 'swap'; from: Pos; to: Pos }
  | { type: 'ignite'; at: Pos };

export type ClearsByType = Record<Color, number>;

export const emptyClears = (): ClearsByType => ({ attack: 0, shield: 0, poison: 0, catalyst: 0 });
