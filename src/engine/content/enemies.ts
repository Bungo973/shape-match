// 九战敌人的内容数据。行为设计见 docs/ENEMY_DESIGN.md；生命与伤害为占位值，待模拟器与试玩校准。
// 出招循环的兜底模板是“三拍”：预备（挂 debuff／buff + 小攻击）→ 重拍（大攻击）→ 喘息（防御或强化）。
import type { EnemyDef, Intent, IntentPart } from '../battle';

const atk = (amount: number): Intent => ({ parts: [{ kind: 'attack', amount }] });
const intent = (...parts: IntentPart[]): Intent => ({ parts });
const hit = (amount: number): IntentPart => ({ kind: 'attack', amount });
const defend = (amount: number): IntentPart => ({ kind: 'defend', amount });
const shatter: IntentPart = { kind: 'shatter' };
const empower = (amount: number): IntentPart => ({ kind: 'empower', amount });

/** 第 1 战：直接攻击，教玩家看意图、在攻击与护盾之间取舍 */
export const CRYSTAL_MOLE: EnemyDef = {
  id: 'crystal-mole',
  name: '晶背鼹鼠',
  maxHp: 314,
  fallbackDefend: 8,
  targetScore: 1100,
  script: [atk(12), atk(16), atk(12), atk(20)],
};

/** 第 2 战：先蓄力再俯冲，教玩家用毒气眩晕打断大招（被打断的攻击连带作废蓄力） */
export const CAVE_BATS: EnemyDef = {
  id: 'cave-bats',
  name: '洞蝠群',
  maxHp: 375,
  fallbackDefend: 8,
  targetScore: 1500,
  // 每拍都攻击：蓄力拍也会啄一下；俯冲 22 + 蓄力 13 = 35
  script: [intent(hit(5), { kind: 'charge', amount: 8 }), atk(13), atk(11)],
};

/** 第 3 战（精英）：倍率侵蚀，教玩家先用小消除承担侵蚀，再准备爆发 */
export const ROCK_CRAB: EnemyDef = {
  id: 'rock-crab',
  name: '吞光岩蟹',
  maxHp: 604,
  fallbackDefend: 12,
  targetScore: 1800,
  script: [atk(14), intent({ kind: 'erodeMultiplier' }, hit(11)), atk(27), intent(defend(7), hit(8))],
};

// ---- 第二层 · 封印遗迹 ----

/** 第 4 战：引入碎甲。喘息（防御 + 石化）→ 预备（碎甲 + 小攻击）→ 重拍（重击，正落在护盾上限减半的回合） */
export const STONE_GUARDIAN: EnemyDef = {
  id: 'stone-guardian',
  name: '苔甲守卫',
  maxHp: 598,
  fallbackDefend: 10,
  targetScore: 2700,
  script: [intent(defend(10), { kind: 'petrify', count: 3 }, hit(10)), intent(shatter, hit(14)), atk(31)],
};

/** 第 5 战：攻击与防御交替，考验三步内的分配 */
export const SPORE_CLUSTER: EnemyDef = {
  id: 'spore-cluster',
  name: '毒孢菇群',
  maxHp: 713,
  fallbackDefend: 10,
  targetScore: 3500,
  script: [atk(20), intent(shatter, hit(13)), atk(34), intent(defend(8), hit(11))],
};

/** 第 6 战（精英）：色封，构筑不能只靠一种颜色 */
export const RUNE_SPIDER: EnemyDef = {
  id: 'rune-spider',
  name: '符链石蛛',
  maxHp: 1323,
  fallbackDefend: 12,
  targetScore: 4000,
  script: [intent(shatter, hit(14)), atk(30), intent({ kind: 'sealColor' }, hit(16)), intent(defend(10), hit(13))],
};

// ---- 第三层 · 悬浮遗物殿 ----

/** 第 7 战：引入强化。混合已学的侵蚀、石化、碎甲；每轮喘息时强化，拖得越久越危险 */
export const MIMIC_CHEST: EnemyDef = {
  id: 'mimic-chest',
  name: '拟宝匣兽',
  maxHp: 1012,
  fallbackDefend: 12,
  targetScore: 5000,
  script: [
    intent({ kind: 'erodeMultiplier' }, hit(18)),
    intent(shatter, hit(14)),
    atk(36),
    intent({ kind: 'petrify', count: 3 }, empower(3), hit(11)),
  ],
};

/** 第 8 战：穿刺是夺宝客独有的技能（一半伤害无视护盾）。穿刺刺击 → 蓄力倒计时 → 穿刺重击；眩晕打断时蓄力作废 */
export const RELIC_RAIDER: EnemyDef = {
  id: 'relic-raider',
  name: '夺宝客',
  maxHp: 1058,
  fallbackDefend: 12,
  targetScore: 5600,
  // 攻击在前、蓄力在后：蓄力留给下一次攻击（穿刺重击 30 + 20 = 50，一半无视护盾）
  script: [
    intent({ kind: 'attack', amount: 13, pierce: true }),
    intent(hit(15), { kind: 'charge', amount: 12 }),
    intent({ kind: 'attack', amount: 18, pierce: true }),
    intent(defend(8), hit(11)),
  ],
};

/** 第 9 战（首领）：轮流使用已学手段，并施加向上的重力反转 */
export const RELIC_COLOSSUS: EnemyDef = {
  id: 'relic-colossus',
  name: '遗物巨像',
  maxHp: 2530,
  fallbackDefend: 16,
  targetScore: 6200,
  // 两轮三拍，每拍都攻击：重力反转 + 强化 → 碎甲 + 色封 → 重击；侵蚀 + 强化 + 防御 → 石化 + 蓄力 → 重击
  script: [
    atk(21),
    intent({ kind: 'gravityUp' }, empower(2), hit(13)),
    intent(shatter, { kind: 'sealColor' }, hit(15)),
    atk(39),
    intent({ kind: 'erodeMultiplier' }, empower(2), defend(11), hit(11)),
    intent(hit(13), { kind: 'petrify', count: 4 }, { kind: 'charge', amount: 14 }),
    atk(25),
  ],
};

export type EnemyTier = 'minion' | 'elite' | 'boss';

/** 一局分三层，每层三战；背景与敌人家族随层变化，见 docs/ASSET_BATCH3.md */
export type Layer = 1 | 2 | 3;

export const LAYER_NAMES: Record<Layer, string> = { 1: '晶洞', 2: '封印遗迹', 3: '悬浮遗物殿' };

export interface RouteNode {
  enemy: EnemyDef;
  tier: EnemyTier;
  layer: Layer;
}

/** 第一层：小怪 → 小怪 → 精英 */
export const SEGMENT_1: RouteNode[] = [
  { enemy: CRYSTAL_MOLE, tier: 'minion', layer: 1 },
  { enemy: CAVE_BATS, tier: 'minion', layer: 1 },
  { enemy: ROCK_CRAB, tier: 'elite', layer: 1 },
];

/** 完整九战：（小怪 → 小怪 → 精英）× 2 → 小怪 → 小怪 → 首领 */
export const FULL_ROUTE: RouteNode[] = [
  ...SEGMENT_1,
  { enemy: STONE_GUARDIAN, tier: 'minion', layer: 2 },
  { enemy: SPORE_CLUSTER, tier: 'minion', layer: 2 },
  { enemy: RUNE_SPIDER, tier: 'elite', layer: 2 },
  { enemy: MIMIC_CHEST, tier: 'minion', layer: 3 },
  { enemy: RELIC_RAIDER, tier: 'minion', layer: 3 },
  { enemy: RELIC_COLOSSUS, tier: 'boss', layer: 3 },
];
