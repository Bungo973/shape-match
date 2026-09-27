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
  /** 倍率档位修正（神器提高为正，倍率侵蚀为负）；结果限制在 ×1 至封顶之间 */
  multiplierStepDelta?: number;
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

export function multiplierFor(passiveClearCount: number, config: EngineConfig, stepDelta = 0): number {
  const steps = Math.min(Math.floor(passiveClearCount / config.passivePerStep), config.maxMultiplierSteps) + stepDelta;
  return 2 ** Math.max(0, Math.min(config.maxMultiplierSteps, steps));
}

export function settle(input: SettlementInput, config: EngineConfig): Settlement {
  const A = input.activeClearsByType;
  const E = input.socketBonuses ?? { attack: 0, shield: 0, poison: 0 };
  const M = multiplierFor(input.passiveClearCount, config, input.multiplierStepDelta ?? 0);
  // 至少主动清除一枚有色普通方块的行动才消耗旧充能（GAME_RULES §2 第 5 步）
  const C = input.hadActiveColorClear ? input.chargesBefore : 0;
  const bonus = config.chargeBonus * C;
  const baseValues: EffectValues = {
    attack: A.attack + bonus + E.attack,
    shield: A.shield + bonus + E.shield,
    poison: A.poison + bonus + E.poison,
  };
  const settlementScore = (baseValues.attack + baseValues.shield + baseValues.poison + A.catalyst) * M;
  const chargesGained = Math.floor(A.catalyst / config.catalystPerCharge);
  const kept = input.chargesBefore - C;
  return {
    multiplier: M,
    chargesUsed: C,
    baseValues,
    settlementScore,
    finalEffects: { attack: baseValues.attack * M, shield: baseValues.shield * M, poison: baseValues.poison * M },
    chargesGained,
    chargesAfter: Math.min(config.chargeCap, kept + chargesGained),
  };
}
