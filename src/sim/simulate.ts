// 让自动玩家把一整局打完，记录每场战斗的数值表现。
import {
  buyHeal,
  buyUpgrade,
  chooseArtifact,
  skipArtifact,
  DEFAULT_CONFIG,
  leaveShop,
  mixSeed,
  newRun,
  pickStarter,
  runAction,
  runEndTurn,
  FULL_ROUTE,
  startNextBattle,
  UPGRADE_KEYS,
  upgradePrice,
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
  /** 每次行动：被动阶段产出的炸弹、亲手做出的炸弹、被动匹配的层数（连锁深度）、是否用了炸弹 */
  passiveBombs: number[];
  activeBombs: number[];
  chainDepth: number[];
  usedBomb: number[];
  /** 死局自动重排次数（行动后与石化后） */
  shuffles: number;
  /** 敌人真正出手攻击的回合数，以及其中被护盾完全挡住（没掉血）的回合数 */
  attackTurns: number;
  blockedTurns: number;
  /** 冲分模式：本关得分与目标 */
  score?: number;
  target?: number;
  /** 本关结束时的金币收入与其中剩余步数的部分 */
  income?: number;
  stepsLeft?: number;
  /** 进本关时的升级总级数（不含初始 1 级） */
  upgradesBefore?: number;
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

function autoShop(run: RunState, config: EngineConfig): RunState {
  // 生命掉了一截就先回血；剩下的钱反复买当前最便宜的升级（同价按升级表顺序），买不起为止
  while (run.player.hp <= run.player.maxHp - config.healAmount && run.gold >= config.healPrice) run = ok(buyHeal(run, config));
  for (;;) {
    const key = [...UPGRADE_KEYS].sort((x, y) => upgradePrice(run, x, config) - upgradePrice(run, y, config))[0]!;
    if (run.gold < upgradePrice(run, key, config)) break;
    run = ok(buyUpgrade(run, key, config));
  }
  return ok(leaveShop(run));
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
        upgradesBefore: UPGRADE_KEYS.reduce((n, k) => n + run.levels[k] - 1, 0),
        passiveBombs: [],
        activeBombs: [],
        chainDepth: [],
        usedBomb: [],
        shuffles: 0,
        attackTurns: 0,
        blockedTurns: 0,
      });
    } else if (run.phase === 'battle') {
      const report = battles[battles.length - 1]!;
      const b = run.battle!;
      if (b.turn > maxTurns) return { seed, outcome: 'stalled', starter, battles };
      const action = b.ap > 0 ? chooseAction(b, opts.style, mixSeed(seed, 0xa11, step++), config) : null;
      if (action) {
        const r = runAction(run, action, config);
        if (!r.ok || !r.log) throw new Error(r.ok ? '缺少日志' : r.reason);
        const ev = r.log.result.events;
        const made = (phase: 'active' | 'passive') =>
          ev.reduce((n, e) => n + (e.type === 'matches' && e.phase === phase ? e.created.length : 0), 0);
        report.passiveBombs.push(made('passive'));
        report.activeBombs.push(made('active'));
        report.chainDepth.push(ev.filter((e) => e.type === 'matches' && e.phase === 'passive').length);
        report.usedBomb.push(r.log.result.activeBombsDetonated > 0 ? 1 : 0);
        report.shuffles += ev.filter((e) => e.type === 'shuffle').length;
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
          if (r.log.reshuffled) report.shuffles++;
          if (r.log.executed.some((p) => p.kind === 'attack')) {
            report.attackTurns++;
            if (r.log.damageToPlayerHp === 0) report.blockedTurns++;
          }
          report.damageTaken += r.log.damageToPlayerHp + r.log.damageToPlayerShield;
          report.hpLost += r.log.damageToPlayerHp;
        }
        run = r.run;
        if (run.battle) report.turns = run.battle.turn;
      }
      if (run.phase !== 'battle') {
        report.won = run.outcome !== 'lost';
        if (b.goal && run.battle) {
          report.score = run.battle.totalScore;
          report.target = b.goal.target;
        }
        if (run.income) {
          report.income = run.income.total;
          report.stepsLeft = run.income.steps;
        }
      }
    } else if (run.phase === 'artifact') {
      // 指定了神器时跳过首领奖励，只衡量这几件；神器栏满时也跳过
      run = ok(opts.artifacts || run.artifacts.length >= config.artifactSlots ? skipArtifact(run, config) : chooseArtifact(run, run.artifactChoices[0]!, config));
    } else if (run.phase === 'shop') {
      run = autoShop(run, config);
    } else {
      throw new Error(`未处理的阶段 ${run.phase}`);
    }
  }
  return { seed, outcome: run.outcome === 'won' ? 'won' : 'lost', starter, battles };
}
