// 神器池，规则见 docs/ARTIFACT_DESIGN.md 与 docs/BLOCK_BUILD.md「神器」；效果在 resolve.ts／battle.ts 按时机生效。
import type { EngineConfig } from './config';
import type { ActionResult } from './resolve';
import { COLORS, type ClearsByType } from './types';

export type ArtifactKey =
  | 'chainLens' // A14 连锁透镜
  | 'thunderFuse' // A22 雷鸣引线
  | 'fuseBox' // A23 引信匣（累加）
  | 'aftershockCore' // A25 余震核心（累加）
  | 'powderKeg' // A26 火药桶（回合开始）
  | 'prismOre' // A27 虹彩原石（回合开始）
  // 2026-10-06 第一批：计分类（借鉴《小丑牌》，见 docs/ARTIFACT_DESIGN.md「分级神器池」）
  | 'redNose' // A30 红鼻子
  | 'smallStep' // A31 小步
  | 'banana' // A32 香蕉
  | 'loner' // A33 独行
  | 'lastCall' // A34 末班车
  | 'loyaltyCard' // A35 积分卡
  | 'glassCannon'; // A36 玻璃炮

/** 稀有度决定价格、商店出现的权重与能从哪里拿到：开局只出普通，首领奖励只出罕见与稀有 */
export type ArtifactRarity = 'common' | 'uncommon' | 'rare';
export const RARITY_NAME: Record<ArtifactRarity, string> = { common: '普通', uncommon: '罕见', rare: '稀有' };

export interface ArtifactDef {
  key: ArtifactKey;
  /** 设计文档中的编号；同一时机按编号顺序结算 */
  id: string;
  name: string;
  rarity: ArtifactRarity;
  text: string;
  /** 卡面显示进度的门槛。累加触发类（引信匣、余震核心）进度跨关保留；积分卡按本关步数，每关重置 */
  every?: number;
}

// 2026-09-30 精简：冲分模式下只保留改变炸弹、连锁与步数的 6 件；
// 删除只对打怪有效的（反应线圈、溢流护符）、依赖颜色的（纯粹结晶、四色棱镜）、代价失效的（过载引线）
// 与绑定旧营地和重掷的（精工刻刀、拾荒眼镜、藏宝图残页）。见 docs/DESIGN_JOURNAL.md。
export const ARTIFACTS: Record<ArtifactKey, ArtifactDef> = {
  chainLens: { key: 'chainLens', id: 'A14', name: '连锁透镜', rarity: 'common', text: '连锁清除达到 3 格时，倍率 +1。' },
  thunderFuse: {
    key: 'thunderFuse',
    id: 'A22',
    name: '雷鸣引线',
    rarity: 'uncommon',
    text: '直线炸弹爆炸时引出闪电，在直线两侧 2 行（列）内随机击碎 5–8 个方块。',
  },
  fuseBox: { key: 'fuseBox', id: 'A23', name: '引信匣', rarity: 'uncommon', every: 15, text: '每引爆 15 枚炸弹，本回合 +1 步（每回合最多一次）。' },
  aftershockCore: { key: 'aftershockCore', id: 'A25', name: '余震核心', rarity: 'uncommon', every: 200, text: '连锁中每清除 200 格，棋盘上随机一个方块变成 3×3 炸弹。' },
  powderKeg: { key: 'powderKeg', id: 'A26', name: '火药桶', rarity: 'common', text: '每回合开始，棋盘上随机一个方块变成 3×3 炸弹。' },
  // 单带时每关都达标，过强：定为稀有
  prismOre: { key: 'prismOre', id: 'A27', name: '虹彩原石', rarity: 'rare', text: '每回合开始，棋盘上随机一个方块变成五连炸弹。' },
  redNose: { key: 'redNose', id: 'A30', name: '红鼻子', rarity: 'common', text: '倍率 +0.5。' },
  smallStep: { key: 'smallStep', id: 'A31', name: '小步', rarity: 'common', text: '这一步亲手只消除了 3 格时，倍率 +1.5。' },
  banana: { key: 'banana', id: 'A32', name: '香蕉', rarity: 'common', text: '倍率 +1.5。每关结束时有 1/6 的概率烂掉（消失）。' },
  loner: { key: 'loner', id: 'A33', name: '独行', rarity: 'common', text: '这一步没有任何炸弹爆炸时，基数 ×2。' },
  lastCall: { key: 'lastCall', id: 'A34', name: '末班车', rarity: 'uncommon', text: '每回合的最后一步，倍率 ×1.5。' },
  loyaltyCard: { key: 'loyaltyCard', id: 'A35', name: '积分卡', rarity: 'uncommon', every: 6, text: '每走 6 步，第 6 步倍率 ×3。' },
  glassCannon: { key: 'glassCannon', id: 'A36', name: '玻璃炮', rarity: 'rare', text: '倍率 ×3，但每回合少 1 步。' },
};

export const ARTIFACT_PARAMS = {
  /** 引信匣：每引爆多少枚炸弹，本回合 +1 行动力（每回合最多一次） */
  fuseBoxEvery: 15,
  fuseBoxAp: 1,
  /** 余震核心：每被动清除多少格，把棋盘上随机一个普通方块变成 3×3 炸弹 */
  aftershockEvery: 200,
  /** 雷鸣引线：闪电击碎的格数范围与离直线的最远行（列）距离 */
  thunderMin: 5,
  thunderMax: 8,
  thunderReach: 2,
  redNoseTenths: 5,
  smallStepTenths: 15,
  /** 小步：亲手消除的格数不超过这个数时触发 */
  smallStepMax: 3,
  bananaTenths: 15,
  /** 香蕉每关结束烂掉的概率 = 1 / bananaOdds */
  bananaOdds: 6,
  lonerBaseFactor: 2,
  lastCallFactor: 1.5,
  loyaltyEvery: 6,
  loyaltyFactor: 3,
  glassCannonFactor: 3,
  glassCannonApLoss: 1,
};

/** 当前可出现在开局、首领奖励与商店候选中的神器 */
export const offeredArtifacts = (_scoreMode = false): ArtifactKey[] => Object.keys(ARTIFACTS) as ArtifactKey[];

/** 神器的商店价格与卖出价（半价，向下取整） */
export const artifactPrice = (key: ArtifactKey, config: Pick<EngineConfig, 'artifactPrices'>): number => config.artifactPrices[ARTIFACTS[key].rarity];
export const artifactSellPrice = (key: ArtifactKey, config: Pick<EngineConfig, 'artifactPrices'>): number => Math.floor(artifactPrice(key, config) / 2);

/** 本步主动清除的有色方块数（不计等级与加成，炸弹不算） */
export function activeColorTileCount(events: ActionResult['events']): number {
  let n = 0;
  for (const e of events) {
    if (e.type === 'matches' && e.phase === 'active') n += e.cleared.filter((c) => c.tile.kind === 'normal').length;
    if (e.type === 'wave' && e.phase === 'active') {
      n += e.cleared.filter((c) => c.tile.kind === 'normal').length;
      n += e.converted.filter((c) => c.from?.tile.kind === 'normal').length;
    }
  }
  return n;
}
