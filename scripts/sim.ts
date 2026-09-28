// 数值模拟：让自动玩家批量打第一段落，统计每场战斗的表现。
// 用法：npm run sim -- [--runs 200] [--style skilled|novice|both] [--set 参数=值 ...] [--hp 倍数] [--atk 倍数]
// 例：npm run sim -- --set passivePerStep=5 --hp 1.5
import { DEFAULT_CONFIG, SEGMENT_1, type EngineConfig, type RouteNode } from '../src/engine';
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

// --set 可重复：--set passivePerStep=5 --set playerShieldCap=20
const config: EngineConfig = { ...DEFAULT_CONFIG };
args.forEach((a, i) => {
  if (a !== '--set') return;
  const [k, v] = args[i + 1]!.split('=');
  if (!(k! in config)) throw new Error(`未知参数 ${k}`);
  (config as unknown as Record<string, number>)[k!] = Number(v);
});

const route: RouteNode[] = SEGMENT_1.map((n) => ({
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
  const all = Array.from({ length: runs }, (_, i) => simulateRun(i + 1, { style, config, route }));
  const won = all.filter((r) => r.outcome === 'won').length;
  const stalled = all.filter((r) => r.outcome === 'stalled').length;
  console.log(`\n=== ${style === 'skilled' ? '熟练' : '新手'}玩家 · ${runs} 局 · 段落通关 ${pc(won / runs)}${stalled ? ` · 卡住 ${stalled}` : ''} ===`);
  const header = ['战斗', '到达', '胜率', '回合', '受伤(含盾)', '掉血', '无伤率', '单步伤害 中位/p90', '×8 占比', '眩晕/场', '护盾/步', '开战护盾'];
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
        pc(mults.filter((m) => m === 8).length / Math.max(1, mults.length)),
        f1(avg(bs.map((b) => b.stuns))),
        f1(avg(bs.flatMap((b) => b.shieldGains))),
        f1(avg(bs.map((b) => b.shieldBefore))),
      ].join(' | '),
    );
  }
}

const changed = Object.entries(config).filter(([k, v]) => (DEFAULT_CONFIG as unknown as Record<string, unknown>)[k] !== v);
console.log(`参数：${changed.length ? changed.map(([k, v]) => `${k}=${v}`).join(', ') : '默认'}${hpScale !== 1 ? `，敌人生命 ×${hpScale}` : ''}${atkScale !== 1 ? `，敌人数值 ×${atkScale}` : ''}`);
if (styleArg === 'both' || styleArg === 'skilled') report('skilled');
if (styleArg === 'both' || styleArg === 'novice') report('novice');
