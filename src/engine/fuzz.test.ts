import { describe, expect, it } from 'vitest';
import { createBoard, createIdGen, weightedSpawner } from './board';
import { DEFAULT_CONFIG } from './config';
import { findLines } from './match';
import { resolveAction, type ResolutionEvent } from './resolve';
import { createRng } from './rng';
import type { Action, Board } from './types';

// 随机对局压力测试：检查每次行动后的不变量，而不是具体数值
describe('随机行动的不变量', () => {
  it('200 个种子 × 40 步：棋盘稳定、计数与日志一致、结算必定终止', () => {
    let bombActions = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rng = createRng(seed);
      const ids = createIdGen();
      const ctx = { config: DEFAULT_CONFIG, rng, ids, spawn: weightedSpawner(rng, DEFAULT_CONFIG), gravity: seed % 2 ? ('down' as const) : ('up' as const) };
      let board: Board = createBoard(rng, ids, DEFAULT_CONFIG);
      for (let step = 0; step < 40; step++) {
        const action = randomAction(board, rng.int.bind(rng));
        const res = resolveAction(board, action, ctx);
        if (!res.valid) continue;
        if (action.type === 'ignite' || res.events.some((e) => e.type === 'wave')) bombActions++;
        board = res.board;
        expect(board.flat().every((t) => t !== null)).toBe(true);
        expect(findLines(board)).toHaveLength(0);
        expect(res.passiveClearCount).toBe(passiveFromEvents(res.events));
      }
    }
    expect(bombActions).toBeGreaterThan(100); // 确认压力测试确实覆盖了炸弹结算
  });
});

function randomAction(board: Board, int: (n: number) => number): Action {
  const bombs: { r: number; c: number }[] = [];
  board.forEach((row, r) => row.forEach((t, c) => t?.kind === 'bomb' && bombs.push({ r, c })));
  if (bombs.length > 0 && int(3) === 0) return { type: 'ignite', at: bombs[int(bombs.length)]! };
  const from = { r: int(8), c: int(8) };
  const dirs = [
    { r: 0, c: 1 },
    { r: 1, c: 0 },
    { r: 0, c: -1 },
    { r: -1, c: 0 },
  ];
  const d = dirs[int(4)]!;
  return { type: 'swap', from, to: { r: from.r + d.r, c: from.c + d.c } };
}

function passiveFromEvents(events: ResolutionEvent[]): number {
  let n = 0;
  for (const e of events) {
    if (e.type === 'matches' && e.phase === 'passive') n += e.cleared.length;
    if (e.type === 'wave' && e.phase === 'passive') n += e.cleared.length + e.consumed.length + e.converted.filter((x) => x.from).length;
  }
  return n;
}
