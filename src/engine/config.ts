import type { Color } from './types';

// 所有可调数值集中于此；均为原型占位值，改动需在 GAME_RULES 记录原因。
export interface EngineConfig {
  rows: number;
  cols: number;
  /** 基础方块生成权重 */
  colorWeights: Record<Color, number>;
  /**
   * 连续倍率槽：从 ×1 起，每段填满倍率 +1，段内按被动清除数线性上涨；
   * 数组依次为各段所需的被动清除数，段数即封顶（5 段封顶 ×6）。见 GAME_RULES §2 第 4 步。
   */
  multiplierSegments: number[];
  /** 主动阶段亲手做出的产弹匹配（四连、五连、T/L），该组清除的方块按此倍数计入基数 */
  activeSpecialMatchFactor: number;
  /** 每满多少个主动催化剂获得 1 层充能 */
  catalystPerCharge: number;
  /** 每层旧充能给攻击、护盾、毒气基础值各加多少 */
  chargeBonus: number;
  chargeCap: number;
  /** 锋刃／壁垒／毒囊每个触发格提供的基数 */
  socketPerCell: number;
  /** 棋盘上同时安装的嵌片上限 */
  maxInstalledInserts: number;
  /** 工程保护：单次行动的阶段数上限，超出视为程序错误 */
  maxPhases: number;
  // ---- 战斗 ----
  playerMaxHp: number;
  apPerTurn: number;
  playerShieldCap: number;
  /** 毒气眩晕阈值 = 敌人最大生命 × 此比例（四舍五入，至少 1） */
  poisonThresholdRatio: number;
  /** 敌人回合末毒气进度衰减量 = 阈值 × 此比例（四舍五入，至少 1） */
  poisonDecayRatio: number;
  /** 重力反转持续的玩家回合数 */
  gravityTurns: number;
  // ---- 嵌片卡模式（原型） ----
  drawPerTurn: number;
  handLimit: number;
  // ---- 一局 ----
  goldMinion: number;
  goldElite: number;
  rerollCost: number;
  upgradeCost: number;
  restHeal: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  rows: 10,
  cols: 10,
  colorWeights: { attack: 30, shield: 25, poison: 25, catalyst: 20 },
  multiplierSegments: [6, 10, 14, 18, 22],
  activeSpecialMatchFactor: 2,
  catalystPerCharge: 3,
  chargeBonus: 1,
  chargeCap: 5,
  socketPerCell: 2,
  maxInstalledInserts: 6,
  maxPhases: 200,
  playerMaxHp: 40,
  apPerTurn: 3,
  playerShieldCap: 20,
  poisonThresholdRatio: 0.25,
  poisonDecayRatio: 1 / 6,
  gravityTurns: 3,
  drawPerTurn: 5,
  handLimit: 10,
  goldMinion: 8,
  goldElite: 16,
  rerollCost: 8,
  upgradeCost: 15,
  restHeal: 10,
};
