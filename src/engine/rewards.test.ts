import { describe, expect, it } from 'vitest';
import { generateUpgradeChoices, type RewardInput } from './rewards';
import { defaultLevels, type UpgradeKey } from './upgrades';

const base = (over: Partial<RewardInput> = {}): RewardInput => ({
  runSeed: 123,
  battleIndex: 1,
  rerollCount: 0,
  levels: defaultLevels(),
  artifacts: [],
  ...over,
});

const keys = (cs: { key: UpgradeKey }[]) => cs.map((c) => c.key);
const BLOCKS: UpgradeKey[] = ['attack', 'shield', 'poison', 'catalyst'];

describe('升级三选一', () => {
  it('同样的输入得到同样的候选；换场次或重掷次数则独立生成', () => {
    expect(generateUpgradeChoices(base())).toEqual(generateUpgradeChoices(base()));
    const seen = new Set([1, 2, 3, 4, 5, 6].map((b) => keys(generateUpgradeChoices(base({ battleIndex: b }))).join()));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('三个位置、同一组内互不重复', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const cs = generateUpgradeChoices(base({ runSeed: seed }));
      expect(cs.map((c) => c.slot)).toEqual(['stable', 'build', 'surprise']);
      expect(new Set(keys(cs)).size).toBe(3);
    }
  });

  it('稳定位只出基础方块', () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(BLOCKS).toContain(generateUpgradeChoices(base({ runSeed: seed }))[0]!.key);
    }
  });

  it('构筑位偏向已升级的项目：只升过直线炸弹时，构筑位总是它', () => {
    const levels = { ...defaultLevels(), line: 3 };
    for (let seed = 1; seed <= 30; seed++) {
      expect(generateUpgradeChoices(base({ runSeed: seed, levels }))[1]!.key).toBe('line');
    }
  });

  it('重掷后与上一组不完全相同；拾荒眼镜保留选中的一项', () => {
    const first = generateUpgradeChoices(base());
    const again = generateUpgradeChoices(base({ rerollCount: 1, previous: first }));
    expect(keys(again).sort()).not.toEqual(keys(first).sort());
    const kept = generateUpgradeChoices(base({ rerollCount: 1, previous: first, keepIndex: 1, artifacts: ['scavengerGoggles'] }));
    expect(kept[1]).toEqual(first[1]);
    expect(new Set(keys(kept)).size).toBe(3);
  });

  it('藏宝图残页：多一个惊喜位，四项互不重复', () => {
    const cs = generateUpgradeChoices(base({ artifacts: ['treasureMap'] }));
    expect(cs).toHaveLength(4);
    expect(new Set(keys(cs)).size).toBe(4);
  });
});
