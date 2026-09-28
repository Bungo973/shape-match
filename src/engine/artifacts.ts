// 首版神器池（12 件），规则见 docs/ARTIFACT_DESIGN.md「首版神器池」。
// 战斗内的效果在 resolve.ts／battle.ts 按时机生效；战后类（精工刻刀、拾荒眼镜、藏宝图残页）由局流程使用。

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
  | 'treasureMap'; // A17 藏宝图残页

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
  resonanceBase: { key: 'resonanceBase', id: 'A09', name: '共振底座', starter: false, text: '同一步触发两块不同嵌片时，倍率提高一档。' },
  lockResonator: { key: 'lockResonator', id: 'A10', name: '锁位共鸣器', starter: false, text: '相邻的嵌片会一同被爆炸引动。' },
  fineChisel: { key: 'fineChisel', id: 'A11', name: '精工刻刀', starter: false, text: '升级嵌片时多加一格。' },
  reactionCoil: { key: 'reactionCoil', id: 'A13', name: '反应线圈', starter: true, text: '护盾完全挡住攻击时反击 2 点。' },
  chainLens: { key: 'chainLens', id: 'A14', name: '连锁透镜', starter: true, text: '被动连锁达到 3 时，倍率再提高一档。' },
  echoBell: { key: 'echoBell', id: 'A15', name: '回响钟', starter: true, text: '眩晕成功时，下回合多 1 点行动力。' },
  scavengerGoggles: { key: 'scavengerGoggles', id: 'A16', name: '拾荒眼镜', starter: false, text: '重掷嵌片时可保留一项。' },
  treasureMap: { key: 'treasureMap', id: 'A17', name: '藏宝图残页', starter: true, text: '嵌片奖励多展示一个候选。' },
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
};
