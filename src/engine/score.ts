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
  /** 连锁清除带来的基数，直接加进基数 */
  chainBase?: number;
  hadActiveColorClear: boolean;
  /** 行动开始前存储的催化剂充能层数 */
  chargesBefore: number;
  /** 主动消除触发的嵌片基础值 E */
  socketBonuses?: EffectValues;
  /** 神器的倍率修正（连锁透镜、共振底座），每档 = 倍率 +1，结果先限制在封顶以内 */
  multiplierStepDelta?: number;
  /** 敌方倍率侵蚀：在神器修正之后再降的档数（每档 = 倍率 −1），最低 ×1 */
  erosionSteps?: number;
  /** 爆破等级与神器带来的倍率加成（十分位） */
  bonusTenths?: number;
  /** 神器的倍率乘成（末班车、积分卡、玻璃炮），在所有加成之后相乘；“低压”的封顶仍限制最终倍率 */
  multiplierFactor?: number;
  /** 神器的基数乘成（独行） */
  baseFactor?: number;
  /** 神器的基数加成（尺规），在基数乘成之前相加 */
  baseBonus?: number;
  /** 过载引线的代价：本步护盾效果为 0，结算分不变 */
  zeroShieldEffect?: boolean;
}

export interface Settlement {
  multiplier: number;
  /** 基数：清除的方块（含炸弹的爆破等级）在神器之前的值；含 chainBase */
  rawBase: number;
  /** 其中由连锁清除带来的部分（config.chainBase 关闭时为 0） */
  chainBase: number;
  /** 基数：加上神器的基数加成、乘上基数乘成之后的值；结算分 = base × multiplier（四舍五入） */
  base: number;
  /** 本步消耗的旧充能层数 C */
  chargesUsed: number;
  baseValues: EffectValues;
  settlementScore: number;
  finalEffects: EffectValues;
  chargesGained: number;
  chargesAfter: number;
}

/** 倍率槽的上限；取消封顶时为无穷大 */
export function multiplierCap(config: EngineConfig): number {
  return config.multiplierUncapped ? Infinity : 1 + config.multiplierSegments.length;
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
  if (!config.multiplierUncapped) return tenths;
  // 不封顶：之后每段都按最后一段的格数
  const last = config.multiplierSegments[config.multiplierSegments.length - 1]!;
  return tenths + Math.floor((rest * 10) / last);
}

/** 连锁倍率（不含神器与侵蚀），供倍率槽实时显示 */
export function chainMultiplier(P: number, config: EngineConfig): number {
  return 1 + chainTenths(P, config) / 10;
}

/**
 * 最终倍率：连锁 + 各项加成（先加）→ 侵蚀 → 乘成（后乘），每一层都受封顶限制。
 * 加成彼此相加、乘成彼此相乘，所以神器的先后顺序不影响结果。
 */
export function multiplierFor(passiveClearCount: number, config: EngineConfig, stepDelta = 0, erosionSteps = 0, bonusTenths = 0, factor = 1): number {
  const cap = (multiplierCap(config) - 1) * 10;
  const boosted = Math.max(0, Math.min(cap, chainTenths(passiveClearCount, config) + 10 * stepDelta + bonusTenths));
  const added = 1 + Math.max(0, boosted - 10 * erosionSteps) / 10;
  return Math.min(multiplierCap(config), Math.round(added * factor * 10) / 10);
}

export function settle(input: SettlementInput, config: EngineConfig): Settlement {
  const A = input.activeClearsByType;
  const E = input.socketBonuses ?? { attack: 0, shield: 0, poison: 0 };
  const M = multiplierFor(input.passiveClearCount, config, input.multiplierStepDelta ?? 0, input.erosionSteps ?? 0, input.bonusTenths ?? 0, input.multiplierFactor ?? 1);
  // 至少主动清除一枚有色普通方块的行动才消耗旧充能（GAME_RULES §2 第 5 步）
  const C = input.hadActiveColorClear ? input.chargesBefore : 0;
  const bonus = config.chargeBonus * C;
  const baseValues: EffectValues = {
    attack: A.attack + bonus + E.attack,
    shield: A.shield + bonus + E.shield,
    poison: A.poison + bonus + E.poison,
  };
  // 倍率带小数，效果与结算分四舍五入到整数
  const chainBase = input.chainBase ?? 0;
  const rawBase = baseValues.attack + baseValues.shield + baseValues.poison + A.catalyst + chainBase;
  const base = (rawBase + (input.baseBonus ?? 0)) * (input.baseFactor ?? 1);
  const settlementScore = Math.round(base * M);
  const chargesGained = Math.floor(A.catalyst / config.catalystPerCharge);
  const kept = input.chargesBefore - C;
  return {
    multiplier: M,
    rawBase,
    chainBase,
    base,
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
