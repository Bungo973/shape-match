// 冲分模式的整局界面：开局神器 → 关卡（棋盘）→ 升级三选一 →（精英后）神器 → 营地 → 下一关。
// 规则全部由引擎给出；这里只负责展示、发出动作和安排动画的先后。
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ARTIFACTS,
  BOMB_NAME,
  BOMB_UPGRADES,
  buyHeal,
  buyUpgrade,
  chainMultiplier,
  chooseArtifact,
  DEFAULT_CONFIG,
  newRun,
  pickStarter,
  leaveShop,
  runAction,
  runEndTurn,
  startNextBattle,
  UPGRADE_KEYS,
  upgradePrice,
  upgradeEffectText,
  type Action,
  type ArtifactKey,
  type BattleState,
  type Income,
  type Pos,
  type RunResult,
  type RunState,
  type UpgradeKey,
} from '../engine';
import { getKit, getShepard, KIT_NAMES, setKit, setShepard, sfx, type SoundKit } from './audio';
import { BoardView } from './board/BoardView';
import { UpgradeIcon } from './icons';
import { clearRun, loadRun, saveRun } from './save';

const config = DEFAULT_CONFIG;

const newSeed = () => Math.floor(Math.random() * 1e9);
/** 网址带 ?seed=123 时从该种子开新局，便于复现 */
const urlSeed = () => Number(new URLSearchParams(window.location.search).get('seed')) || null;

function initialRun(): RunState {
  const seed = urlSeed();
  if (seed) return newRun(seed, config);
  return loadRun() ?? newRun(newSeed(), config);
}

const upgradeName = (k: UpgradeKey) => (k === 'block' ? '方块基数' : BOMB_NAME[k]);
const TIER_NAME = { minion: '', elite: '精英', boss: '终关' } as const;
const fmt = (n: number) => n.toLocaleString('zh-CN');

/** 一关结束时的结算信息，关掉后才进入下一个界面 */
interface Ending {
  won: boolean;
  score: number;
  target: number;
  penalty: number;
  /** 本关的金币收入；终关或失败时没有 */
  income: Income | null;
}

export function Game() {
  const [run, setRunState] = useState(initialRun);
  const [ending, setEnding] = useState<Ending | null>(null);

  const setRun = useCallback((r: RunState) => {
    setRunState(r);
    saveRun(r);
  }, []);

  const apply = (r: RunResult) => {
    if (r.ok) {
      sfx.ui();
      setRun(r.run);
    }
  };

  const restart = () => {
    clearRun();
    setEnding(null);
    setRun(newRun(newSeed(), config));
  };

  const node = run.battleIndex > 0 ? run.route[run.battleIndex - 1] : undefined;
  const showBattle = (run.phase === 'battle' || ending) && run.battle;

  return (
    <div className="game">
      <header className="top">
        <div className="level">
          <span className="lab">关卡</span>
          <b>{String(Math.max(1, run.battleIndex)).padStart(2, '0')}</b>
          <span className="of">/{String(run.route.length).padStart(2, '0')}</span>
          {node && TIER_NAME[node.tier] && <span className="tier">{TIER_NAME[node.tier]}</span>}
        </div>
        <div className="vitals">
          <Hp hp={run.player.hp} max={run.player.maxHp} />
          <span className="gold" title="金币">
            <i />
            {run.gold}
          </span>
        </div>
      </header>

      {showBattle ? (
        <Battle key={run.battleIndex} run={run} setRun={setRun} ending={ending} setEnding={setEnding} />
      ) : (
        <Between run={run} apply={apply} restart={restart} />
      )}

      <footer className="bottom">
        <Artifacts keys={run.artifacts} counters={run.battle?.player.counters ?? run.player.counters} />
        <div className="tools">
          <SoundPicker />
          <button className="link" onClick={restart}>
            重新开始
          </button>
        </div>
      </footer>
    </div>
  );
}

// ---------- 关卡 ----------

function Battle({ run, setRun, ending, setEnding }: { run: RunState; setRun: (r: RunState) => void; ending: Ending | null; setEnding: (e: Ending | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<BoardView | null>(null);
  const runRef = useRef(run);
  runRef.current = run;
  const busyRef = useRef(false);
  const [mult, setMult] = useState({ value: 1, chain: 0, final: false });
  const multRef = useRef(1);
  const battle = run.battle!;

  const setBusy = (v: boolean) => {
    busyRef.current = v;
    if (viewRef.current) viewRef.current.busy = v;
  };

  const doAction = useCallback(async (action: Action) => {
    const view = viewRef.current;
    if (busyRef.current || !view) return;
    const out = runAction(runRef.current, action, config);
    if (!out.ok || !out.log) {
      if (action.type === 'swap') {
        setBusy(true);
        await view.rejectSwap(action.from, action.to);
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    multRef.current = 1;
    setMult({ value: 1, chain: 0, final: false });
    const b = out.run.battle!;
    await view.play(out.log.result.events, b.board);
    const s = out.log.settlement;
    const at: Pos = action.type === 'swap' ? action.to : action.type === 'ignite' ? action.at : { r: 4, c: 4 };
    if (s && s.settlementScore > 0) {
      sfx.score(s.settlementScore);
      view.popText(`+${fmt(s.settlementScore)}`, s.multiplier > 1 ? `×${s.multiplier.toFixed(1)}` : '', at, s.settlementScore >= 200);
      setMult((m) => ({ ...m, value: s.multiplier, final: true }));
    }
    for (const t of out.log.counterTriggers) if ('at' in t && t.at) view.pulse([t.at]);
    runRef.current = out.run;
    setRun(out.run);
    if (b.outcome !== 'ongoing') {
      sfx.win();
      setEnding({ won: true, score: b.totalScore, target: b.goal?.target ?? 0, penalty: 0, income: out.run.income });
      setBusy(false);
      return;
    }
    // 冲分模式没有敌人：行动力用完就自动进入下一回合
    if (b.ap <= 0) {
      const next = runEndTurn(out.run, config);
      if (next.ok) {
        const nb = next.run.battle!;
        runRef.current = next.run;
        setRun(next.run);
        view.sync(nb.board);
        if (next.log?.turnStartBombs?.length) view.pulse(next.log.turnStartBombs);
        if (nb.outcome !== 'ongoing') {
          const won = nb.totalScore >= (nb.goal?.target ?? 0);
          if (won) sfx.win();
          else sfx.short();
          setEnding({ won, score: nb.totalScore, target: nb.goal?.target ?? 0, penalty: next.log?.scorePenalty ?? 0, income: next.run.income });
        } else sfx.turn();
      }
    }
    setBusy(false);
  }, [setRun, setEnding]);

  useEffect(() => {
    const view = new BoardView(canvasRef.current!, {
      onSwap: (from, to) => void doAction({ type: 'swap', from, to }),
      onIgnite: (at) => void doAction({ type: 'ignite', at }),
      onChain: (passive, chain) => {
        const value = chainMultiplier(passive, config);
        // 倍率跨过整数档时响一声
        if (Math.floor(value) > Math.floor(multRef.current)) sfx.multUp(Math.floor(value) - 1);
        multRef.current = value;
        setMult({ value, chain, final: false });
      },
    });
    viewRef.current = view;
    view.sync(runRef.current.battle!.board, true);
    canvasRef.current!.focus({ preventScroll: true });
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [doAction]);

  const target = battle.goal?.target ?? 0;
  const score = useRolling(battle.totalScore);
  const progress = target ? Math.min(1, score / target) : 0;

  return (
    <main className="battle">
      <section className="scoreline" aria-live="polite">
        <div className="score">
          <b>{fmt(score)}</b>
          <span className="target">/ {fmt(target)}</span>
        </div>
        <Multiplier {...mult} />
      </section>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={battle.totalScore}>
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
      <div className="stage">
        <canvas ref={canvasRef} tabIndex={0} aria-label="棋盘：拖动或点选相邻方块交换，点两下炸弹引爆" />
        {ending && <EndingCard ending={ending} onNext={() => setEnding(null)} />}
      </div>
      <section className="status">
        <Steps battle={battle} />
        <BombHeat battle={battle} />
      </section>
    </main>
  );
}

/** 数字滚动到新值 */
function useRolling(value: number): number {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      const cur = shownRef.current;
      if (cur === value) return;
      const next = value > cur ? Math.min(value, cur + Math.max(1, Math.round((value - cur) * Math.min(1, dt / 120)))) : value;
      shownRef.current = next;
      setShown(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

function Multiplier({ value, chain, final }: { value: number; chain: number; final: boolean }) {
  // 倍率槽：每段一格，段内按比例填充
  const cap = config.multiplierSegments.length;
  const filled = Math.min(cap, value - 1);
  return (
    <div className={`mult${value > 1 ? ' hot' : ''}${final ? ' final' : ''}`}>
      <div className="segs" aria-hidden="true">
        {Array.from({ length: cap }, (_, i) => (
          <span key={i}>
            <i style={{ transform: `scaleY(${Math.max(0, Math.min(1, filled - i))})` }} />
          </span>
        ))}
      </div>
      <div className="val">
        <b>×{value.toFixed(1)}</b>
        <span>{chain > 0 ? `连锁 ${chain}` : '倍率'}</span>
      </div>
    </div>
  );
}

function Steps({ battle }: { battle: BattleState }) {
  const turns = battle.goal?.turns ?? config.scoreTurns;
  const left = (turns - battle.turn) * config.apPerTurn + battle.ap;
  return (
    <div className="steps">
      <span className="lab">剩余步数</span>
      <div className="groups" aria-label={`还剩 ${left} 步`}>
        {Array.from({ length: turns }, (_, i) => {
          const t = i + 1;
          const n = t < battle.turn ? 0 : t === battle.turn ? battle.ap : config.apPerTurn;
          const slots = Math.max(config.apPerTurn, t === battle.turn ? battle.ap : 0);
          return (
            <span key={i} className={`group${t === battle.turn ? ' now' : ''}`}>
              {Array.from({ length: slots }, (_, j) => (
                <i key={j} className={j < n ? 'on' : ''} />
              ))}
            </span>
          );
        })}
      </div>
      <b className="left">{left}</b>
    </div>
  );
}

function BombHeat({ battle }: { battle: BattleState }) {
  return (
    <div className="heat">
      {BOMB_UPGRADES.map((k) => {
        const h = battle.bombHeat[k];
        const every = config.bombHeatEvery[k];
        return (
          <div key={k} className="heat-item" title={`${BOMB_NAME[k]}：本关每引爆 ${every} 枚升一级`}>
            <UpgradeIcon upgrade={k} size={18} />
            <span className="lv">Lv{h.level}</span>
            <span className="meter">
              <i style={{ transform: `scaleX(${h.count / every})` }} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EndingCard({ ending, onNext }: { ending: Ending; onNext: () => void }) {
  const short = ending.target - ending.score;
  return (
    <div className="ending" role="dialog" aria-label="关卡结算">
      <div className={`card ${ending.won ? 'won' : 'short'}`}>
        <span className="lab">{ending.won ? '达标' : '未达标'}</span>
        <b>{fmt(ending.score)}</b>
        <p>{ending.won ? `目标 ${fmt(ending.target)}` : `差 ${fmt(short)} 分 · 生命 −${ending.penalty}`}</p>
        {ending.income && <IncomeLines income={ending.income} />}
        <button
          className="primary"
          onClick={() => {
            sfx.ui();
            onNext();
          }}
          autoFocus
        >
          继续
        </button>
      </div>
    </div>
  );
}

// ---------- 关卡之间 ----------

function Between({ run, apply, restart }: { run: RunState; apply: (r: RunResult) => void; restart: () => void }) {
  switch (run.phase) {
    case 'starter':
      return (
        <Panel eyebrow="开局" title="选一件神器">
          <ArtifactChoices keys={run.starterChoices} onPick={(k) => apply(pickStarter(run, k))} />
        </Panel>
      );
    case 'map': {
      const next = run.route[run.battleIndex];
      const idx = run.battleIndex + 1;
      return (
        <Panel eyebrow={`第 ${idx} 关${next && TIER_NAME[next.tier] ? ` · ${TIER_NAME[next.tier]}` : ''}`} title={`目标 ${fmt(next?.enemy.targetScore ?? 0)} 分`}>
          <p className="hint">
            {config.scoreTurns} 回合，每回合 {config.apPerTurn} 步。达到目标立即过关，剩下的每一步换 {config.goldPerStep} 金币；步数用完仍未达标，按差距扣生命。
          </p>
          <button className="primary big" onClick={() => apply(startNextBattle(run, config))} autoFocus>
            开始
          </button>
        </Panel>
      );
    }
    case 'artifact':
      return (
        <Panel eyebrow="精英奖励" title="选一件神器">
          <ArtifactChoices keys={run.artifactChoices} onPick={(k) => apply(chooseArtifact(run, k))} />
        </Panel>
      );
    case 'shop':
      return <Shop run={run} apply={apply} />;
    case 'over':
      return (
        <Panel eyebrow={run.outcome === 'won' ? '通关' : '生命耗尽'} title={`总分 ${fmt(run.totalScore)}`}>
          <p className="hint">
            {run.outcome === 'won' ? `九关全部打完，剩余生命 ${run.player.hp}。` : `停在第 ${run.battleIndex} 关。`}
          </p>
          <button className="primary big" onClick={restart} autoFocus>
            再来一局
          </button>
        </Panel>
      );
    default:
      return null;
  }
}

function IncomeLines({ income }: { income: Income }) {
  return (
    <ul className="income" aria-label="金币收入">
      <li>
        <span>过关</span>
        <b>+{income.base}</b>
      </li>
      {income.elite > 0 && (
        <li>
          <span>精英</span>
          <b>+{income.elite}</b>
        </li>
      )}
      {income.steps > 0 && (
        <li>
          <span>剩余 {income.steps} 步</span>
          <b>+{income.fromSteps}</b>
        </li>
      )}
      <li className="total">
        <span>金币</span>
        <b>+{income.total}</b>
      </li>
    </ul>
  );
}

function Shop({ run, apply }: { run: RunState; apply: (r: RunResult) => void }) {
  const hurt = run.player.hp < run.player.maxHp;
  return (
    <Panel eyebrow={`金币 ${run.gold}`} title="商店">
      <p className="hint">升级都在这里买，可以买多次；同一项每升一级涨价 {config.upgradePriceStep}。</p>
      <div className="choices grid">
        {UPGRADE_KEYS.map((k) => {
          const price = upgradePrice(run, k, config);
          return (
            <UpgradeCard key={k} upgrade={k} level={run.levels[k]} add={1} price={price} disabled={run.gold < price} onPick={() => apply(buyUpgrade(run, k, config))} />
          );
        })}
      </div>
      <button className="rest" disabled={!hurt || run.gold < config.healPrice} onClick={() => apply(buyHeal(run, config))}>
        <b>回血</b>
        <span>
          生命 +{config.healAmount} · {config.healPrice} 金币
        </span>
      </button>
      <button className="primary big" onClick={() => apply(leaveShop(run))}>
        {run.battleIndex >= run.route.length ? '结束' : '下一关'}
      </button>
    </Panel>
  );
}

function Panel({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <main className="panel">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      {children}
    </main>
  );
}

function UpgradeCard({ upgrade, level, add, price, onPick, disabled }: { upgrade: UpgradeKey; level: number; add: number; price: number; onPick: () => void; disabled?: boolean }) {
  return (
    <button className="choice" onClick={onPick} disabled={disabled}>
      <UpgradeIcon upgrade={upgrade} size={34} />
      <b>{upgradeName(upgrade)}</b>
      <span className="lv">
        Lv{level} → Lv{level + add}
      </span>
      <span className="desc">{upgradeEffectText(upgrade, level + add, config)}</span>
      <span className="price">
        <i />
        {price}
      </span>
    </button>
  );
}

function ArtifactChoices({ keys, onPick }: { keys: ArtifactKey[]; onPick: (k: ArtifactKey) => void }) {
  return (
    <div className="choices">
      {keys.map((k) => {
        const a = ARTIFACTS[k];
        return (
          <button key={k} className="choice" onClick={() => onPick(k)}>
            <span className="badge">{a.id}</span>
            <b>{a.name}</b>
            <span className="desc">{a.text}</span>
          </button>
        );
      })}
    </div>
  );
}

function Artifacts({ keys, counters }: { keys: ArtifactKey[]; counters: Partial<Record<ArtifactKey, number>> | undefined }) {
  if (!keys.length) return <span />;
  return (
    <ul className="artifacts">
      {keys.map((k) => {
        const a = ARTIFACTS[k];
        return (
          <li key={k} title={a.text}>
            <span className="badge">{a.id}</span>
            {a.name}
            {a.every && (
              <span className="count">
                {counters?.[k] ?? 0}/{a.every}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Hp({ hp, max }: { hp: number; max: number }) {
  return (
    <span className="hp" title="生命">
      <span className="lab">生命</span>
      <span className="meter">
        <i style={{ transform: `scaleX(${hp / max})` }} />
      </span>
      <b>{hp}</b>
    </span>
  );
}

function SoundPicker() {
  const [kit, setKitState] = useState<SoundKit>(getKit);
  const [shep, setShep] = useState(getShepard);
  const pick = (k: SoundKit) => {
    setKit(k);
    setKitState(k);
    sfx.clear(2, 4);
  };
  // 试听：连续播放 8 层连锁
  const demo = () => {
    for (let i = 0; i < 8; i++) window.setTimeout(() => sfx.clear(i, 4), i * 170);
  };
  const toggle = (on: boolean) => {
    setShepard(on);
    setShep(on);
    demo();
  };
  return (
    <div className="sound-wrap">
      <div className="sound" role="group" aria-label="音效">
        <span className="lab">音效</span>
        {(Object.keys(KIT_NAMES) as SoundKit[]).map((k) => (
          <button key={k} aria-pressed={kit === k} onClick={() => pick(k)}>
            {KIT_NAMES[k]}
          </button>
        ))}
      </div>
      <div className="sound" role="group" aria-label="连锁音阶">
        <span className="lab">连锁音阶</span>
        <button aria-pressed={!shep} onClick={() => toggle(false)}>
          普通
        </button>
        <button aria-pressed={shep} onClick={() => toggle(true)}>
          谢泼德
        </button>
        <button onClick={demo} title="连续播放 8 层连锁">
          ▶ 试听
        </button>
      </div>
    </div>
  );
}
