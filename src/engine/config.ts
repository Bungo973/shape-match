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
  /** 取消倍率封顶：各段用完后按最后一段的格数继续加（2026-09-30 定） */
  multiplierUncapped: boolean;
  /** 连锁（被动阶段）清除的普通方块也计入基数，算法与主动清除相同（2026-10-06 原型转正）；关掉即回到只算主动清除，模拟对照用 */
  chainBase: boolean;
  /** 爆破等级给倍率：本步引爆过的每类炸弹，每高出 1 级倍率 +0.1 × 此值（十分位，2026-09-30 定为 1） */
  bombLevelMultTenths: number;
  /**
   * 爆破等级（2026-09-30）：本场每引爆这么多枚该类炸弹（含接力），该类升一级；每场重置。
   * n 级时，该类炸弹炸掉的每块方块多计 n − 1 基数。见 docs/archive/BLOCK_BUILD.md。
   */
  bombHeatEvery: { line: number; area: number; color: number };
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
  /**
   * 冲分模式（2026-09-30 原型）：每关在 scoreTurns 个回合内累计结算分达到敌人的目标分；敌人不行动。
   * 回合用完仍未达标时，按差距比例扣生命（差 20% 扣最大生命的 20%，向上取整）。见 docs/DESIGN_JOURNAL.md。
   */
  scoreMode: boolean;
  scoreTurns: number;
  /** 前 9 关的目标分；之后进入无尽模式，每关乘以 endlessGrowth。见 levels.ts */
  scoreTargets: number[];
  endlessGrowth: number;
  /** 首领规则“石阵”开局放下的石块数；“低压”保留的倍率段数（2 段即封顶 ×3） */
  stoneRuleCount: number;
  lowCapSegments: number;
  // ---- 战斗 ----
  playerMaxHp: number;
  apPerTurn: number;
  playerShieldCap: number;
  /** 碎甲：下一玩家回合护盾上限 = playerShieldCap × 此比例（向下取整） */
  shatterCapRatio: number;
  /** 穿刺：攻击中无视护盾的比例（向上取整） */
  pierceRatio: number;
  /** 棋盘上石块的数量上限；达到后石化意图改为防御 */
  stoneCap: number;
  /** 每个敌人回合结束后，主角护盾保留的比例（1 = 全部保留，0 = 每回合清空）；向下取整。2026-09-29 定为 0 */
  playerShieldRetain: number;
  /** 护盾是否带进下一场战斗（1 = 带入，0 = 每场从 0 开始） */
  playerShieldCarryOver: number;
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
  /**
   * 金币（2026-09-30 起所有升级都在商店用金币买）：过关底薪 + 精英加成 + 提前达标时每剩一步的金币。
   * 见 docs/DESIGN_JOURNAL.md。
   */
  goldBase: number;
  goldEliteBonus: number;
  goldPerStep: number;
  /** 商店升级价格 = 起价 + 每级涨价 ×（当前等级 − 1），每项各自计 */
  upgradePrice: number;
  upgradePriceStep: number;
  healPrice: number;
  healAmount: number;
  /** 道具：背包格数、每次商店随机上架的种数（2026-10-06 起道具改为关内掉落，商店不卖，为 0）、使用时是否消耗 1 步（定为不耗步，保留参数供模拟对比） */
  itemSlots: number;
  itemsPerShop: number;
  itemCostsStep: boolean;
  /** 神器（2026-10-06 仿《小丑牌》分级）：栏位上限、每次商店上架件数、各稀有度的价格与商店出现权重；卖出为半价 */
  artifactSlots: number;
  artifactsPerShop: number;
  artifactPrices: Record<'common' | 'uncommon' | 'rare', number>;
  artifactShopWeights: Record<'common' | 'uncommon' | 'rare', number>;
  /** 可选任务：易任务的金币（普通关、首领关）；难任务给神器，神器栏满时改给的金币 */
  taskGold: number;
  taskGoldBoss: number;
  taskFullGold: number;
  /** 商店刷新：同一次商店第 n 次刷新的价格 = 起价 + 涨价 ×（n − 1），下次进商店重置 */
  rerollPrice: number;
  rerollPriceStep: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  rows: 10,
  cols: 10,
  colorWeights: { attack: 30, shield: 25, poison: 25, catalyst: 20 },
  multiplierSegments: [6, 10, 14, 18, 22],
  multiplierUncapped: true,
  chainBase: true,
  bombLevelMultTenths: 1,
  bombHeatEvery: { line: 12, area: 9, color: 3 },
  catalystPerCharge: 3,
  chargeBonus: 1,
  chargeCap: 5,
  socketPerCell: 2,
  maxInstalledInserts: 6,
  maxPhases: 200,
  scoreMode: false,
  scoreTurns: 5,
  // 2026-10-06 连锁计基数转正：分数约为原来的 2–3 倍，目标分按模拟与试玩重调（原 1100 / 1600 / 2050 / 3650 / 4750 / 4550 / 6600 / 7500 / 7250）
  scoreTargets: [3600, 5000, 6700, 11100, 14450, 13000, 20450, 23500, 20450],
  endlessGrowth: 1.3,
  stoneRuleCount: 6,
  lowCapSegments: 2,
  playerMaxHp: 40,
  apPerTurn: 3,
  playerShieldCap: 40,
  shatterCapRatio: 0.5,
  pierceRatio: 0.5,
  stoneCap: 10,
  playerShieldRetain: 0,
  playerShieldCarryOver: 0,
  poisonThresholdRatio: 0.25,
  poisonDecayRatio: 1 / 6,
  gravityTurns: 3,
  drawPerTurn: 5,
  handLimit: 10,
  goldBase: 5,
  goldEliteBonus: 6,
  goldPerStep: 1,
  upgradePrice: 8,
  upgradePriceStep: 4,
  healPrice: 6,
  healAmount: 10,
  itemSlots: 3,
  itemsPerShop: 0,
  itemCostsStep: false,
  artifactSlots: 6,
  artifactsPerShop: 2,
  artifactPrices: { common: 6, uncommon: 10, rare: 15 },
  artifactShopWeights: { common: 70, uncommon: 25, rare: 5 },
  taskGold: 3,
  taskGoldBoss: 5,
  taskFullGold: 10,
  rerollPrice: 3,
  rerollPriceStep: 1,
};
