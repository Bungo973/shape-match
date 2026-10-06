// 冲分模式的整局界面：开局神器 → 关卡（棋盘）→ 结算金币 →（首领后）神器 → 商店 → 下一关。
// 规则全部由引擎给出；这里只负责展示、发出动作和安排动画的先后。
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ARTIFACTS,
  ARTIFACT_PARAMS,
  artifactPrice,
  artifactSellPrice,
  buyArtifact,
  RARITY_NAME,
  sellArtifact,
  skipArtifact,
  turnAp,
  BOMB_NAME,
  BOMB_UPGRADES,
  buyHeal,
  buyItem,
  ITEMS,
  runUseItem,
  buyUpgrade,
  chainMultiplier,
  BOSS_RULES,
  chooseArtifact,
  continueEndless,
  DEFAULT_CONFIG,
  newRun,
  pickStarter,
  leaveShop,
  levelInfo,
  ruleConfig,
  runAction,
  runEndTurn,
  startNextBattle,
  UPGRADE_KEYS,
  upgradePrice,
  upgradeEffectText,
  type Action,
  type ArtifactKey,
  levelTasks,
  type TaskDef,
  type TaskResult,
  type TaskState,
  type BattleState,
  type Color,
  type Income,
  type ItemUse,
  type ResolutionEvent,
  type ActionLog,
  type Pos,
  type RunResult,
  type RunState,
  type UpgradeKey,
} from '../engine';
import { getKit, getShepard, KIT_NAMES, setKit, setShepard, sfx, type SoundKit } from './audio';
import { BoardView } from './board/BoardView';
import { ItemIcon, UpgradeIcon } from './icons';
import { clearRun, loadBest, loadRun, recordBest, saveRun } from './save';

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
const ITEM_FAIL: Record<string, string> = { noBomb: '棋盘上没有炸弹', notNormal: '只能放在普通方块上', stone: '石块不能交换', sameColor: '同色方块换了也一样', noAp: '这回合没有步了', notAdjacent: '要选相邻的两格' };

const COLOR_NAME: Record<Color, string> = { attack: '红圆', shield: '蓝方', poison: '黄三角', catalyst: '绿菱形' };
const fmt = (n: number) => n.toLocaleString('zh-CN');
const LOST_TEXT: Partial<Record<ArtifactKey, string>> = { banana: '香蕉烂掉了', iceCream: '冰淇淋化完了', standIn: '替身挡下了致命的扣血，然后消失了' };
const RANGE_TAG: Partial<Record<ArtifactKey, string>> = { thunderFuse: '闪电', crossFuse: '十字', bigBore: '5×5' };
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** 一关结束时的结算信息，关掉后才进入下一个界面 */
interface Ending {
  won: boolean;
  score: number;
  target: number;
  penalty: number;
  /** 本关的金币收入；终关或失败时没有 */
  income: Income | null;
  /** 本关结束时消失的神器（香蕉烂掉） */
  lost?: ArtifactKey[];
  task?: TaskResult | null | undefined;
}

export function Game() {
  const [run, setRunState] = useState(initialRun);
  const [ending, setEnding] = useState<Ending | null>(null);
  // 神器触发：神器栏里那一件抖一下、弹出数值；n 每次递增，让动画重新播放
  const [pings, setPings] = useState<Partial<Record<ArtifactKey, { label: string; n: number }>>>({});
  const pingCount = useRef(0);
  const ping = useCallback((key: ArtifactKey, label: string) => {
    setPings((p) => ({ ...p, [key]: { label, n: ++pingCount.current } }));
  }, []);

  const setRun = useCallback((r: RunState) => {
    setRunState(r);
    saveRun(r);
    // 一局结束（通关或生命耗尽）时记录成绩；通关后继续无尽，结束时再记一次
    if (r.phase === 'over') recordBest({ level: r.outcome === 'won' ? r.battleIndex : r.battleIndex - 1, score: r.totalScore });
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

  // 路线页显示即将开始的那一关，其余时候显示当前（或刚结束）的一关
  const shownLevel = run.phase === 'map' ? run.battleIndex + 1 : Math.max(1, run.battleIndex);
  const boss = run.phase !== 'starter' && levelInfo(run, shownLevel, config).boss;
  const showBattle = (run.phase === 'battle' || ending) && run.battle;

  const [drawer, setDrawer] = useState(false);
  const sellable = run.phase === 'shop' || run.phase === 'artifact';
  const counters = { ...(run.battle?.player.counters ?? run.player.counters), loyaltyCard: (run.battle?.stepsTaken ?? 0) % ARTIFACT_PARAMS.loyaltyEvery };

  return (
    <div className="shell">
    <div className="game">
      <header className="top">
        <div className="level">
          <span className="lab">关卡</span>
          <b>{String(shownLevel).padStart(2, '0')}</b>
          <span className="of">{run.endless ? '无尽' : `/${String(run.route.length).padStart(2, '0')}`}</span>
          {boss && <span className="tier">首领</span>}
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
        <Battle key={run.battleIndex} run={run} setRun={setRun} ending={ending} setEnding={setEnding} ping={ping} />
      ) : (
        <Between run={run} apply={apply} restart={restart} />
      )}

      <footer className="bottom">
        <Artifacts keys={run.artifacts} gold={run.battle?.gold ?? run.gold} counters={counters} pings={pings} onOpen={() => setDrawer(true)} />
        <div className="tools">
          <SoundPicker />
          <button className="link" onClick={restart}>
            重新开始
          </button>
        </div>
      </footer>
    </div>
      <ArtifactPanel
        keys={run.artifacts}
        counters={counters}
        gold={run.battle?.gold ?? run.gold}
        ap={run.phase === 'battle' ? (run.battle?.ap ?? null) : null}
        pings={pings}
        open={drawer}
        onClose={() => setDrawer(false)}
        onSell={sellable ? (k) => apply(sellArtifact(run, k, config)) : undefined}
      />
    </div>
  );
}

// ---------- 关卡 ----------

function Battle({
  run,
  setRun,
  ending,
  setEnding,
  ping,
}: {
  run: RunState;
  setRun: (r: RunState) => void;
  ending: Ending | null;
  setEnding: (e: Ending | null) => void;
  ping: (key: ArtifactKey, label: string) => void;
}) {
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

  /** 播放一步（交换、点燃或道具）的结果：动画、计分弹字、过关判定与回合交接 */
  const finish = useCallback(async (next: RunState, log: ActionLog | null, events: ResolutionEvent[], at: Pos, pulseAt: Pos[] = []) => {
    const view = viewRef.current!;
    multRef.current = 1;
    setMult({ value: 1, chain: 0, final: false });
    const b = next.battle!;
    if (events.length) await view.play(events, b.board);
    else view.sync(b.board);
    if (pulseAt.length) view.pulse(pulseAt);
    // 改变爆炸范围的神器（雷鸣引线、十字引线、大口径）：这一步用到了就抖一下
    const shaped = new Set<ArtifactKey>();
    for (const e of events) if (e.type === 'wave') for (const x of e.explosions) if (x.byArtifact) shaped.add(x.byArtifact);
    for (const k of shaped) ping(k, RANGE_TAG[k] ?? '');
    if (log?.freeSwap) ping('freeHand', '自由');
    const s = log?.settlement;
    // 神器逐件结算：倍率从连锁的值开始，每件神器抖一下、倍率跳一档，最后才出分
    if (s && log?.tally) {
      setMult((m) => ({ ...m, value: log.tally!.start }));
      await wait(160);
      for (const [i, t] of log.tally.steps.entries()) {
        ping(t.key, t.label);
        sfx.tally(i);
        setMult((m) => ({ ...m, value: t.value }));
        await wait(240);
      }
    }
    if (s && s.settlementScore > 0) {
      sfx.score(s.settlementScore);
      view.popText(`+${fmt(s.settlementScore)}`, s.multiplier > 1 ? `×${s.multiplier.toFixed(1)}` : '', at, s.settlementScore >= 200);
      setMult((m) => ({ ...m, value: s.multiplier, final: true }));
    } else if (s) {
      // 基数为 0（“色封”下只消了被封的颜色）：倍率再高也是 0 分，照样弹出说明，不让结算看起来卡住
      view.popText('+0', b.rule?.key === 'sealed' ? '色封不计分' : '基数为 0', at);
      setMult((m) => ({ ...m, value: s.multiplier, final: true }));
    }
    for (const t of log?.counterTriggers ?? []) {
      ping(t.key, t.key === 'fuseBox' ? `+${t.ap} 步` : t.key === 'fission' ? `直线 ×${t.cells.length}` : '3×3');
      sfx.artifact();
    }
    for (const t of log?.counterTriggers ?? []) {
      if ('at' in t && t.at) view.pulse([t.at]);
      if ('cells' in t && t.cells.length) view.pulse(t.cells);
    }
    // 任务在这一步完成：响一声
    if (b.task?.done && !runRef.current.battle?.task?.done) sfx.bombMade();
    runRef.current = next;
    setRun(next);
    if (b.outcome !== 'ongoing') {
      // 结算卡立刻挂上（让界面停在棋盘上，不先闪出商店），卡片本身延迟淡入，等出分弹字和分数滚动播完
      sfx.win();
      setEnding({ won: true, score: b.totalScore, target: b.goal?.target ?? 0, penalty: 0, income: next.income, lost: next.lostArtifacts, task: next.taskResult });
      return;
    }
    // 冲分模式没有敌人：行动力用完就自动进入下一回合
    if (b.ap <= 0) {
      const after = runEndTurn(next, config);
      if (after.ok) {
        const nb = after.run.battle!;
        runRef.current = after.run;
        setRun(after.run);
        view.sync(nb.board);
        if (after.log?.turnStartBombs?.length) {
          view.pulse(after.log.turnStartBombs);
          if (nb.artifacts.includes('powderKeg')) ping('powderKeg', '3×3');
          if (nb.artifacts.includes('prismOre')) ping('prismOre', '五连');
          sfx.artifact();
        }
        if (nb.outcome !== 'ongoing') {
          const won = nb.totalScore >= (nb.goal?.target ?? 0);
          if (won) sfx.win();
          else sfx.short();
          setEnding({ won, score: nb.totalScore, target: nb.goal?.target ?? 0, penalty: after.log?.scorePenalty ?? 0, income: after.run.income, lost: after.run.lostArtifacts, task: after.run.taskResult });
        } else sfx.turn();
      }
    }
  }, [setRun, setEnding, ping]);

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
    const at: Pos = action.type === 'swap' ? action.to : action.type === 'ignite' ? action.at : { r: 4, c: 4 };
    await finish(out.run, out.log, out.log.result.events, at);
    setBusy(false);
  }, [finish]);

  // ---- 道具 ----
  const [picking, setPicking] = useState<number | null>(null);
  const pickingRef = useRef<number | null>(null);
  const [hint, setHint] = useState('');

  const choose = (slot: number | null) => {
    pickingRef.current = slot;
    setPicking(slot);
    const key = slot == null ? null : runRef.current.items[slot];
    const target = key ? ITEMS[key].target : null;
    viewRef.current?.setPick(target === 'cell' || target === 'pair' ? target : null);
    setHint(key ? (target === 'pair' ? `选相邻两格使用${ITEMS[key].name}` : `选一格使用${ITEMS[key].name}`) : '');
  };

  const applyItem = useCallback(async (slot: number, use: ItemUse) => {
    const view = viewRef.current;
    if (busyRef.current || !view) return;
    const out = runUseItem(runRef.current, slot, use, config);
    if (!out.ok) {
      setHint(ITEM_FAIL[out.reason] ?? '这里不能用');
      return;
    }
    choose(null);
    sfx.ui();
    if (use.key === 'charge') sfx.bombMade();
    setBusy(true);
    const at: Pos = 'at' in use ? use.at : 'to' in use ? use.to : { r: 4, c: 4 };
    await finish(out.run, out.log ?? null, out.events ?? [], at, use.key === 'charge' ? [use.at] : []);
    setBusy(false);
  }, [finish]);

  const pickItem = (slot: number) => {
    if (busyRef.current) return;
    if (pickingRef.current === slot) return choose(null);
    const key = runRef.current.items[slot]!;
    if (key === 'detonator' || key === 'shuffle') return void applyItem(slot, { key });
    choose(slot);
  };

  useEffect(() => {
    const view = new BoardView(canvasRef.current!, {
      onSwap: (from, to) => void doAction({ type: 'swap', from, to }),
      onIgnite: (at) => void doAction({ type: 'ignite', at }),
      onPickCell: (at) => {
        const slot = pickingRef.current;
        const key = slot == null ? null : runRef.current.items[slot];
        if (slot != null && (key === 'hammer' || key === 'charge')) void applyItem(slot, { key, at });
      },
      onPickPair: (from, to) => {
        const slot = pickingRef.current;
        if (slot != null && runRef.current.items[slot] === 'glove') void applyItem(slot, { key: 'glove', from, to });
      },
      onChain: (passive, chain) => {
        const value = chainMultiplier(passive, ruleConfig(runRef.current.battle ?? {}, config));
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
  }, [doAction, applyItem]);

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
        <Multiplier {...mult} cap={ruleConfig(battle, config).multiplierSegments.length} />
      </section>
      {battle.rule && <RuleBadge rule={battle.rule.key} color={battle.rule.color} />}
      {battle.task && <TaskLine task={battle.task} />}
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
      {run.items.length > 0 && (
        <section className="items" aria-label="道具">
          {run.items.map((k, i) => (
            <button key={i} className="item" aria-pressed={picking === i} onClick={() => pickItem(i)} title={ITEMS[k].text}>
              <ItemIcon item={k} size={20} />
              {ITEMS[k].name}
            </button>
          ))}
          <span className="hint">{hint || (picking == null ? '点道具使用' : '')}</span>
        </section>
      )}
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

function Multiplier({ value, chain, final, cap }: { value: number; chain: number; final: boolean; cap: number }) {
  // 倍率槽：每段一格，段内按比例填充；首领规则“低压”时段数变少
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
        <b key={value.toFixed(1)}>×{value.toFixed(1)}</b>
        <span>{chain > 0 ? `连锁 ${chain}` : '倍率'}</span>
      </div>
    </div>
  );
}

function Steps({ battle }: { battle: BattleState }) {
  const turns = battle.goal?.turns ?? config.scoreTurns;
  const perTurn = turnAp(battle, config);
  const left = (turns - battle.turn) * perTurn + battle.ap;
  return (
    <div className="steps">
      <span className="lab">剩余步数</span>
      <div className="groups" aria-label={`还剩 ${left} 步`}>
        {Array.from({ length: turns }, (_, i) => {
          const t = i + 1;
          const n = t < battle.turn ? 0 : t === battle.turn ? battle.ap : perTurn;
          const slots = Math.max(perTurn, t === battle.turn ? battle.ap : 0);
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
        {ending.task && (
          <p className={`taskres${ending.task.done ? ' done' : ''}`}>
            任务「{taskText(ending.task.def)}」
            {ending.task.done ? (ending.task.artifact ? `完成：获得 ${ARTIFACTS[ending.task.artifact].name}` : '完成') : '未完成'}
          </p>
        )}
        {ending.income && <IncomeLines income={ending.income} />}
        {ending.lost?.map((k) => (
          <p key={k} className="lost">
            {LOST_TEXT[k] ?? `${ARTIFACTS[k].name}消失了`}
          </p>
        ))}
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
    case 'map':
      return <MapPanel run={run} apply={apply} />;
    case 'artifact':
      return (
        <Panel eyebrow="首领奖励" title="选一件神器">
          <ArtifactChoices keys={run.artifactChoices} full={run.artifacts.length >= config.artifactSlots} onPick={(k) => apply(chooseArtifact(run, k, config))} />
          {run.artifacts.length >= config.artifactSlots && <p className="hint">神器栏满了：在神器栏里卖掉一件，或者跳过。</p>}
          <button className="ghost" onClick={() => apply(skipArtifact(run, config))}>
            跳过
          </button>
        </Panel>
      );
    case 'shop':
      return <Shop run={run} apply={apply} />;
    case 'over': {
      const best = loadBest();
      const won = run.outcome === 'won';
      const eyebrow = won ? '通关' : run.endless ? `无尽 · 到达第 ${run.battleIndex} 关` : '生命耗尽';
      return (
        <Panel eyebrow={eyebrow} title={`总分 ${fmt(run.totalScore)}`}>
          <p className="hint">
            {won
              ? `九关全部打完，剩余生命 ${run.player.hp}。可以继续挑战无尽模式：目标每关上涨，直到生命耗尽。`
              : run.endless
                ? `通关后又多打了 ${run.battleIndex - 1 - run.route.length} 关。`
                : `停在第 ${run.battleIndex} 关。`}
          </p>
          {best && (
            <p className="best">
              最好成绩：通过 {best.level} 关 · {fmt(best.score)} 分
            </p>
          )}
          <div className="row">
            {won && (
              <button className="primary big" onClick={() => apply(continueEndless(run))} autoFocus>
                继续挑战无尽
              </button>
            )}
            <button className={won ? 'ghost' : 'primary big'} onClick={restart} autoFocus={!won}>
              再来一局
            </button>
          </div>
        </Panel>
      );
    }
    default:
      return null;
  }
}

/** 路线页：本关目标、首领规则，以及一易一难两条任务二选一 */
function MapPanel({ run, apply }: { run: RunState; apply: (r: RunResult) => void }) {
  const info = levelInfo(run, run.battleIndex + 1, config);
  const tasks = levelTasks(run, info.level, config);
  const [pick, setPick] = useState<0 | 1>(0);
  return (
    <Panel eyebrow={`第 ${info.level} 关${info.boss ? ' · 首领' : ''}${run.endless ? ' · 无尽' : ''}`} title={`目标 ${fmt(info.target)} 分`}>
      {info.rule && <RuleBadge rule={info.rule} big />}
      {info.rule && run.artifacts.includes('exemption') && <p className="hint">免检章：这条首领规则对你无效。</p>}
      <p className="hint">
        {config.scoreTurns} 回合，每回合 {turnAp(run, config)} 步。达到目标立即过关，剩下的每一步换 {config.goldPerStep} 金币；步数用完仍未达标，按差距扣生命。
      </p>
      <h2 className="sub">
        任务<span>选一条。本关里做到就算完成，没达标也照发奖励</span>
      </h2>
      <div className="choices grid tasks" role="radiogroup" aria-label="任务">
        {tasks.map((t, i) => (
          <button key={i} className={`choice task ${t.tier}`} role="radio" aria-checked={pick === i} onClick={() => setPick(i as 0 | 1)}>
            <span className={`badge ${t.tier === 'hard' ? 'rare' : ''}`}>{t.tier === 'easy' ? '易' : '难'}</span>
            <b>{taskText(t)}</b>
            <span className="desc">{taskRewardText(t, info.boss)}</span>
          </button>
        ))}
      </div>
      <button className="primary big" onClick={() => apply(startNextBattle(run, config, pick))} autoFocus>
        开始
      </button>
    </Panel>
  );
}

/** 任务的说明文字 */
function taskText(t: TaskDef): string {
  switch (t.kind) {
    case 'chain':
      return `一步连锁 ${t.goal} 层`;
    case 'bigClear':
      return `一步清除 ${t.goal} 格`;
    case 'mult':
      return `一步倍率达到 ×${t.goal}`;
    case 'bigStep':
      return `一步拿到 ${fmt(t.goal)} 分`;
    case 'colorBombs':
      return `做出 ${t.goal} 枚五连炸弹`;
    case 'detonations':
      return `引爆 ${t.goal} 枚炸弹`;
    case 'noItem':
      return '不用道具达标';
    case 'speed':
      return `提前 ${t.goal} 步达标`;
  }
}

function taskRewardText(t: TaskDef, boss: boolean): string {
  return t.tier === 'easy' ? `奖励 ${boss ? config.taskGoldBoss : config.taskGold} 金币` : `奖励一件随机神器（栏满改给 ${config.taskFullGold} 金币）`;
}

/** 关内的任务进度：单步类显示最好的一步，累计类显示总数；速通、轻装到达标时才判定 */
function TaskLine({ task }: { task: TaskState }) {
  const { def, progress, done, failed } = task;
  const shown = def.kind === 'mult' ? `×${Math.max(1, progress).toFixed(1)}` : fmt(Math.floor(progress));
  const goal = def.kind === 'mult' ? `×${def.goal}` : fmt(def.goal);
  const status = done ? '完成' : failed ? '失败' : def.kind === 'speed' || def.kind === 'noItem' ? '达标时判定' : `${shown} / ${goal}`;
  return (
    <div className={`taskline${done ? ' done' : ''}${failed ? ' failed' : ''}`} key={done ? 'done' : 'todo'}>
      <span className={`badge ${def.tier === 'hard' ? 'rare' : ''}`}>{def.tier === 'easy' ? '易' : '难'}</span>
      <b>{taskText(def)}</b>
      <span className="prog">{status}</span>
    </div>
  );
}

/** 首领规则：原色方块做标记，说明写在旁边 */
function RuleBadge({ rule, color, big }: { rule: keyof typeof BOSS_RULES; color?: Color | undefined; big?: boolean }) {
  const r = BOSS_RULES[rule];
  return (
    <div className={`rule${big ? ' big' : ''}`}>
      <b>首领 · {r.name}</b>
      <span>
        {r.text}
        {color && `本关不计分的是${COLOR_NAME[color]}。`}
      </span>
    </div>
  );
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
      {income.task > 0 && (
        <li>
          <span>任务</span>
          <b>+{income.task}</b>
        </li>
      )}
      {income.artifacts.map((a) => (
        <li key={a.key}>
          <span>{ARTIFACTS[a.key].name}</span>
          <b>+{a.amount}</b>
        </li>
      ))}
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
      <h2 className="sub">
        升级<span>可以买多次；同一项每升一级涨价 {config.upgradePriceStep}</span>
      </h2>
      <div className="choices grid">
        {UPGRADE_KEYS.map((k) => {
          const price = upgradePrice(run, k, config);
          return (
            <UpgradeCard key={k} upgrade={k} level={run.levels[k]} add={1} price={price} disabled={run.gold < price} onPick={() => apply(buyUpgrade(run, k, config))} />
          );
        })}
      </div>
      <h2 className="sub">
        神器
        <span>
          神器栏 {run.artifacts.length}/{config.artifactSlots} · 在神器栏里可以半价卖出
        </span>
      </h2>
      {run.shopArtifacts.length > 0 ? (
        <div className="choices grid">
          {run.shopArtifacts.map((k, i) => {
            const price = artifactPrice(k, config);
            return (
              <button key={k} className="choice" disabled={run.gold < price || run.artifacts.length >= config.artifactSlots} onClick={() => apply(buyArtifact(run, i, config))}>
                <Rarity artifact={k} />
                <b>{ARTIFACTS[k].name}</b>
                <span className="desc">{ARTIFACTS[k].text}</span>
                <span className="price">
                  <i />
                  {price}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="hint">神器已经买空了。</p>
      )}
      <h2 className="sub">
        道具
        <span>
          背包 {run.items.length}/{config.itemSlots}
          {run.items.length > 0 && `：${run.items.map((k) => ITEMS[k].name).join('、')}`}
        </span>
      </h2>
      {run.shopItems.length > 0 ? (
        <div className="choices grid">
          {run.shopItems.map((k, i) => (
            <button key={`${k}-${i}`} className="choice" disabled={run.gold < ITEMS[k].price || run.items.length >= config.itemSlots} onClick={() => apply(buyItem(run, i, config))}>
              <ItemIcon item={k} size={34} />
              <b>{ITEMS[k].name}</b>
              <span className="desc">{ITEMS[k].text}</span>
              <span className="price">
                <i />
                {ITEMS[k].price}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="hint">道具已经买空了。</p>
      )}
      <button className="rest" disabled={!hurt || run.gold < config.healPrice} onClick={() => apply(buyHeal(run, config))}>
        <b>回血</b>
        <span>
          生命 +{config.healAmount} · {config.healPrice} 金币
        </span>
      </button>
      <button className="primary big" onClick={() => apply(leaveShop(run))}>
        {!run.endless && run.battleIndex >= run.route.length ? '结束' : '下一关'}
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

function Rarity({ artifact }: { artifact: ArtifactKey }) {
  const r = ARTIFACTS[artifact].rarity;
  return <span className={`badge ${r}`}>{RARITY_NAME[r]}</span>;
}

function ArtifactChoices({ keys, onPick, full }: { keys: ArtifactKey[]; onPick: (k: ArtifactKey) => void; full?: boolean }) {
  return (
    <div className="choices">
      {keys.map((k) => {
        const a = ARTIFACTS[k];
        return (
          <button key={k} className="choice" onClick={() => onPick(k)} disabled={full}>
            <Rarity artifact={k} />
            <b>{a.name}</b>
            <span className="desc">{a.text}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 底栏的神器条（窄屏用）：只列名字，点一下打开侧边抽屉看详情、卖出 */
function Artifacts({
  keys,
  counters,
  pings,
  gold,
  onOpen,
}: {
  keys: ArtifactKey[];
  counters: Partial<Record<ArtifactKey, number>> | undefined;
  pings: Partial<Record<ArtifactKey, { label: string; n: number }>>;
  gold: number;
  onOpen: () => void;
}) {
  return (
    <button className="artifacts" onClick={onOpen} aria-label={`查看神器（${keys.length}/${config.artifactSlots}）`}>
      {keys.map((k) => {
        const a = ARTIFACTS[k];
        const p = pings[k];
        return (
          <span key={`${k}-${p?.n ?? 0}`} className={`chip${p ? ' kick' : ''}`}>
            {p && (
              <span className="tag" aria-hidden="true">
                {p.label}
              </span>
            )}
            <i className={`dot ${a.rarity}`} />
            {a.name}
            <Progress artifact={k} n={counters?.[k] ?? 0} gold={gold} count={keys.length} />
          </span>
        );
      })}
      <span className="slots">
        神器 {keys.length}/{config.artifactSlots} ▸
      </span>
    </button>
  );
}

/** 神器在侧边栏里的当前状态：进度、已累计的加成、下一步是否生效 */
function artifactStatus(k: ArtifactKey, n: number, gold: number, count: number, ap: number | null): string | null {
  const P = ARTIFACT_PARAMS;
  switch (k) {
    case 'fuseBox':
    case 'aftershockCore':
      return `进度 ${n}/${ARTIFACTS[k].every}`;
    case 'loyaltyCard':
      return ap == null ? null : `本关第 ${n} 步 · 再走 ${P.loyaltyEvery - n} 步触发`;
    case 'lastCall':
      return ap == null ? null : ap === 1 ? '下一步生效' : `本回合还剩 ${ap} 步`;
    case 'ruler':
      return `进度 ${n % P.rulerEvery}/${P.rulerEvery} · 已加基数 +${Math.floor(n / P.rulerEvery)}`;
    case 'marathon':
      return n > 0 ? `已连续 ${n} 步 · 下一步不爆炸则 +${((n + 1) * P.marathonTenths) / 10}` : `下一步不爆炸则 +${P.marathonTenths / 10}`;
    case 'iceCream':
      return `当前基数 +${Math.max(0, P.iceCreamBase - n)}，还能撑 ${Math.ceil(Math.max(0, P.iceCreamBase - n) / P.iceCreamMelt)} 关`;
    case 'medal':
      return `已得 ${n} 枚 · 倍率 +${(n * P.medalTenths) / 10}`;
    case 'tycoon':
      return `当前基数 +${Math.floor(gold / P.tycoonPer)}`;
    case 'collector':
      return `当前倍率 +${(count * P.collectorTenths) / 10}`;
    case 'vacancy':
      return `当前倍率 +${(Math.max(0, config.artifactSlots - count) * P.vacancyTenths) / 10}`;
    case 'piggyBank':
      return `关末利息 +${Math.min(P.piggyMax, Math.floor(gold / P.piggyPer))}`;
    default:
      return null;
  }
}

/** 神器侧边栏：宽屏常驻在棋盘右侧，窄屏为抽屉。每件写明稀有度、效果、当前状态；商店和领奖时可以卖出 */
function ArtifactPanel({
  keys,
  counters,
  gold,
  ap,
  pings,
  open,
  onClose,
  onSell,
}: {
  keys: ArtifactKey[];
  counters: Partial<Record<ArtifactKey, number>> | undefined;
  gold: number;
  ap: number | null;
  pings: Partial<Record<ArtifactKey, { label: string; n: number }>>;
  open: boolean;
  onClose: () => void;
  onSell: ((k: ArtifactKey) => void) | undefined;
}) {
  const [selling, setSelling] = useState<ArtifactKey | null>(null);
  return (
    <>
      {open && <div className="backdrop" onClick={onClose} />}
      <aside className={`side${open ? ' open' : ''}`} aria-label="神器">
        <header>
          <h2>
            神器 <span>{keys.length}/{config.artifactSlots}</span>
          </h2>
          <button className="link close" onClick={onClose}>
            关闭
          </button>
        </header>
        {onSell && keys.length > 0 && <p className="hint">点“卖出”得半价金币。</p>}
        <ol>
          {keys.map((k) => {
            const a = ARTIFACTS[k];
            const p = pings[k];
            const status = artifactStatus(k, counters?.[k] ?? 0, gold, keys.length, ap);
            return (
              <li key={`${k}-${p?.n ?? 0}`} className={`card ${a.rarity}${p ? ' kick' : ''}`}>
                {p && (
                  <span className="tag" aria-hidden="true">
                    {p.label}
                  </span>
                )}
                <div className="head">
                  <b>{a.name}</b>
                  <Rarity artifact={k} />
                </div>
                <p className="text">{a.text}</p>
                {status && <p className="status">{status}</p>}
                {onSell &&
                  (selling === k ? (
                    <button className="sell" onClick={() => (onSell(k), setSelling(null))} onBlur={() => setSelling(null)} autoFocus>
                      确认卖出 +{artifactSellPrice(k, config)}
                    </button>
                  ) : (
                    <button className="ghost small" onClick={() => setSelling(k)}>
                      卖出 +{artifactSellPrice(k, config)}
                    </button>
                  ))}
              </li>
            );
          })}
          {Array.from({ length: Math.max(0, config.artifactSlots - keys.length) }, (_, i) => (
            <li key={`empty-${i}`} className="card empty">
              空栏
            </li>
          ))}
        </ol>
      </aside>
    </>
  );
}

/** 神器栏里的进度：累加类显示“进度/门槛”，尺规另显示已得的基数，长跑显示连续步数 */
function Progress({ artifact, n, gold, count }: { artifact: ArtifactKey; n: number; gold: number; count: number }) {
  const every = ARTIFACTS[artifact].every;
  const P = ARTIFACT_PARAMS;
  const extra: Partial<Record<ArtifactKey, string>> = {
    iceCream: `基数 +${Math.max(0, P.iceCreamBase - n)}`,
    medal: n > 0 ? `+${(n * P.medalTenths) / 10}` : '',
    tycoon: `基数 +${Math.floor(gold / P.tycoonPer)}`,
    collector: `+${(count * P.collectorTenths) / 10}`,
    vacancy: `+${(Math.max(0, config.artifactSlots - count) * P.vacancyTenths) / 10}`,
  };
  if (artifact in extra) return extra[artifact] ? <span className="count">{extra[artifact]}</span> : null;
  if (artifact === 'ruler') {
    const bonus = Math.floor(n / ARTIFACT_PARAMS.rulerEvery);
    return (
      <span className="count">
        {n % ARTIFACT_PARAMS.rulerEvery}/{ARTIFACT_PARAMS.rulerEvery}
        {bonus > 0 && ` · 基数 +${bonus}`}
      </span>
    );
  }
  if (artifact === 'marathon') return n > 0 ? <span className="count">连 {n}</span> : null;
  if (!every) return null;
  return (
    <span className="count">
      {n}/{every}
    </span>
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

