// 神器池，规则见 docs/ARTIFACT_DESIGN.md「首版神器池」与 docs/BLOCK_BUILD.md「神器」。
// 战斗内的效果在 resolve.ts／battle.ts 按时机生效；战后类（精工刻刀、拾荒眼镜、藏宝图残页）由局流程使用。
import type { ActionResult } from './resolve';
import { COLORS, type ClearsByType } from './types';

export type ArtifactKey =
  | 'overloadFuse' // A06 过载引线（代价）
  | 'fineChisel' // A11 精工刻刀
  | 'reactionCoil' // A13 反应线圈
  | 'chainLens' // A14 连锁透镜
  | 'scavengerGoggles' // A16 拾荒眼镜
  | 'treasureMap' // A17 藏宝图残页
  | 'pureCrystal' // A18 纯粹结晶
  | 'fourPrism' // A19 四色棱镜
  | 'thunderFuse'; // A22 雷鸣引线

export interface ArtifactDef {
  key: ArtifactKey;
  /** 设计文档中的编号；同一时机按编号顺序结算 */
  id: string;
  name: string;
  /** 是否可出现在开局三选一 */
  starter: boolean;
  /** 卡面文案：收益 */
  text: string;
  /** 卡面文案：代价；领取前与收益同屏展示 */
  cost?: string;
}

export const ARTIFACTS: Record<ArtifactKey, ArtifactDef> = {
  overloadFuse: {
    key: 'overloadFuse',
    id: 'A06',
    name: '过载引线',
    starter: false,
    text: '直线炸弹清除三行／三列。',
    cost: '引爆过载直线炸弹的那一步不获得护盾。',
  },
  fineChisel: { key: 'fineChisel', id: 'A11', name: '精工刻刀', starter: false, text: '营地升级时多升一级。' },
  reactionCoil: { key: 'reactionCoil', id: 'A13', name: '反应线圈', starter: true, text: '护盾完全挡住攻击时，反击其一半伤害（碎甲时不触发）。' },
  chainLens: { key: 'chainLens', id: 'A14', name: '连锁透镜', starter: true, text: '被动连锁达到 3 时，倍率再提高一档。' },
  scavengerGoggles: { key: 'scavengerGoggles', id: 'A16', name: '拾荒眼镜', starter: false, text: '重掷升级奖励时可保留一项。' },
  treasureMap: { key: 'treasureMap', id: 'A17', name: '藏宝图残页', starter: true, text: '升级奖励多展示一个候选。' },
  pureCrystal: { key: 'pureCrystal', id: 'A18', name: '纯粹结晶', starter: true, text: '一步中只主动清除了一种颜色时，该色基数 +3。' },
  fourPrism: { key: 'fourPrism', id: 'A19', name: '四色棱镜', starter: false, text: '一步中主动清除了全部四种颜色时，每种基数 +2。' },
  thunderFuse: {
    key: 'thunderFuse',
    id: 'A22',
    name: '雷鸣引线',
    starter: false,
    text: '直线炸弹爆炸时引出闪电，在直线两侧 2 行（列）内随机击碎 5–8 个方块。',
  },
};

export const ARTIFACT_PARAMS = {
  /** 反应线圈：反击被完全挡住的那次攻击的这个比例（向下取整） */
  reactionCoilRatio: 0.5,
  /** 纯粹结晶：只清一种颜色时该色加的基数 */
  pureCrystalBonus: 3,
  /** 四色棱镜：四种颜色都清到时每种加的基数 */
  fourPrismBonus: 2,
  /** 雷鸣引线：闪电击碎的格数范围与离直线的最远行（列）距离 */
  thunderMin: 5,
  thunderMax: 8,
  thunderReach: 2,
};

/** 当前可出现在开局、精英、事件与商店候选中的神器 */
export const offeredArtifacts = (): ArtifactKey[] => Object.keys(ARTIFACTS) as ArtifactKey[];

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
 * 条件基数类神器（纯粹结晶、四色棱镜）在本步追加的基数。
 * 只看本步主动阶段的清除，不产生新触发；同为加法，与结算先后无关。
 */
export function artifactBaseBonus(result: Pick<ActionResult, 'activeClearsByType' | 'events'>, artifacts: readonly ArtifactKey[]): ClearsByType {
  const bonus: ClearsByType = { attack: 0, shield: 0, poison: 0, catalyst: 0 };
  const has = (k: ArtifactKey) => artifacts.includes(k);
  const cleared = COLORS.filter((c) => result.activeClearsByType[c] > 0);
  if (has('pureCrystal') && cleared.length === 1) bonus[cleared[0]!] += ARTIFACT_PARAMS.pureCrystalBonus;
  if (has('fourPrism') && cleared.length === COLORS.length) for (const c of COLORS) bonus[c] += ARTIFACT_PARAMS.fourPrismBonus;
  return bonus;
}

