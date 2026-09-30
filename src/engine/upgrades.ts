// 升级表：方块基数一项，加 3 类炸弹。
// 方块等级 = 主动清除时每块计的基数（四色共用，2026-09-30 起颜色不再有各自的等级）；
// 炸弹等级 = 每场的起始爆破等级（场内越炸越高）。设计见 docs/BLOCK_BUILD.md。
import type { EngineConfig } from './config';
import type { BombKind, Color } from './types';

export type BombUpgrade = 'line' | 'area' | 'color';
export type UpgradeKey = 'block' | BombUpgrade;
export type UpgradeLevels = Record<UpgradeKey, number>;

export const UPGRADE_KEYS: readonly UpgradeKey[] = ['block', 'line', 'area', 'color'];

export const UPGRADE_NAMES: Record<UpgradeKey, string> = {
  block: '方块基数',
  line: '直线炸弹',
  area: '3×3 炸弹',
  color: '五连炸弹',
};

export const defaultLevels = (): UpgradeLevels => ({ block: 1, line: 1, area: 1, color: 1 });

export const bombUpgradeOf = (bomb: BombKind): BombUpgrade => (bomb === 'H' || bomb === 'V' ? 'line' : bomb === 'A' ? 'area' : 'color');

/** 主动清除一块方块计入的基数；被色封的颜色按 1 级计（只在打怪模式出现） */
export const blockValue = (levels: UpgradeLevels | undefined, color: Color, sealed?: Color | null): number => (sealed === color ? 1 : (levels?.block ?? 1));

export const BOMB_UPGRADES: readonly BombUpgrade[] = ['line', 'area', 'color'];
export const BOMB_NAME: Record<BombUpgrade, string> = { line: '直线炸弹', area: '3×3 炸弹', color: '五连炸弹' };

/** 本场的爆破等级与升级进度；每场从升级表的炸弹等级开始 */
export type BombHeat = Record<BombUpgrade, { level: number; count: number }>;

export const initialBombHeat = (levels: UpgradeLevels): BombHeat => ({
  line: { level: levels.line, count: 0 },
  area: { level: levels.area, count: 0 },
  color: { level: levels.color, count: 0 },
});

/** 某爆破等级下，炸掉的每块方块多计的基数 */
export const bombBlockBonus = (level: number): number => Math.max(0, level - 1);

/** 计入本步引爆数，返回升级后的爆破等级与本步升级的类别（每升一级记一次） */
export function addDetonations(heat: BombHeat, detonated: Record<BombUpgrade, number>, config: EngineConfig): { heat: BombHeat; levelUps: BombUpgrade[] } {
  const next: BombHeat = { line: { ...heat.line }, area: { ...heat.area }, color: { ...heat.color } };
  const levelUps: BombUpgrade[] = [];
  for (const k of BOMB_UPGRADES) {
    next[k].count += detonated[k];
    while (next[k].count >= config.bombHeatEvery[k]) {
      next[k].count -= config.bombHeatEvery[k];
      next[k].level++;
      levelUps.push(k);
    }
  }
  return { heat: next, levelUps };
}

/** 某项在给定等级下的效果说明，供奖励与营地卡面使用 */
export function upgradeEffectText(key: UpgradeKey, level: number, config: EngineConfig): string {
  if (key === 'line' || key === 'area' || key === 'color')
    return `每场从 ${level} 级开始，每引爆 ${config.bombHeatEvery[key]} 枚升一级；n 级时炸掉的每块多计 n−1 基数`;
  return `主动清除时，每块方块计 ${level} 基数（四色通用）`;
}
