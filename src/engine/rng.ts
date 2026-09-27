// 可复现的种子随机数（mulberry32）。状态是一个 32 位整数，可直接写入存档。

export interface Rng {
  /** 返回 [0, 1) 的浮点数 */
  next(): number;
  /** 返回 [0, n) 的整数 */
  int(n: number): number;
  /** 当前内部状态，用于存档与复现 */
  readonly state: number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    get state() {
      return s;
    },
  };
}

/** 按权重从候选中抽取一项；候选顺序固定，保证复现。 */
export function pickWeighted<T extends string>(rng: Rng, items: readonly T[], weights: Record<T, number>): T {
  const total = items.reduce((sum, it) => sum + weights[it], 0);
  let roll = rng.next() * total;
  for (const it of items) {
    roll -= weights[it];
    if (roll < 0) return it;
  }
  return items[items.length - 1]!;
}
