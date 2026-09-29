// 九战敌人的内容数据。行为设计见 docs/ENEMY_DESIGN.md；生命与伤害为占位值，待模拟器与试玩校准。
import type { EnemyDef, Intent } from '../battle';

const atk = (amount: number): Intent => ({ parts: [{ kind: 'attack', amount }] });

/** 第 1 战：直接攻击，教玩家看意图、在攻击与护盾之间取舍 */
export const CRYSTAL_MOLE: EnemyDef = {
  id: 'crystal-mole',
  name: '晶背鼹鼠',
  maxHp: 273,
  fallbackDefend: 8,
  script: [atk(11), atk(15), atk(11), atk(19)],
};

/** 第 2 战：先蓄力再俯冲，教玩家用毒气眩晕打断大招（被打断的攻击连带作废蓄力） */
export const CAVE_BATS: EnemyDef = {
  id: 'cave-bats',
  name: '洞蝠群',
  maxHp: 326,
  fallbackDefend: 8,
  // 蓄力后的俯冲 13+13=26：护盾每回合清空，一回合内挡住它很难，眩晕、抢杀或硬吃
  script: [{ parts: [{ kind: 'charge', amount: 13 }] }, atk(13), atk(9)],
};

/** 第 3 战（精英）：倍率侵蚀，教玩家先用小消除承担侵蚀，再准备爆发 */
export const ROCK_CRAB: EnemyDef = {
  id: 'rock-crab',
  name: '吞光岩蟹',
  maxHp: 525,
  fallbackDefend: 12,
  script: [
    atk(18),
    { parts: [{ kind: 'erodeMultiplier' }, { kind: 'attack', amount: 13 }] },
    atk(26),
    { parts: [{ kind: 'defend', amount: 12 }, { kind: 'attack', amount: 10 }] },
  ],
};

// ---- 第二层 · 封印遗迹 ----

/** 第 4 战：防御后重击，并把方块石化；石块只能用炸弹清掉 */
export const STONE_GUARDIAN: EnemyDef = {
  id: 'stone-guardian',
  name: '苔甲守卫',
  maxHp: 520,
  fallbackDefend: 10,
  script: [
    { parts: [{ kind: 'defend', amount: 14 }] },
    { parts: [{ kind: 'petrify', count: 3 }, { kind: 'attack', amount: 18 }] },
    { parts: [{ kind: 'defend', amount: 14 }] },
    atk(32),
  ],
};

/** 第 5 战：攻击与防御交替，考验三步内的分配 */
export const SPORE_CLUSTER: EnemyDef = {
  id: 'spore-cluster',
  name: '毒孢菇群',
  maxHp: 620,
  fallbackDefend: 10,
  script: [atk(20), { parts: [{ kind: 'defend', amount: 12 }, { kind: 'attack', amount: 14 }] }, atk(28)],
};

/** 第 6 战（精英）：色封，构筑不能只靠一种颜色 */
export const RUNE_SPIDER: EnemyDef = {
  id: 'rune-spider',
  name: '符链石蛛',
  maxHp: 1150,
  fallbackDefend: 12,
  script: [
    atk(20),
    { parts: [{ kind: 'sealColor' }, { kind: 'attack', amount: 16 }] },
    atk(30),
    { parts: [{ kind: 'defend', amount: 14 }, { kind: 'attack', amount: 12 }] },
  ],
};

// ---- 第三层 · 悬浮遗物殿 ----

/** 第 7 战：伪装成宝匣，混合已学的侵蚀、石化与蓄力 */
export const MIMIC_CHEST: EnemyDef = {
  id: 'mimic-chest',
  name: '拟宝匣兽',
  maxHp: 880,
  fallbackDefend: 12,
  script: [
    { parts: [{ kind: 'erodeMultiplier' }, { kind: 'attack', amount: 18 }] },
    { parts: [{ kind: 'petrify', count: 3 }] },
    { parts: [{ kind: 'charge', amount: 16 }] },
    atk(20),
  ],
};

/** 第 8 战：三回合蓄力倒计时；眩晕打断攻击时蓄力全部作废 */
export const RELIC_RAIDER: EnemyDef = {
  id: 'relic-raider',
  name: '夺宝客',
  maxHp: 920,
  fallbackDefend: 12,
  script: [
    { parts: [{ kind: 'charge', amount: 15 }] },
    { parts: [{ kind: 'charge', amount: 15 }] },
    { parts: [{ kind: 'charge', amount: 15 }] },
    atk(20),
  ],
};

/** 第 9 战（首领）：轮流使用已学手段，并施加向上的重力反转 */
export const RELIC_COLOSSUS: EnemyDef = {
  id: 'relic-colossus',
  name: '遗物巨像',
  maxHp: 2200,
  fallbackDefend: 16,
  script: [
    atk(24),
    { parts: [{ kind: 'gravityUp' }] },
    { parts: [{ kind: 'sealColor' }, { kind: 'attack', amount: 20 }] },
    { parts: [{ kind: 'erodeMultiplier' }, { kind: 'attack', amount: 22 }] },
    { parts: [{ kind: 'petrify', count: 4 }, { kind: 'charge', amount: 20 }] },
    atk(30),
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
