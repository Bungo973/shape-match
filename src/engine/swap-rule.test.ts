import { describe, expect, it } from 'vitest';
import { createIdGen } from './board';
import { DEFAULT_CONFIG } from './config';
import { findLines } from './match';
import { resolveAction, type ResolutionEvent } from './resolve';
import { createRng } from './rng';
import { hasLegalMove, reshuffle } from './shuffle';
import { boardWith, parseBoard, randomCtx, testCtx } from './test-utils';
import type { Board } from './types';

type WaveEvent = Extract<ResolutionEvent, { type: 'wave' }>;

const config = DEFAULT_CONFIG;
const swap = (board: Board, from: [number, number], to: [number, number]) =>
  resolveAction(board, { type: 'swap', from: { r: from[0], c: from[1] }, to: { r: to[0], c: to[1] } }, testCtx());
const tileIds = (board: Board) => board.flat().map((t) => t!.id).sort((a, b) => a - b);

describe('只允许可匹配交换', () => {
  it('不形成匹配的普通交换无效，不耗 AP、棋盘不变', () => {
    const board = boardWith({ '0,0': 'a', '0,1': 's' });
    const res = swap(board, [0, 0], [0, 1]);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('noMatch');
    expect(res.apSpent).toBe(0);
    expect(res.board).toBe(board);
  });

  it('炸弹与普通方块交换，在落点直接引爆', () => {
    const board = boardWith({ '3,3': 'H', '3,4': 'a' });
    const res = swap(board, [3, 3], [3, 4]);
    expect(res.valid).toBe(true);
    const [w] = res.events.filter((e): e is WaveEvent => e.type === 'wave');
    expect(w!.phase).toBe('active');
    expect(w!.explosions[0]).toMatchObject({ shape: 'H', origin: { r: 3, c: 4 } });
    expect(w!.explosions[0]!.cells).toHaveLength(8);
  });

  it('换过去的普通方块成匹配时两边同时生效，重叠格只计一次', () => {
    // a 从 (3,4) 换到 (3,3)，与 (1,3)(2,3) 成竖三连；H 落在 (3,4) 清第 3 行，(3,3) 两边都覆盖
    const board = boardWith({ '1,3': 'a', '2,3': 'a', '3,3': 'H', '3,4': 'a' });
    const res = swap(board, [3, 3], [3, 4]);
    expect(res.events.map((e) => e.type).slice(0, 3)).toEqual(['swap', 'matches', 'wave']);
    expect(res.activeClearsByType.attack).toBe(3);
  });

  it('这次匹配做出的炸弹保留在落点，不被同一次爆炸引爆', () => {
    const board = boardWith({ '0,3': 'a', '1,3': 'a', '2,3': 'a', '3,3': 'H', '3,4': 'a' });
    const res = swap(board, [3, 3], [3, 4]);
    const made = res.events.find((e) => e.type === 'matches')!;
    const v = made.type === 'matches' ? made.created[0]! : null;
    expect(v).toMatchObject({ bomb: 'V', at: { r: 3, c: 3 } });
    const waves = res.events.filter((e): e is WaveEvent => e.type === 'wave');
    expect(waves).toHaveLength(1);
    expect(waves[0]!.queued).toEqual([]);
    expect(res.board.flat().some((t) => t?.id === v!.id)).toBe(true);
  });

  it('五连炸弹与普通方块交换仍按对方颜色清除', () => {
    const board = boardWith({ '3,3': 'B', '3,4': 'a', '6,6': 'a' });
    // 大面积补位改用随机补位，避免固定序列无限连锁
    const res = resolveAction(board, { type: 'swap', from: { r: 3, c: 3 }, to: { r: 3, c: 4 } }, randomCtx());
    const [w] = res.events.filter((e): e is WaveEvent => e.type === 'wave');
    expect(w!.explosions[0]).toMatchObject({ shape: 'CB', targetColor: 'attack' });
  });
});

describe('死局与自动重排', () => {
  // 四色错位排列：同色在行内相隔 4 格、在列内隔行出现，任意交换最多凑出两连
  const deadRows = () => Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => 'aspc'[(c + 2 * r) % 4]).join(''));
  const dead = () => parseBoard(deadRows());

  it('四色错位排列没有可走的步；有炸弹时总能点燃', () => {
    expect(hasLegalMove(dead())).toBe(false);
    expect(hasLegalMove(boardWith({ '0,0': 'H' }))).toBe(true);
  });

  it('重排后没有现成三连、至少有一步可走，且方块实体不变', () => {
    const board = dead();
    const out = reshuffle(board, createRng(7), config);
    expect(findLines(out.board)).toEqual([]);
    expect(hasLegalMove(out.board)).toBe(true);
    expect(tileIds(out.board)).toEqual(tileIds(board));
  });

  it('石块与炸弹不参与重排', () => {
    const lines = deadRows();
    lines[0] = 'X' + lines[0]!.slice(1);
    const board = parseBoard(lines, createIdGen());
    const out = reshuffle(board, createRng(3), config);
    expect(out.board[0]![0]).toBe(board[0]![0]);
  });
});
