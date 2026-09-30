// 数值模拟用的自动玩家。它和真人一样看不到结果预览：评估走法时用一个“想象中的”随机补位，
// 而不是真实的后续补位，因此它的判断接近“看得懂局面的玩家”，但不会作弊预知连锁。
import {
  cloneBoard,
  DEFAULT_CONFIG,
  findLines,
  getTile,
  mixSeed,
  playerAction,
  setTile,
  type Action,
  type ActionLog,
  type BattleState,
  type Board,
  type EngineConfig,
} from '../engine';

export type BotStyle = 'skilled' | 'novice';

/** 可走的行动：形成匹配的交换、炸弹与相邻方块的交换（在落点引爆）、点燃任一炸弹 */
export function candidateActions(board: Board): Action[] {
  const out: Action[] = [];
  const rows = board.length;
  const cols = board[0]!.length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = getTile(board, { r, c })!;
      if (a.kind === 'bomb') out.push({ type: 'ignite', at: { r, c } });
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
      ] as const) {
        const to = { r: r + dr, c: c + dc };
        if (to.r >= rows || to.c >= cols) continue;
        const b = getTile(board, to)!;
        if (a.kind === 'stone' || b.kind === 'stone') continue;
        if (a.kind === 'normal' && b.kind === 'normal' && a.color === b.color) continue;
        if (a.kind === 'bomb' || b.kind === 'bomb') {
          out.push({ type: 'swap', from: { r, c }, to });
          continue;
        }
        const trial = cloneBoard(board);
        setTile(trial, { r, c }, b);
        setTile(trial, to, a);
        if (findLines(trial).length > 0) out.push({ type: 'swap', from: { r, c }, to });
      }
    }
  }
  return out;
}

/** 敌人下一次意图的攻击总量（已被眩晕则为 0） */
export function incomingDamage(s: BattleState): number {
  if (s.enemy.stunPending) return 0;
  const atk = s.enemy.intent.parts.filter((p) => p.kind === 'attack').reduce((sum, p) => sum + (p.kind === 'attack' ? p.amount : 0), 0);
  return atk > 0 ? atk + s.enemy.chargeBonus : 0;
}

/** 熟练玩家的估值：伤害 + 恰好够用的护盾 + 眩晕价值 + 充能 */
function value(before: BattleState, log: ActionLog, after: BattleState): number {
  if (after.outcome === 'won') return 1e6;
  const incoming = incomingDamage(before);
  const need = Math.max(0, incoming - before.player.shield);
  const shieldUseful = Math.min(log.shieldGained, need);
  let v = log.damageToEnemyHp + 0.5 * log.damageToEnemyShield + shieldUseful + 0.1 * (log.shieldGained - shieldUseful);
  v += log.stunApplied ? incoming * 1.2 + 3 : 0.3 * log.poisonAdded;
  v += 3 * Math.max(0, after.player.catalystCharges - before.player.catalystCharges);
  return v;
}

/**
 * 选择下一步行动；返回 null 表示结束回合。
 * evalSeed 决定评估时“想象中的补位”，与真实结算使用的随机数无关。
 */
export function chooseAction(state: BattleState, style: BotStyle, evalSeed: number, config: EngineConfig = DEFAULT_CONFIG): Action | null {
  const actions = candidateActions(state.board);
  let best: Action | null = null;
  let bestScore = 0;
  actions.forEach((action, i) => {
    const imagined: BattleState = { ...state, rngState: mixSeed(evalSeed, i) };
    const out = playerAction(imagined, action, config);
    if (!out.ok) return;
    const score =
      style === 'skilled'
        ? value(state, out.log, out.state)
        : Object.values(out.log.result.activeClearsByType).reduce((a, b) => a + b, 0) + (out.state.outcome === 'won' ? 1e6 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  });
  return best;
}
