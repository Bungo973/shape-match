// 战后升级三选一的生成，规则见 docs/BLOCK_BUILD.md「奖励与营地」。
// 候选只由（局种子、第几场、第几次重掷）决定，不受战斗中随机数用量影响，保证复现。
import type { ArtifactKey } from './artifacts';
import { createRng, type Rng } from './rng';
import { UPGRADE_KEYS, type UpgradeKey, type UpgradeLevels } from './upgrades';

/**
 * stable 稳定：一种基础方块，任何时候都直接有用；
 * build 构筑：偏向已经升过的项目，让构筑方向越走越清楚；
 * surprise 惊喜：任意一项。
 */
export type RewardSlot = 'stable' | 'build' | 'surprise';

export interface UpgradeCandidate {
  slot: RewardSlot;
  key: UpgradeKey;
}

export interface RewardInput {
  runSeed: number;
  /** 第几场战斗（1 起） */
  battleIndex: number;
  /** 本场已重掷次数（0 为首次展示） */
  rerollCount: number;
  levels: UpgradeLevels;
  artifacts: ArtifactKey[];
  /** 重掷时的上一组候选：新一组不能与之完全相同 */
  previous?: UpgradeCandidate[];
  /** 拾荒眼镜：重掷时保留的上一组候选下标 */
  keepIndex?: number;
}

const BLOCK_KEYS: readonly UpgradeKey[] = ['attack', 'shield', 'poison', 'catalyst'];

/** 把几个整数混合成一个种子（splitmix 风格），让各次奖励各自独立 */
export function mixSeed(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h = Math.imul(h ^ (p >>> 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

function pickWeighted(rng: Rng, options: UpgradeKey[], weight: (k: UpgradeKey) => number): UpgradeKey | null {
  const list = options.filter((k) => weight(k) > 0);
  if (list.length === 0) return null;
  const total = list.reduce((s, k) => s + weight(k), 0);
  let roll = rng.next() * total;
  for (const k of list) {
    roll -= weight(k);
    if (roll < 0) return k;
  }
  return list[list.length - 1]!;
}

function generateOnce(input: RewardInput, salt: number): UpgradeCandidate[] {
  const rng = createRng(mixSeed(input.runSeed, input.battleIndex, input.rerollCount, salt));
  const kept = input.keepIndex != null ? input.previous?.[input.keepIndex] : undefined;
  const taken = new Set<UpgradeKey>(kept ? [kept.key] : []);
  const free = (list: readonly UpgradeKey[]) => list.filter((k) => !taken.has(k));
  const out: UpgradeCandidate[] = [];

  const slots: RewardSlot[] = ['stable', 'build', 'surprise'];
  if (input.artifacts.includes('treasureMap')) slots.push('surprise');
  for (const slot of slots) {
    if (kept && kept.slot === slot && !out.some((c) => c.slot === slot)) {
      out.push(kept);
      continue;
    }
    let key: UpgradeKey | null = null;
    if (slot === 'stable') key = pickWeighted(rng, free(BLOCK_KEYS), () => 1);
    // 构筑位按已升级数加权；还没有任何升级时退化为任意一项
    if (slot === 'build') key = pickWeighted(rng, free(UPGRADE_KEYS), (k) => input.levels[k] - 1);
    key ??= pickWeighted(rng, free(UPGRADE_KEYS), () => 1);
    if (!key) continue;
    taken.add(key);
    out.push({ slot, key });
  }
  return out;
}

/** 生成一组升级候选（同一组内不重复）；重掷时保证与上一组不完全相同 */
export function generateUpgradeChoices(input: RewardInput): UpgradeCandidate[] {
  const sig = (cs: UpgradeCandidate[]) => cs.map((c) => c.key).sort().join(',');
  const prev = input.previous ? sig(input.previous) : null;
  for (let salt = 0; salt < 16; salt++) {
    const out = generateOnce(input, salt);
    if (sig(out) !== prev) return out;
  }
  return generateOnce(input, 16);
}
