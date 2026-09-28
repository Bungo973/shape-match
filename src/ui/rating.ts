// 每步评价：把一次行动的质量翻译成玩家能立刻感受到的正反馈。
import { DEFAULT_CONFIG, type ActionLog, type ExplosionShape } from '../engine';

export interface MoveRating {
  /** 1 不错、2 漂亮、3 完美 */
  level: number;
  text: string;
  /** 组合技名称 */
  combo?: string;
}

const COMBO_NAME: Partial<Record<ExplosionShape, string>> = {
  cross: '十字爆破！',
  rows3: '三线横扫！',
  cols3: '三线纵贯！',
  square5: '大爆破！',
  board: '全屏清除！',
};

export function rateMove(log: ActionLog): MoveRating | null {
  const s = log.settlement;
  if (!s) return null;
  const events = log.result.events;
  const created = events.flatMap((e) => (e.type === 'matches' && e.phase === 'active' ? e.created.map((c) => c.bomb) : []));
  const firstWave = events.find((e) => e.type === 'wave' && e.phase === 'active');
  let combo: string | undefined;
  if (firstWave?.type === 'wave') {
    const shape = firstWave.explosions[0]?.shape;
    combo = shape ? COMBO_NAME[shape] : undefined;
    if (!combo && firstWave.converted.length > 0 && firstWave.consumed.length === 2) combo = '连环爆破！';
  }
  const maxMult = 2 ** DEFAULT_CONFIG.maxMultiplierSteps;
  const activeTotal = Object.values(log.result.activeClearsByType).reduce((a, b) => a + b, 0);

  let level = 0;
  if (s.multiplier >= 2 || created.length > 0 || activeTotal >= 6) level = 1;
  if (s.multiplier >= maxMult || combo || created.includes('CB') || created.includes('A') || created.length >= 2) level = 2;
  if ((s.multiplier >= maxMult && (created.length > 0 || combo)) || combo === '全屏清除！' || combo === '大爆破！') level = 3;
  if (level === 0) return null;
  return { level, text: ['不错！', '漂亮！', '完美！'][level - 1]!, ...(combo ? { combo } : {}) };
}
