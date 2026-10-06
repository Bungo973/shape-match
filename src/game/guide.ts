// 新手引导（2026-10-06）：第一次玩时，关内随情境弹出几句提示，每句只出一次。看过哪几句记在本地。
// 规格见 docs/VISUAL_STYLE.md「新手引导与说明」。

export type TipKey = 'swap' | 'score' | 'bomb' | 'goal';

/** 出现顺序：先教交换，第一次得分讲计分，棋盘上有炸弹时讲炸弹，最后讲过关与扣生命 */
export const TIPS: Record<TipKey, string> = {
  swap: '交换相邻两块，同色连成 3 个就消除。试试正在闪动的那两块。',
  score: '每一步得分 = 基数 × 倍率。清掉的每一块都计基数；消除后掉下来又连上的越多，倍率越高。',
  bomb: '黑块是炸弹：点两下原地引爆，或和旁边一块交换引爆。连成 4 个、5 个或 T / L 形会做出炸弹。',
  goal: '分数凑够目标就立即过关，剩下的步数换金币；步数用完还没凑够，按差距扣生命。',
};

const KEY = 'score-chase/guide';
const ALL = Object.keys(TIPS) as TipKey[];

function load(): Set<TipKey> {
  try {
    const raw = window.localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as TipKey[]) : []);
  } catch {
    return new Set();
  }
}

function save(seen: Set<TipKey>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...seen]));
  } catch {
    // 存储不可用时，引导每次都会出现，不影响游戏
  }
}

export const tipSeen = (k: TipKey): boolean => load().has(k);

export function markTip(k: TipKey): void {
  const seen = load();
  seen.add(k);
  save(seen);
}

/**
 * 一步走完后挑下一句提示（纯函数，便于测试）：交换那句没看过时不往下讲；
 * 这一步得了分讲计分，棋盘上有炸弹讲炸弹，计分讲过之后讲过关。关卡已结束时不出提示。
 */
export function nextTip(seen: ReadonlySet<TipKey>, now: { scored: boolean; hasBomb: boolean; ongoing: boolean }): TipKey | null {
  if (!now.ongoing || !seen.has('swap')) return null;
  const order: TipKey[] = ['score', 'bomb', 'goal'];
  return order.find((k) => !seen.has(k) && (k === 'score' ? now.scored : k === 'bomb' ? now.hasBomb : seen.has('score'))) ?? null;
}

export const seenTips = (): Set<TipKey> => load();

/** 跳过引导：全部记为看过 */
export const skipGuide = (): void => save(new Set(ALL));

/** 说明页里“重新看引导” */
export const resetGuide = (): void => save(new Set());
