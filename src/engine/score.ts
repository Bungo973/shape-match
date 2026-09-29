// 基数 × 倍率结算，规则见 docs/GAME_RULES.md §2 第 4–8 步。
import type { EngineConfig } from './config';
import type { ClearsByType } from './types';

export interface EffectValues {
  attack: number;
  shield: number;
  poison: number;
}

export interface SettlementInput {
  activeClearsByType: ClearsByType;
  passiveClearCount: number;
  hadActiveColorClear: boolean;
  /** 行动开始前存储的催化剂充能层数 */
  chargesBefore: number;
  /** 主动消除触发的嵌片基础值 E */
  socketBonuses?: EffectValues;
  /** 神器的倍率修正（连锁透镜、共振底座），每档 = 倍率 +1，结果先限制在封顶以内 */
  multiplierStepDelta?: number;
  /** 敌方倍率侵蚀：在神器修正之后再降的档数（每档 = 倍率 −1），最低 ×1 */
  erosionSteps?: number;
  /** 过载引线的代价：本步护盾效果为 0，结算分不变 */
  zeroShieldEffect?: boolean;
}

export interface Settlement {
  multiplier: number;
  /** 本步消耗的旧充能层数 C */
  chargesUsed: number;
  baseValues: EffectValues;
  settlementScore: number;
  finalEffects: EffectValues;
  chargesGained: number;
  chargesAfter: number;
}

/** 倍率槽的上限 */
export function multiplierCap(config: EngineConfig): number {
  return 1 + config.multiplierSegments.length;
}

/**
 * 只由被动清除数 P 决定的倍率，以 0.1 为单位（整数“十分位”），避免浮点误差。
 * 段内线性：处在第 i 段、已填 x / cost 格时为 1 + i + x / cost，向下取到 0.1。
 */
function chainTenths(P: number, config: EngineConfig): number {
  let tenths = 0;
  let rest = Math.max(0, P);
  for (const cost of config.multiplierSegments) {
    if (rest < cost) return tenths + Math.floor((rest * 10) / cost);
    tenths += 10;
    rest -= cost;
  }
  return tenths;
}

/** 连锁倍率（不含神器与侵蚀），供倍率槽实时显示 */
export function chainMultiplier(P: number, config: EngineConfig): number {
  return 1 + chainTenths(P, config) / 10;
}

export function multiplierFor(passiveClearCount: number, config: EngineConfig, stepDelta = 0, erosionSteps = 0): number {
  const cap = (multiplierCap(config) - 1) * 10;
  const boosted = Math.max(0, Math.min(cap, chainTenths(passiveClearCount, config) + 10 * stepDelta));
  return 1 + Math.max(0, boosted - 10 * erosionSteps) / 10;
}

export function settle(input: SettlementInput, config: EngineConfig): Settlement {
  const A = input.activeClearsByType;
  const E = input.socketBonuses ?? { attack: 0, shield: 0, poison: 0 };
  const M = multiplierFor(input.passiveClearCount, config, input.multiplierStepDelta ?? 0, input.erosionSteps ?? 0);
  // 至少主动清除一枚有色普通方块的行动才消耗旧充能（GAME_RULES §2 第 5 步）
  const C = input.hadActiveColorClear ? input.chargesBefore : 0;
  const bonus = config.chargeBonus * C;
  const baseValues: EffectValues = {
    attack: A.attack + bonus + E.attack,
    shield: A.shield + bonus + E.shield,
    poison: A.poison + bonus + E.poison,
  };
  // 倍率带小数，效果与结算分四舍五入到整数
  const settlementScore = Math.round((baseValues.attack + baseValues.shield + baseValues.poison + A.catalyst) * M);
  const chargesGained = Math.floor(A.catalyst / config.catalystPerCharge);
  const kept = input.chargesBefore - C;
  return {
    multiplier: M,
    chargesUsed: C,
    baseValues,
    settlementScore,
    finalEffects: {
      attack: Math.round(baseValues.attack * M),
      shield: input.zeroShieldEffect ? 0 : Math.round(baseValues.shield * M),
      poison: Math.round(baseValues.poison * M),
    },
    chargesGained,
    chargesAfter: Math.min(config.chargeCap, kept + chargesGained),
  };
}
