import { describe, expect, it } from 'vitest';
import { findGroups, findLines, passiveBombCell } from './match';
import { boardWith } from './test-utils';

const cells = (...rc: [number, number][]) => Object.fromEntries(rc.map(([r, c]) => [`${r},${c}`, 'a']));

describe('匹配识别与归组（SPECIAL_TILES 实例）', () => {
  it('例 2：横五连与竖三连共享一格，合为一组，只产一枚 CB', () => {
    const board = boardWith(cells([4, 0], [4, 1], [4, 2], [4, 3], [4, 4], [2, 2], [3, 2]));
    const groups = findGroups(board);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.product).toBe('CB');
    expect(groups[0]!.cells).toHaveLength(7);
  });

  it('例 3：平行相贴的两条横四连是两组，各产 H 于本行最左格', () => {
    const board = boardWith(cells([5, 1], [5, 2], [5, 3], [5, 4], [6, 1], [6, 2], [6, 3], [6, 4]));
    const groups = findGroups(board);
    expect(groups.map((g) => g.product)).toEqual(['H', 'H']);
    expect(groups.map((g) => passiveBombCell(g, 'down'))).toEqual([
      { r: 5, c: 1 },
      { r: 6, c: 1 },
    ]);
  });

  it('例 4：L 形产 A，产在横竖交叉的拐角，与重力方向无关', () => {
    const board = boardWith(cells([5, 1], [5, 2], [5, 3], [5, 4], [3, 4], [4, 4]));
    const [g] = findGroups(board);
    expect(g!.product).toBe('A');
    expect(passiveBombCell(g!, 'down')).toEqual({ r: 5, c: 4 });
    expect(passiveBombCell(g!, 'up')).toEqual({ r: 5, c: 4 });
  });

  it('直线组取刚落定的格；没有落定信息时按重力最远端', () => {
    const board = boardWith(cells([5, 1], [5, 2], [5, 3], [5, 4]));
    const [g] = findGroups(board);
    expect(passiveBombCell(g!, 'down', [{ r: 5, c: 3 }, { r: 4, c: 3 }])).toEqual({ r: 5, c: 3 });
    expect(passiveBombCell(g!, 'down')).toEqual({ r: 5, c: 1 });
  });

  it('例 5：竖四连按重力方向取最远端', () => {
    const board = boardWith(cells([2, 6], [3, 6], [4, 6], [5, 6]));
    const [g] = findGroups(board);
    expect(g!.product).toBe('V');
    expect(passiveBombCell(g!, 'down')).toEqual({ r: 5, c: 6 });
    expect(passiveBombCell(g!, 'up')).toEqual({ r: 2, c: 6 });
  });

  it('例 6：一线六连只产一枚 CB', () => {
    const board = boardWith(cells([7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]));
    const groups = findGroups(board);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.product).toBe('CB');
  });

  it('普通三连不产弹', () => {
    const [g] = findGroups(boardWith(cells([0, 0], [0, 1], [0, 2])));
    expect(g!.product).toBeNull();
  });

  it('炸弹打断连续性：a a H a a 不构成匹配', () => {
    const board = boardWith({ ...cells([0, 0], [0, 1], [0, 3], [0, 4]), '0,2': 'H' });
    expect(findLines(board)).toHaveLength(0);
  });

  it('填充棋盘自身没有匹配', () => {
    expect(findLines(boardWith({}))).toHaveLength(0);
  });
});
