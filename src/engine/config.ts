import type { Color } from './types';

// 所有可调数值集中于此；均为原型占位值，改动需在 GAME_RULES 记录原因。
export interface EngineConfig {
  rows: number;
  cols: number;
  /** 基础方块生成权重 */
  colorWeights: Record<Color, number>;
  /** 倍率 = 2 ^ min(floor(P / passivePerStep), maxMultiplierSteps) */
  passivePerStep: number;
  maxMultiplierSteps: number;
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
}

export const DEFAULT_CONFIG: EngineConfig = {
  rows: 8,
  cols: 8,
  colorWeights: { attack: 30, shield: 25, poison: 25, catalyst: 20 },
  passivePerStep: 3,
  maxMultiplierSteps: 3,
  catalystPerCharge: 3,
  chargeBonus: 3,
  chargeCap: 2,
  socketPerCell: 2,
  maxInstalledInserts: 6,
  maxPhases: 200,
};
