// 测试用棋盘构造。字符：a 攻击、s 护盾、p 毒气、c 催化剂、H/V/A 炸弹、B 五连炸弹 CB、. 填充。
// 填充格按棋盘格交替毒气／催化剂，相邻格颜色必不相同，因此不会自行成线。
import { createIdGen, weightedSpawner, type IdGen, type Spawner } from './board';
import { DEFAULT_CONFIG } from './config';
import { createRng } from './rng';
import type { ResolveContext } from './resolve';
import type { Board, BombKind, Color, Tile } from './types';

const COLOR_OF: Record<string, Color> = { a: 'attack', s: 'shield', p: 'poison', c: 'catalyst' };
const BOMB_OF: Record<string, BombKind> = { H: 'H', V: 'V', A: 'A', B: 'CB' };

export const filler = (r: number, c: number): Color => ((r + c) % 2 === 0 ? 'poison' : 'catalyst');

export function parseBoard(lines: string[], ids: IdGen = createIdGen()): Board {
  return lines.map((line, r) =>
    line
      .replace(/\s+/g, '')
      .split('')
      .map((ch, c): Tile => {
        if (ch === '.') return { id: ids.next(), kind: 'normal', color: filler(r, c) };
        const color = COLOR_OF[ch];
        if (color) return { id: ids.next(), kind: 'normal', color };
        const bomb = BOMB_OF[ch];
        if (bomb) return { id: ids.next(), kind: 'bomb', bomb };
        throw new Error(`未知字符 ${ch}`);
      }),
  );
}

/** 8×8 全填充棋盘，再按 {'r,c': 字符} 覆盖指定格 */
export function boardWith(overrides: Record<string, string>): Board {
  const lines = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => overrides[`${r},${c}`] ?? '.').join(''),
  );
  return parseBoard(lines);
}

/** 交替补入护盾与攻击，避免与毒气／催化剂填充意外成线 */
export function alternatingSpawner(): Spawner {
  let k = 0;
  return () => (k++ % 2 === 0 ? 'shield' : 'attack');
}

export function testCtx(seed = 1, spawn?: Spawner): ResolveContext {
  const rng = createRng(seed);
  return {
    config: DEFAULT_CONFIG,
    rng,
    ids: createIdGen(10_000),
    spawn: spawn ?? alternatingSpawner(),
    gravity: 'down',
  };
}

/** 按种子随机补位；大面积补位的测试用它，避免固定序列造成无限连锁 */
export function randomCtx(seed = 1): ResolveContext {
  const ctx = testCtx(seed);
  return { ...ctx, spawn: weightedSpawner(ctx.rng, DEFAULT_CONFIG) };
}
