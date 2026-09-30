// 冲分模式的关卡：目标分、首领关与首领规则、无尽模式。设计见 docs/DESIGN_JOURNAL.md 第 15 节。
// 每三关一个首领关（第 3、6、9 关……），带一条从规则池按种子抽出的特殊规则，开关前就公开。
// 规则只改参数或开局状态，不在结算中途插入新时机（防卡壳规矩）。
import type { EngineConfig } from './config';
import { mixSeed } from './rng';

export type BossRule = 'inverted' | 'sealed' | 'stones' | 'lowCap' | 'cooldown' | 'silence';

export const BOSS_RULES: Record<BossRule, { name: string; text: string }> = {
  inverted: { name: '倒悬', text: '整关重力向上，新方块从下方补入。' },
  sealed: { name: '色封', text: '一种颜色本关不计分（照常消除、照常引发连锁）。' },
  stones: { name: '石阵', text: '开局棋盘上有石块，不能交换，只能用炸弹炸掉。' },
  lowCap: { name: '低压', text: '倍率封顶降到 ×3。' },
  cooldown: { name: '冷却', text: '本关爆破等级不会上升。' },
  silence: { name: '哑火', text: '本关所有神器失效。' },
};

export const BOSS_RULE_KEYS = Object.keys(BOSS_RULES) as BossRule[];

export const isBossLevel = (level: number): boolean => level % 3 === 0;

/** 第 level 关（1 起）的目标分：前 9 关按配置，之后每关乘以无尽增长系数，取整到 50 */
export function scoreTarget(level: number, config: EngineConfig): number {
  const list = config.scoreTargets;
  if (level <= list.length) return list[level - 1]!;
  const t = list[list.length - 1]! * config.endlessGrowth ** (level - list.length);
  return Math.round(t / 50) * 50;
}

/** 首领关的规则：由局种子和关卡序号决定；不与上一个首领关重复 */
export function bossRuleFor(seed: number, level: number): BossRule | null {
  if (!isBossLevel(level)) return null;
  const prev = level > 3 ? bossRuleFor(seed, level - 3) : null;
  const pool = BOSS_RULE_KEYS.filter((k) => k !== prev);
  return pool[mixSeed(seed, 0xb055, level) % pool.length]!;
}
