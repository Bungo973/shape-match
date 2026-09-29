// 让自动玩家把一整局打完，记录每场战斗的数值表现。
import {
  campRest,
  campUpgrade,
  chooseArtifact,
  chooseUpgrade,
  DEFAULT_CONFIG,
  mixSeed,
  newRun,
  pickStarter,
  runAction,
  runEndTurn,
  FULL_ROUTE,
  startNextBattle,
  UPGRADE_KEYS,
  type ArtifactKey,
  type EngineConfig,
  type RouteNode,
  type RunResult,
  type RunState,
  type UpgradeLevels,
} from '../engine';
import { chooseAction, type BotStyle } from './bot';

export interface BattleReport {
  enemy: string;
  won: boolean;
  turns: number;
  /** 敌人造成的伤害：护盾吸收 + 生命损失 */
  damageTaken: number;
  hpLost: number;
  hpBefore: number;
  shieldBefore: number;
  /** 每次有结算的行动的倍率与对敌伤害 */
  multipliers: number[];
  actionDamage: number[];
  shieldGains: number[];
  /** 结算得到、却因护盾上限而浪费的护盾 */
  shieldWasted: number;
  stuns: number;
}

export interface RunReport {
  seed: number;
  outcome: 'won' | 'lost' | 'stalled';
  starter: ArtifactKey | null;
  battles: BattleReport[];
}

export interface SimOptions {
  style: BotStyle;
  config?: EngineConfig;
  route?: RouteNode[];
  /** 单场战斗的回合上限，超出记为卡住 */
  maxTurns?: number;
  /** 开局即拥有的升级等级，用于衡量升级强度 */
  levels?: Partial<UpgradeLevels>;
  /** 指定开局持有的神器（替代随机的开局三选一），用于衡量单件神器的强度 */
  artifacts?: ArtifactKey[];
}

const ok = (r: RunResult): RunState => {
  if (!r.ok) throw new Error(r.reason);
  return r.run;
};

function autoCamp(run: RunState, config: EngineConfig): RunState {
  // 残血或没钱就休息；否则给当前等级最高的一项再加码（同级时按升级表顺序取第一项）
  if (run.player.hp <= run.player.maxHp - config.restHeal / 2 || run.gold < config.upgradeCost) return ok(campRest(run, config));
  const best = [...UPGRADE_KEYS].sort((x, y) => run.levels[y] - run.levels[x])[0]!;
  return ok(campUpgrade(run, best, config));
}

export function simulateRun(seed: number, opts: SimOptions): RunReport {
  const config = opts.config ?? DEFAULT_CONFIG;
  const maxTurns = opts.maxTurns ?? 40;
  let run = newRun(seed, config, opts.route ?? FULL_ROUTE);
  if (opts.levels) run.levels = { ...run.levels, ...opts.levels };
  const starter = run.starterChoices[0] ?? null;
  run = ok(pickStarter(run, starter!));
  if (opts.artifacts) run.artifacts = [...opts.artifacts];
  const battles: BattleReport[] = [];
  let step = 0;

  while (run.phase !== 'over') {
    if (run.phase === 'map') {
      run = ok(startNextBattle(run, config));
      const b = run.battle!;
      battles.push({
        enemy: b.enemy.def.name,
        won: false,
        turns: 1,
        damageTaken: 0,
        hpLost: 0,
        hpBefore: b.player.hp,
        shieldBefore: b.player.shield,
        multipliers: [],
        actionDamage: [],
        shieldGains: [],
        shieldWasted: 0,
        stuns: 0,
      });
    } else if (run.phase === 'battle') {
      const report = battles[battles.length - 1]!;
      const b = run.battle!;
      if (b.turn > maxTurns) return { seed, outcome: 'stalled', starter, battles };
      const action = b.ap > 0 ? chooseAction(b, opts.style, mixSeed(seed, 0xa11, step++), config) : null;
      if (action) {
        const r = runAction(run, action, config);
        if (!r.ok || !r.log) throw new Error(r.ok ? '缺少日志' : r.reason);
        const s = r.log.settlement;
        if (s) {
          report.multipliers.push(s.multiplier);
          report.actionDamage.push(r.log.damageToEnemyHp + r.log.damageToEnemyShield);
          report.shieldGains.push(r.log.shieldGained);
          report.shieldWasted += s.finalEffects.shield - r.log.shieldGained;
          if (r.log.stunApplied) report.stuns++;
        }
        run = r.run;
      } else {
        const r = runEndTurn(run, config);
        if (!r.ok) throw new Error(r.reason);
        if (r.log) {
          report.damageTaken += r.log.damageToPlayerHp + r.log.damageToPlayerShield + r.log.fuseDamageToHp + r.log.fuseDamageToShield;
          report.hpLost += r.log.damageToPlayerHp + r.log.fuseDamageToHp;
        }
        run = r.run;
        if (run.battle) report.turns = run.battle.turn;
      }
      if (run.phase !== 'battle') report.won = run.outcome !== 'lost';
    } else if (run.phase === 'reward') {
      run = ok(chooseUpgrade(run, 0));
    } else if (run.phase === 'artifact') {
      run = ok(chooseArtifact(run, run.artifactChoices[0]!));
    } else if (run.phase === 'camp') {
      run = autoCamp(run, config);
    } else {
      throw new Error(`未处理的阶段 ${run.phase}`);
    }
  }
  return { seed, outcome: run.outcome === 'won' ? 'won' : 'lost', starter, battles };
}
