// 方块构筑的升级表：4 种基础方块与 3 类炸弹各有等级，规则统一为“等级 × 基础值”。
// 设计见 docs/BLOCK_BUILD.md。
import type { EngineConfig } from './config';
import type { BombKind, Color } from './types';

export type BombUpgrade = 'line' | 'area' | 'color';
export type UpgradeKey = Color | BombUpgrade;
export type UpgradeLevels = Record<UpgradeKey, number>;

export const UPGRADE_KEYS: readonly UpgradeKey[] = ['attack', 'shield', 'poison', 'catalyst', 'line', 'area', 'color'];

export const UPGRADE_NAMES: Record<UpgradeKey, string> = {
  attack: '攻击方块',
  shield: '护盾方块',
  poison: '毒气方块',
  catalyst: '催化剂方块',
  line: '直线炸弹',
  area: '3×3 炸弹',
  color: '五连炸弹',
};

export const defaultLevels = (): UpgradeLevels => ({ attack: 1, shield: 1, poison: 1, catalyst: 1, line: 1, area: 1, color: 1 });

export const bombUpgradeOf = (bomb: BombKind): BombUpgrade => (bomb === 'H' || bomb === 'V' ? 'line' : bomb === 'A' ? 'area' : 'color');

/** 主动清除一块该色方块计入的基数 */
export const blockValue = (levels: UpgradeLevels | undefined, color: Color): number => levels?.[color] ?? 1;

/** 亲手做出该炸弹时，给匹配组颜色追加的基数 */
export const bombMakeBonus = (levels: UpgradeLevels | undefined, bomb: BombKind, config: EngineConfig): number => {
  const key = bombUpgradeOf(bomb);
  return config.bombMakeBonus[key] * (levels?.[key] ?? 1);
};

const BOMB_NAME: Record<BombUpgrade, string> = { line: '直线炸弹', area: '3×3 炸弹', color: '五连炸弹' };

/** 某项在给定等级下的效果说明，供奖励与营地卡面使用 */
export function upgradeEffectText(key: UpgradeKey, level: number, config: EngineConfig): string {
  if (key === 'line' || key === 'area' || key === 'color') return `亲手做出${key === 'area' ? ' ' : ''}${BOMB_NAME[key]}时，该组颜色基数 +${config.bombMakeBonus[key] * level}`;
  return `主动清除时每块计 ${level} 基数`;
}
