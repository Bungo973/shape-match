import { describe, expect, it } from 'vitest';
import { INSERT_DEFS, type InsertType, type InstalledInsert } from './inserts';
import { generateInsertChoices, INSERT_TAGS, rarityWeights, shapeFits, type RewardInput } from './rewards';

const base = (over: Partial<RewardInput> = {}): RewardInput => ({
  runSeed: 123,
  battleIndex: 1,
  rerollCount: 0,
  owned: [],
  artifacts: [],
  installed: [],
  size: { rows: 8, cols: 8 },
  maxInstalled: 6,
  ...over,
});

const types = (cs: { type: InsertType }[]) => cs.map((c) => c.type);

describe('嵌片三选一', () => {
  it('同样的输入得到同样的候选；换场次或重掷次数则独立生成', () => {
    expect(generateInsertChoices(base())).toEqual(generateInsertChoices(base()));
    const seen = new Set<string>();
    for (let b = 1; b <= 8; b++) seen.add(JSON.stringify(generateInsertChoices(base({ battleIndex: b }))));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('三个位置、互不重复、不出现已持有的种类', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const owned: InsertType[] = ['blade', 'earthPowder'];
      const cs = generateInsertChoices(base({ runSeed: seed, owned }));
      expect(cs.map((c) => c.slot)).toEqual(['stable', 'build', 'surprise']);
      expect(new Set(types(cs)).size).toBe(3);
      expect(types(cs).some((t) => owned.includes(t))).toBe(false);
    }
  });

  it('稳定位只出不依赖其他持有物的嵌片', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const [stable] = generateInsertChoices(base({ runSeed: seed }));
      expect(INSERT_TAGS[stable!.type].needs).toEqual([]);
    }
  });

  it('构筑位：持有土质火药时，给能吃到直线炸弹或炸弹生成的嵌片', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const build = generateInsertChoices(base({ runSeed: seed, owned: ['earthPowder'] }))[1]!;
      expect(['flammable', 'emberClay']).toContain(build.type);
    }
  });

  it('构筑位：神器也参与联动判断（过载引线需要直线炸弹、产出爆炸）', () => {
    const builds = new Set<InsertType>();
    for (let seed = 1; seed <= 100; seed++) builds.add(generateInsertChoices(base({ runSeed: seed, artifacts: ['overloadFuse'] }))[1]!.type);
    // 土质火药产出直线炸弹喂给它；火药嵌片吃它产出的爆炸
    expect([...builds].sort()).toEqual(['blastPowder', 'earthPowder']);
  });

  it('构筑位：尚无可联动的持有物时改为稳定嵌片', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const build = generateInsertChoices(base({ runSeed: seed }))[1]!;
      expect(INSERT_TAGS[build.type].needs).toEqual([]);
    }
  });

  it('稀有度随场次提高：第 1 场没有完美档，第 8 场高档权重更大', () => {
    expect(rarityWeights(1).perfect).toBe(0);
    expect(rarityWeights(8).epic + rarityWeights(8).perfect).toBeGreaterThan(rarityWeights(1).epic + rarityWeights(1).perfect);
    const early = Array.from({ length: 300 }, (_, i) => generateInsertChoices(base({ runSeed: i }))[2]!.type);
    expect(early.filter((t) => INSERT_DEFS[t].rarity === 'common').length).toBeGreaterThan(100);
  });

  it('可放置保护：棋盘只剩一条 1×4 空位时，至少一个候选是 I 形', () => {
    // 除第 7 行 c0–c3 外全部被嵌片占满
    const installed: InstalledInsert[] = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (r === 7 && c < 4) continue;
        installed.push({ id: `f${r}${c}`, type: 'blade', cells: [{ r, c }] });
      }
    }
    for (let seed = 1; seed <= 50; seed++) {
      const cs = generateInsertChoices(base({ runSeed: seed, installed, maxInstalled: 999 }));
      expect(cs.some((c) => c.shape === 'I')).toBe(true);
      expect(cs.some((c) => shapeFits(c.shape, { installed, size: { rows: 8, cols: 8 }, maxInstalled: 999 }))).toBe(true);
    }
  });

  it('重掷后与上一组不完全相同；拾荒眼镜保留选中的一项', () => {
    const first = generateInsertChoices(base());
    const again = generateInsertChoices(base({ rerollCount: 1, previous: first }));
    expect(again).not.toEqual(first);
    const kept = generateInsertChoices(base({ rerollCount: 1, previous: first, keepIndex: 1, artifacts: ['scavengerGoggles'] }));
    expect(kept[1]).toEqual(first[1]);
    expect(new Set(types(kept)).size).toBe(3);
  });

  it('藏宝图残页：多一个惊喜位，四项互不重复', () => {
    const cs = generateInsertChoices(base({ artifacts: ['treasureMap'] }));
    expect(cs.map((c) => c.slot)).toEqual(['stable', 'build', 'surprise', 'surprise']);
    expect(new Set(types(cs)).size).toBe(4);
  });

  it('未持有的种类不足三种时，有几种给几种', () => {
    const owned = (Object.keys(INSERT_DEFS) as InsertType[]).slice(0, 7);
    expect(generateInsertChoices(base({ owned }))).toHaveLength(2);
  });
});
