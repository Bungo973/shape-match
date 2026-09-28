// 战后嵌片三选一的生成，规则见 docs/MAP.md「嵌片候选的半引导规则」与本文件注释。
// 候选只由（局种子、第几场、第几次重掷）决定，不受战斗中随机数用量影响，保证复现。
import type { ArtifactKey } from './artifacts';
import { canPlace, INSERT_DEFS, rotate, SHAPES, translate, type BoardSize, type InsertType, type InstalledInsert, type Rarity, type ShapeName } from './inserts';
import { createRng, type Rng } from './rng';

// ---- 产出／需求标签：构筑位据此判断“能否接上已持有的东西” ----

/** line 直线炸弹、area 3×3 炸弹、bombSpawn 在覆盖格上生成炸弹、explosion 额外爆炸、clear 整片连带清除、base 基数 */
export type SynergyTag = 'line' | 'area' | 'bombSpawn' | 'explosion' | 'clear' | 'base';

interface Tags {
  produces: SynergyTag[];
  needs: SynergyTag[];
}

export const INSERT_TAGS: Record<InsertType, Tags> = {
  blade: { produces: ['base'], needs: [] },
  bulwark: { produces: ['base'], needs: [] },
  venomSac: { produces: ['base'], needs: [] },
  catalystSalt: { produces: ['base'], needs: [] },
  earthPowder: { produces: ['line', 'bombSpawn'], needs: [] },
  flammable: { produces: ['explosion'], needs: ['bombSpawn'] },
  emberClay: { produces: ['explosion'], needs: ['line'] },
  quakeStone: { produces: ['explosion'], needs: ['area'] },
  blastPowder: { produces: ['clear'], needs: ['explosion'] },
};

export const ARTIFACT_TAGS: Partial<Record<ArtifactKey, Tags>> = {
  overloadFuse: { produces: ['explosion'], needs: ['line'] },
  unstableFuse: { produces: [], needs: ['bombSpawn'] },
  lockResonator: { produces: [], needs: ['clear'] },
  resonanceBase: { produces: [], needs: ['base', 'explosion', 'clear'] },
};

/** 不依赖其他持有物也能起作用的嵌片 */
const isStable = (t: InsertType) => INSERT_TAGS[t].needs.length === 0;

// ---- 稀有度权重：随场次从普通为主逐步移向高档（占位值，待模拟器校准） ----

export function rarityWeights(battleIndex: number): Record<Rarity, number> {
  const t = Math.min(1, Math.max(0, (battleIndex - 1) / 7));
  return {
    common: 60 - 40 * t,
    rare: 30 + 5 * t,
    epic: 10 + 20 * t,
    perfect: 15 * t,
  };
}

// ---- 生成 ----

export type RewardSlot = 'stable' | 'build' | 'surprise';

export interface InsertCandidate {
  slot: RewardSlot;
  type: InsertType;
  shape: ShapeName;
}

export interface RewardInput {
  runSeed: number;
  /** 第几场战斗（1 起） */
  battleIndex: number;
  /** 本场已重掷次数（0 为首次展示） */
  rerollCount: number;
  /** 已持有（已安装与随身匣）的嵌片种类；同名不再出现 */
  owned: InsertType[];
  artifacts: ArtifactKey[];
  /** 当前棋盘上已安装的嵌片，用于判断能否立刻嵌入 */
  installed: InstalledInsert[];
  size: BoardSize;
  maxInstalled: number;
  /** 重掷时的上一组候选：新一组不能与之完全相同 */
  previous?: InsertCandidate[];
  /** 拾荒眼镜：重掷时保留的上一组候选下标 */
  keepIndex?: number;
  /** 可出现的嵌片种类；默认为全部已实现的种类 */
  pool?: InsertType[];
}

const SHAPE_NAMES = Object.keys(SHAPES) as ShapeName[];

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

function pickByRarity(rng: Rng, options: InsertType[], weights: Record<Rarity, number>): InsertType | null {
  const usable = options.filter((t) => weights[INSERT_DEFS[t].rarity] > 0);
  const list = usable.length > 0 ? usable : options;
  if (list.length === 0) return null;
  const w = (t: InsertType) => (usable.length > 0 ? weights[INSERT_DEFS[t].rarity] : 1);
  const total = list.reduce((s, t) => s + w(t), 0);
  let roll = rng.next() * total;
  for (const t of list) {
    roll -= w(t);
    if (roll < 0) return t;
  }
  return list[list.length - 1]!;
}

/** 某个形状在当前棋盘上是否存在任何旋转与位置可以嵌入 */
export function shapeFits(shape: ShapeName, input: Pick<RewardInput, 'installed' | 'size' | 'maxInstalled'>): boolean {
  let cells = SHAPES[shape];
  for (let rot = 0; rot < 4; rot++) {
    for (let r = 0; r < input.size.rows; r++) {
      for (let c = 0; c < input.size.cols; c++) {
        if (canPlace(input.size, input.installed, translate(cells, { r, c }), input.maxInstalled)) return true;
      }
    }
    cells = rotate(cells);
  }
  return false;
}

function generateOnce(input: RewardInput, salt: number): InsertCandidate[] {
  const rng = createRng(mixSeed(input.runSeed, input.battleIndex, input.rerollCount, salt));
  const weights = rarityWeights(input.battleIndex);
  const pool = (input.pool ?? (Object.keys(INSERT_DEFS) as InsertType[])).filter((t) => !input.owned.includes(t));
  const taken = new Set<InsertType>();
  const out: InsertCandidate[] = [];

  const kept = input.keepIndex != null ? input.previous?.[input.keepIndex] : undefined;
  if (kept) taken.add(kept.type);

  const free = (list: InsertType[]) => list.filter((t) => !taken.has(t));
  const add = (slot: RewardSlot, type: InsertType | null) => {
    if (!type) return;
    taken.add(type);
    out.push({ slot, type, shape: SHAPE_NAMES[rng.int(SHAPE_NAMES.length)]! });
  };

  // 持有物的产出与需求，用于判断构筑位
  const ownedTags = [...input.owned.map((t) => INSERT_TAGS[t]), ...input.artifacts.map((a) => ARTIFACT_TAGS[a]).filter((x): x is Tags => !!x)];
  const produced = new Set(ownedTags.flatMap((t) => t.produces));
  const needed = new Set(ownedTags.flatMap((t) => t.needs));
  const synergizes = (t: InsertType) =>
    INSERT_TAGS[t].needs.some((n) => produced.has(n)) || INSERT_TAGS[t].produces.some((p) => needed.has(p));

  const slots: RewardSlot[] = ['stable', 'build', 'surprise'];
  if (input.artifacts.includes('treasureMap')) slots.push('surprise');
  for (const slot of slots) {
    if (kept && kept.slot === slot && !out.some((c) => c.slot === slot)) {
      out.push(kept);
      continue;
    }
    let type: InsertType | null = null;
    if (slot === 'stable') type = pickByRarity(rng, free(pool.filter(isStable)), weights);
    if (slot === 'build') {
      type = pickByRarity(rng, free(pool.filter(synergizes)), weights);
      // 尚无可联动的持有物时，构筑位改为另一种独立作用
      type ??= pickByRarity(rng, free(pool.filter(isStable)), weights);
    }
    // 某个位置已没有合适规则时，从其他未持有的规则补齐
    type ??= pickByRarity(rng, free(pool), weights);
    add(slot, type);
  }

  // 可放置保护：若候选都放不进当前棋盘、但有形状能放下，就把最后一个惊喜位换成能放下的形状
  if (out.length > 0 && !out.some((c) => shapeFits(c.shape, input))) {
    const fitting = SHAPE_NAMES.filter((s) => shapeFits(s, input));
    const target = [...out].reverse().find((c) => c !== kept);
    if (fitting.length > 0 && target) target.shape = fitting[rng.int(fitting.length)]!;
  }
  return out;
}

/** 生成一组嵌片候选；重掷时保证与上一组不完全相同 */
export function generateInsertChoices(input: RewardInput): InsertCandidate[] {
  const key = (cs: InsertCandidate[]) => cs.map((c) => `${c.type}/${c.shape}`).sort().join(',');
  const prev = input.previous ? key(input.previous) : null;
  for (let salt = 0; salt < 16; salt++) {
    const out = generateOnce(input, salt);
    if (key(out) !== prev) return out;
  }
  return generateOnce(input, 16);
}
