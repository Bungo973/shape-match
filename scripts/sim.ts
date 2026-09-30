// 数值模拟：让自动玩家批量打第一段落，统计每场战斗的表现。
// 用法：npm run sim -- [--runs 200] [--style skilled|novice|both] [--set 参数=值 ...] [--hp 倍数] [--atk 倍数] [--mode score] [--targets 1100,1500,...]
// 例：npm run sim -- --set chargeCap=3 --hp 1.5 --level attack=3 --level line=2
import { ARTIFACTS, DEFAULT_CONFIG, FULL_ROUTE, UPGRADE_KEYS, type ArtifactKey, type EngineConfig, type RouteNode } from '../src/engine';
import type { BotStyle } from '../src/sim/bot';
import { simulateRun, type BattleReport } from '../src/sim/simulate';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : def;
};
const runs = Number(opt('runs', '200'));
const styleArg = opt('style', 'both');
const hpScale = Number(opt('hp', '1'));
const atkScale = Number(opt('atk', '1'));

// --artifact 可重复：开局只持有这些神器（替代随机开局神器），--artifact none 表示一件都不带
const artifactArgs = args.flatMap((a, i) => (a === '--artifact' ? [args[i + 1]!] : []));
const artifacts = artifactArgs.length ? (artifactArgs.filter((k) => k !== 'none') as ArtifactKey[]) : undefined;
artifacts?.forEach((k) => {
  if (!(k in ARTIFACTS)) throw new Error(`未知神器 ${k}`);
});

// --level 可重复：开局即拥有的升级等级，如 --level attack=3
const levels: Record<string, number> = {};
args.forEach((a, i) => {
  if (a !== '--level') return;
  const [k, v] = args[i + 1]!.split('=');
  if (!(UPGRADE_KEYS as readonly string[]).includes(k!)) throw new Error(`未知升级 ${k}`);
  levels[k!] = Number(v);
});

// --set 可重复：--set chargeCap=3 --set playerShieldCap=20（数组参数如 multiplierSegments 不支持）
const config: EngineConfig = { ...DEFAULT_CONFIG };
args.forEach((a, i) => {
  if (a !== '--set') return;
  const [k, v] = args[i + 1]!.split('=');
  if (!(k! in config)) throw new Error(`未知参数 ${k}`);
  (config as unknown as Record<string, number>)[k!] = Number(v);
});

// --targets 1100,1500,...：冲分模式前 9 关的目标分
const targetsArg = opt('targets', '');
if (targetsArg) config.scoreTargets = targetsArg.split(',').map(Number);

// --mode score：冲分模式（2026-09-30 原型）
config.scoreMode = opt('mode', 'battle') === 'score';

const route: RouteNode[] = FULL_ROUTE.map((n) => ({
  ...n,
  enemy: {
    ...n.enemy,
    maxHp: Math.round(n.enemy.maxHp * hpScale),
    script: n.enemy.script.map((intent) => ({
      parts: intent.parts.map((p) => (p.kind === 'attack' || p.kind === 'charge' || p.kind === 'defend' ? { ...p, amount: Math.round(p.amount * atkScale) } : p)),
    })),
  },
}));

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
};
const f1 = (x: number) => x.toFixed(1);
const pc = (x: number) => `${(x * 100).toFixed(0)}%`;

function report(style: BotStyle) {
  const all = Array.from({ length: runs }, (_, i) => simulateRun(i + 1, { style, config, route, levels, ...(artifacts ? { artifacts } : {}) }));
  const won = all.filter((r) => r.outcome === 'won').length;
  const stalled = all.filter((r) => r.outcome === 'stalled').length;
  console.log(`\n=== ${style === 'skilled' ? '熟练' : '新手'}玩家 · ${runs} 局 · 段落通关 ${pc(won / runs)}${stalled ? ` · 卡住 ${stalled}` : ''} ===`);
  const header = ['战斗', '到达', '胜率', '回合', '受伤(含盾)', '掉血', '无伤率', '单步伤害 中位/p90', '平均倍率', '≥×3', '≥×4', '眩晕/场', '护盾/步', '护盾浪费', '开战护盾'];
  console.log(header.join(' | '));
  for (let i = 0; i < route.length; i++) {
    const bs = all.map((r) => r.battles[i]).filter((b): b is BattleReport => !!b);
    if (!bs.length) continue;
    const mults = bs.flatMap((b) => b.multipliers);
    const dmg = bs.flatMap((b) => b.actionDamage);
    console.log(
      [
        `${i + 1} ${route[i]!.enemy.name}`,
        pc(bs.length / runs),
        pc(bs.filter((b) => b.won).length / bs.length),
        f1(avg(bs.map((b) => b.turns))),
        f1(avg(bs.map((b) => b.damageTaken))),
        f1(avg(bs.map((b) => b.hpLost))),
        pc(bs.filter((b) => b.hpLost === 0).length / bs.length),
        `${pct(dmg, 0.5)} / ${pct(dmg, 0.9)}`,
        f1(avg(mults)),
        pc(mults.filter((m) => m >= 3).length / Math.max(1, mults.length)),
        pc(mults.filter((m) => m >= 4).length / Math.max(1, mults.length)),
        f1(avg(bs.map((b) => b.stuns))),
        f1(avg(bs.flatMap((b) => b.shieldGains))),
        pc(avg(bs.map((b) => b.shieldWasted)) / Math.max(1, avg(bs.map((b) => b.shieldWasted + b.shieldGains.reduce((x, y) => x + y, 0))))),
        f1(avg(bs.map((b) => b.shieldBefore))),
      ].join(' | '),
    );
  }
  // 炸弹与连锁：整局所有行动汇总
  const bs = all.flatMap((r) => r.battles);
  const actions = bs.reduce((n, b) => n + b.usedBomb.length, 0);
  const depth = bs.flatMap((b) => b.chainDepth);
  console.log(
    `炸弹与连锁 · ${actions} 次行动：每步被动产弹 ${avg(bs.flatMap((b) => b.passiveBombs)).toFixed(2)}，亲手做出 ${avg(bs.flatMap((b) => b.activeBombs)).toFixed(2)}，` +
      `用了炸弹的行动 ${pc(avg(bs.flatMap((b) => b.usedBomb)))}，连锁层数 平均 ${avg(depth).toFixed(1)} / p90 ${pct(depth, 0.9)}，` +
      `重排 ${bs.reduce((n, b) => n + b.shuffles, 0)} 次`,
  );
  const sum = (f: (b: BattleReport) => number) => bs.reduce((n, b) => n + f(b), 0);
  if (config.scoreMode) {
    for (let i = 0; i < route.length; i++) {
      const g = all.map((r) => r.battles[i]).filter((b): b is BattleReport => !!b && b.target !== undefined);
      if (!g.length) continue;
      const ratios = g.map((b) => b.score! / b.target!);
      const inc = g.filter((b) => b.income !== undefined);
      console.log(
        `冲分 ${i + 1} ${route[i]!.enemy.name}：目标 ${g[0]!.target}，达标 ${pc(ratios.filter((x) => x >= 1).length / g.length)}，得分/目标 p25 ${pct(ratios, 0.25).toFixed(2)} 中位 ${pct(ratios, 0.5).toFixed(2)}，未达标扣血 ${f1(avg(g.map((b) => b.hpLost)))}` +
          `，开局已升 ${f1(avg(g.map((b) => b.upgradesBefore ?? 0)))} 级${inc.length ? `，剩余步数 ${f1(avg(inc.map((b) => b.stepsLeft!)))}，收入 ${f1(avg(inc.map((b) => b.income!)))}` : ''}`,
      );
    }
  }
  console.log(`敌人攻击被护盾完全挡住：${pc(sum((b) => b.blockedTurns) / Math.max(1, sum((b) => b.attackTurns)))}（${sum((b) => b.attackTurns)} 次攻击）`);
}

const changed = Object.entries(config).filter(([k, v]) => (DEFAULT_CONFIG as unknown as Record<string, unknown>)[k] !== v);
console.log(`参数：${changed.length ? changed.map(([k, v]) => `${k}=${v}`).join(', ') : '默认'}${hpScale !== 1 ? `，敌人生命 ×${hpScale}` : ''}${atkScale !== 1 ? `，敌人数值 ×${atkScale}` : ''}${Object.keys(levels).length ? `，升级 ${Object.entries(levels).map(([k, v]) => `${k}=${v}`).join(' ')}` : ''}${artifacts ? `，神器 ${artifacts.join(' ') || '无'}` : ''}`);
if (styleArg === 'both' || styleArg === 'skilled') report('skilled');
if (styleArg === 'both' || styleArg === 'novice') report('novice');
