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
  | 'glassCannon' // A36 玻璃炮
  // 2026-10-06 第二批：炸弹类
  | 'crossFuse' // A37 十字引线
  | 'bigBore' // A38 大口径
  | 'fission' // A39 裂变
  | 'hoarder' // A40 囤积者
  | 'marathon' // A41 长跑
  | 'ruler' // A42 尺规
  // 2026-10-06 第三批：节奏、金币与规则
  | 'piggyBank' // A45 存钱罐
  | 'defuser' // A46 拆弹工
  | 'goldWatch' // A47 金怀表
  | 'iceCream' // A48 冰淇淋
  | 'collector' // A49 收藏家
  | 'tycoon' // A50 富翁
  | 'medal' // A51 勋章
  | 'vacancy' // A52 空位
  | 'standIn' // A53 替身
  | 'exemption'; // A54 免检章

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
  crossFuse: { key: 'crossFuse', id: 'A37', name: '十字引线', rarity: 'rare', text: '直线炸弹爆炸时，垂直方向也向两侧各清除 2 格，成十字。' },
  bigBore: { key: 'bigBore', id: 'A38', name: '大口径', rarity: 'rare', text: '3×3 炸弹的范围扩大为菱形，上下左右多伸出 1 格（共 13 格）。' },
  fission: { key: 'fission', id: 'A39', name: '裂变', rarity: 'uncommon', text: '这一步有五连炸弹爆炸时，步末随机 2 个方块变成直线炸弹。' },
  hoarder: { key: 'hoarder', id: 'A40', name: '囤积者', rarity: 'uncommon', text: '结算时棋盘上每留着 1 枚炸弹，倍率 +0.2。' },
  marathon: { key: 'marathon', id: 'A41', name: '长跑', rarity: 'uncommon', text: '连续几步没有炸弹爆炸，每步倍率累加 +0.4；有炸弹爆炸就清零。' },
  piggyBank: { key: 'piggyBank', id: 'A45', name: '存钱罐', rarity: 'common', text: '每关结束时，手上每有 10 金币，利息 +1（最多 +5）。' },
  defuser: { key: 'defuser', id: 'A46', name: '拆弹工', rarity: 'common', text: '每关结束时，棋盘上每剩 1 枚炸弹 +1 金币（最多 +3）。' },
  goldWatch: { key: 'goldWatch', id: 'A47', name: '金怀表', rarity: 'common', text: '每关结束时 +2 金币。' },
  iceCream: { key: 'iceCream', id: 'A48', name: '冰淇淋', rarity: 'common', text: '基数 +20。每过一关少 4，减到 0 就化完了。' },
  collector: { key: 'collector', id: 'A49', name: '收藏家', rarity: 'common', text: '每持有 1 枚印记（含自己），倍率 +0.3。' },
  tycoon: { key: 'tycoon', id: 'A50', name: '富翁', rarity: 'uncommon', text: '开关时手上每有 5 金币，本关基数 +2。' },
  medal: { key: 'medal', id: 'A51', name: '勋章', rarity: 'uncommon', text: '每次提前 2 步以上达标，倍率永久 +0.3。' },
  vacancy: { key: 'vacancy', id: 'A52', name: '空位', rarity: 'uncommon', text: '印记栏每空 1 格，倍率 +0.5。' },
  standIn: { key: 'standIn', id: 'A53', name: '替身', rarity: 'uncommon', text: '未达标扣血会让生命归零时，改为不扣血，然后替身消失。' },
  exemption: { key: 'exemption', id: 'A54', name: '免检章', rarity: 'uncommon', text: '首领规则对你无效。' },
  ruler: { key: 'ruler', id: 'A42', name: '尺规', rarity: 'uncommon', every: 10, text: '每做出 10 枚直线炸弹，基数永久 +2。' },
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
  /** 十字引线：垂直方向向两侧各延伸的格数 */
  crossArm: 2,
  /** 大口径：以炸弹为中心、曼哈顿距离不超过此值的菱形 */
  bigBoreReach: 2,
  fissionBombs: 2,
  hoarderTenths: 2,
  marathonTenths: 4,
  rulerEvery: 10,
  /** 尺规每凑够一次给的基数（2026-10-06 连锁计基数转正，固定加基数的神器翻倍） */
  rulerBase: 2,
  piggyPer: 10,
  piggyMax: 5,
  defuserMax: 3,
  goldWatchGold: 2,
  iceCreamBase: 20,
  iceCreamMelt: 4,
  collectorTenths: 3,
  tycoonPer: 5,
  tycoonBase: 2,
  /** 勋章：达标时至少剩这么多步才算“提前” */
  medalSteps: 2,
  medalTenths: 3,
  vacancyTenths: 5,
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
