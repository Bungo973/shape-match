// 神器池，规则见 docs/ARTIFACT_DESIGN.md「首版神器池」与 docs/BLOCK_BUILD.md「神器」。
// 战斗内的效果在 resolve.ts／battle.ts 按时机生效；战后类（精工刻刀、拾荒眼镜、藏宝图残页）由局流程使用。
import type { ActionResult } from './resolve';
import { COLORS, type ClearsByType } from './types';

export type ArtifactKey =
  | 'piercingNeedle' // A01 穿甲针
  | 'sealedVial' // A02 密封毒瓶
  | 'overloadFuse' // A06 过载引线（代价）
  | 'unstableFuse' // A08 不稳定引信（代价）
  | 'resonanceBase' // A09 共振底座
  | 'lockResonator' // A10 锁位共鸣器
  | 'fineChisel' // A11 精工刻刀
  | 'reactionCoil' // A13 反应线圈
  | 'chainLens' // A14 连锁透镜
  | 'echoBell' // A15 回响钟
  | 'scavengerGoggles' // A16 拾荒眼镜
  | 'treasureMap' // A17 藏宝图残页
  | 'pureCrystal' // A18 纯粹结晶
  | 'fourPrism' // A19 四色棱镜
  | 'blastManual' // A20 爆破手册
  | 'sweepHorn' // A21 清场号角
  | 'thunderFuse'; // A22 雷鸣引线

export interface ArtifactDef {
  key: ArtifactKey;
  /** 设计文档中的编号；同一时机按编号顺序结算 */
  id: string;
  name: string;
  /** 是否可出现在开局三选一 */
  starter: boolean;
  /** 依赖已移除的系统（嵌片），不再进入任何候选；定义保留待改写 */
  retired?: boolean;
  /** 卡面文案：收益 */
  text: string;
  /** 卡面文案：代价；领取前与收益同屏展示 */
  cost?: string;
}

export const ARTIFACTS: Record<ArtifactKey, ArtifactDef> = {
  piercingNeedle: { key: 'piercingNeedle', id: 'A01', name: '穿甲针', starter: false, text: '攻击对护盾造成双倍削减。' },
  sealedVial: { key: 'sealedVial', id: 'A02', name: '密封毒瓶', starter: true, text: '眩晕后保留三分之一的毒气进度。' },
  overloadFuse: {
    key: 'overloadFuse',
    id: 'A06',
    name: '过载引线',
    starter: false,
    text: '直线炸弹清除三行／三列。',
    cost: '引爆过载直线炸弹的那一步不获得护盾。',
  },
  unstableFuse: {
    key: 'unstableFuse',
    id: 'A08',
    name: '不稳定引信',
    starter: false,
    text: '主动引爆的每枚炸弹都计入倍率。',
    cost: '回合结束时，棋盘上每枚炸弹对你造成 1 点伤害。',
  },
  resonanceBase: { key: 'resonanceBase', id: 'A09', name: '共振底座', starter: false, retired: true, text: '同一步触发两块不同嵌片时，倍率提高一档。' },
  lockResonator: { key: 'lockResonator', id: 'A10', name: '锁位共鸣器', starter: false, retired: true, text: '相邻的嵌片会一同被爆炸引动。' },
  fineChisel: { key: 'fineChisel', id: 'A11', name: '精工刻刀', starter: false, text: '营地升级时多升一级。' },
  reactionCoil: { key: 'reactionCoil', id: 'A13', name: '反应线圈', starter: true, text: '护盾完全挡住攻击时反击 2 点。' },
  chainLens: { key: 'chainLens', id: 'A14', name: '连锁透镜', starter: true, text: '被动连锁达到 3 时，倍率再提高一档。' },
  echoBell: { key: 'echoBell', id: 'A15', name: '回响钟', starter: true, text: '眩晕成功时，下回合多 1 点行动力。' },
  scavengerGoggles: { key: 'scavengerGoggles', id: 'A16', name: '拾荒眼镜', starter: false, text: '重掷升级奖励时可保留一项。' },
  treasureMap: { key: 'treasureMap', id: 'A17', name: '藏宝图残页', starter: true, text: '升级奖励多展示一个候选。' },
  pureCrystal: { key: 'pureCrystal', id: 'A18', name: '纯粹结晶', starter: true, text: '一步中只主动清除了一种颜色时，该色基数 +3。' },
  fourPrism: { key: 'fourPrism', id: 'A19', name: '四色棱镜', starter: false, text: '一步中主动清除了全部四种颜色时，每种基数 +2。' },
  blastManual: { key: 'blastManual', id: 'A20', name: '爆破手册', starter: true, text: '亲手每做出一枚炸弹，该组颜色基数再 +2。' },
  sweepHorn: { key: 'sweepHorn', id: 'A21', name: '清场号角', starter: false, text: '一步中主动清除至少 10 个方块时，攻击、护盾、毒气基数各 +1。' },
  thunderFuse: {
    key: 'thunderFuse',
    id: 'A22',
    name: '雷鸣引线',
    starter: false,
    text: '直线炸弹爆炸时引出闪电，在直线两侧 2 行（列）内随机击碎 5–8 个方块。',
  },
};

export const ARTIFACT_PARAMS = {
  /** 穿甲针：每点攻击削减的敌人护盾 */
  piercingShieldFactor: 2,
  /** 密封毒瓶：眩晕后保留的进度占阈值的比例 */
  sealedVialRetainRatio: 1 / 3,
  /** 反应线圈：反击伤害 */
  reactionCoilDamage: 2,
  /** 不稳定引信：每枚留存炸弹的伤害 */
  unstableFuseDamage: 1,
  /** 回响钟：下回合额外 AP */
  echoBellAp: 1,
  /** 纯粹结晶：只清一种颜色时该色加的基数 */
  pureCrystalBonus: 3,
  /** 四色棱镜：四种颜色都清到时每种加的基数 */
  fourPrismBonus: 2,
  /** 爆破手册：亲手每做出一枚炸弹给该组颜色加的基数 */
  blastManualBonus: 2,
  /** 清场号角：触发所需的主动清除方块数与每类加值 */
  sweepHornThreshold: 10,
  sweepHornBonus: 1,
  /** 雷鸣引线：闪电击碎的格数范围与离直线的最远行（列）距离 */
  thunderMin: 5,
  thunderMax: 8,
  thunderReach: 2,
};

/** 当前可出现在开局、精英、事件与商店候选中的神器 */
export const offeredArtifacts = (): ArtifactKey[] => (Object.keys(ARTIFACTS) as ArtifactKey[]).filter((k) => !ARTIFACTS[k].retired);

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

/**
 * 条件基数类神器（纯粹结晶、四色棱镜、爆破手册、清场号角）在本步追加的基数。
 * 只看本步主动阶段的清除，不产生新触发；同为加法，与结算先后无关。
 */
export function artifactBaseBonus(result: Pick<ActionResult, 'activeClearsByType' | 'events'>, artifacts: readonly ArtifactKey[]): ClearsByType {
  const bonus: ClearsByType = { attack: 0, shield: 0, poison: 0, catalyst: 0 };
  const has = (k: ArtifactKey) => artifacts.includes(k);
  const cleared = COLORS.filter((c) => result.activeClearsByType[c] > 0);
  if (has('pureCrystal') && cleared.length === 1) bonus[cleared[0]!] += ARTIFACT_PARAMS.pureCrystalBonus;
  if (has('fourPrism') && cleared.length === COLORS.length) for (const c of COLORS) bonus[c] += ARTIFACT_PARAMS.fourPrismBonus;
  if (has('blastManual')) {
    for (const e of result.events) {
      if (e.type !== 'matches' || e.phase !== 'active') continue;
      for (const g of e.groups) if (g.product) bonus[g.color] += ARTIFACT_PARAMS.blastManualBonus;
    }
  }
  if (has('sweepHorn') && activeColorTileCount(result.events) >= ARTIFACT_PARAMS.sweepHornThreshold) {
    for (const c of ['attack', 'shield', 'poison'] as const) bonus[c] += ARTIFACT_PARAMS.sweepHornBonus;
  }
  return bonus;
}

