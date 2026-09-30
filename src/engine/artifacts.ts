// 神器池，规则见 docs/ARTIFACT_DESIGN.md 与 docs/BLOCK_BUILD.md「神器」；效果在 resolve.ts／battle.ts 按时机生效。
import type { ActionResult } from './resolve';
import { COLORS, type ClearsByType } from './types';

export type ArtifactKey =
  | 'chainLens' // A14 连锁透镜
  | 'thunderFuse' // A22 雷鸣引线
  | 'fuseBox' // A23 引信匣（累加）
  | 'aftershockCore' // A25 余震核心（累加）
  | 'powderKeg' // A26 火药桶（回合开始）
  | 'prismOre'; // A27 虹彩原石（回合开始）

export interface ArtifactDef {
  key: ArtifactKey;
  /** 设计文档中的编号；同一时机按编号顺序结算 */
  id: string;
  name: string;
  /** 是否可出现在开局三选一 */
  starter: boolean;
  text: string;
  /** 累加触发类：进度跨战斗保留，达到门槛时在本步结束触发；卡面显示进度 */
  every?: number;
}

// 2026-09-30 精简：冲分模式下只保留改变炸弹、连锁与步数的 6 件；
// 删除只对打怪有效的（反应线圈、溢流护符）、依赖颜色的（纯粹结晶、四色棱镜）、代价失效的（过载引线）
// 与绑定旧营地和重掷的（精工刻刀、拾荒眼镜、藏宝图残页）。见 docs/DESIGN_JOURNAL.md。
export const ARTIFACTS: Record<ArtifactKey, ArtifactDef> = {
  chainLens: { key: 'chainLens', id: 'A14', name: '连锁透镜', starter: true, text: '连锁清除达到 3 格时，倍率再提高一档。' },
  thunderFuse: {
    key: 'thunderFuse',
    id: 'A22',
    name: '雷鸣引线',
    starter: true,
    text: '直线炸弹爆炸时引出闪电，在直线两侧 2 行（列）内随机击碎 5–8 个方块。',
  },
  fuseBox: { key: 'fuseBox', id: 'A23', name: '引信匣', starter: true, every: 15, text: '每引爆 15 枚炸弹，本回合 +1 步（每回合最多一次）。' },
  aftershockCore: { key: 'aftershockCore', id: 'A25', name: '余震核心', starter: true, every: 200, text: '连锁中每清除 200 格，棋盘上随机一个方块变成 3×3 炸弹。' },
  powderKeg: { key: 'powderKeg', id: 'A26', name: '火药桶', starter: true, text: '每回合开始，棋盘上随机一个方块变成 3×3 炸弹。' },
  // 单带时每关都达标，过强：不进开局候选，只在精英奖励中出现
  prismOre: { key: 'prismOre', id: 'A27', name: '虹彩原石', starter: false, text: '每回合开始，棋盘上随机一个方块变成五连炸弹。' },
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
};

/** 当前可出现在开局、精英、事件与商店候选中的神器；冲分模式排除只对打怪有意义的几件 */
export const offeredArtifacts = (_scoreMode = false): ArtifactKey[] => Object.keys(ARTIFACTS) as ArtifactKey[];

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
