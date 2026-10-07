// 冲分模式的整局界面：开局神器 → 关卡（棋盘）→ 结算金币 →（首领后）神器 → 商店 → 下一关。
// 规则全部由引擎给出；这里只负责展示、发出动作和安排动画的先后。
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
  bombBlockBonus,
  buyHeal,
  ITEMS,
  ITEM_PARAMS,
  type ItemKey,
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
  rerollPrice,
  rerollShop,
  findHint,
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
import { useFitMode } from './fit';
import { markTip, nextTip, resetGuide, seenTips, skipGuide, tipSeen, TIPS, type TipKey } from './guide';
import { BombIcon, GearIcon, ItemIcon, UpgradeIcon } from './icons';
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
const ITEM_FAIL: Record<string, string> = {
  notNormal: '只能染普通方块',
  stone: '石块不能交换',
  sameColor: '同色的格子不用换',
  noAp: '这回合没有步了',
  notAdjacent: '要选相邻的两格',
  magnifyArmed: '放大镜已经挂上了',
  noLastScore: '还没有上一步的分数',
};

const COLOR_NAME: Record<Color, string> = { attack: '红圆', shield: '蓝方', poison: '黄三角', catalyst: '绿菱形' };
const fmt = (n: number) => n.toLocaleString('zh-CN');
const LOST_TEXT: Partial<Record<ArtifactKey, string>> = { banana: '香蕉烂掉了', iceCream: '冰淇淋化完了', standIn: '替身挡下了致命的扣血，然后消失了' };
const RANGE_TAG: Partial<Record<ArtifactKey, string>> = { thunderFuse: '闪电', crossFuse: '十字', bigBore: '5×5' };
/** 弱引导：停手多久后提示一步 */
const HINT_DELAY = 5000;
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
  const [help, setHelp] = useState(false);
  // 说明页里点“重新看引导”时加一，关卡据此重新开始提示
  const [guideEpoch, setGuideEpoch] = useState(0);
  // 宽屏时关卡里的道具栏挂到右栏顶部这个节点上（createPortal），点道具的逻辑仍留在关卡组件里
  const [dock, setDock] = useState<HTMLElement | null>(null);
  const sellable = run.phase === 'shop' || run.phase === 'artifact';
  const counters = { ...(run.battle?.player.counters ?? run.player.counters), loyaltyCard: (run.battle?.stepsTaken ?? 0) % ARTIFACT_PARAMS.loyaltyEvery };

  return (
    <div className="shell">
      <header className="top">
        <div className="stage-tag">
          <span>{run.endless ? 'ENDLESS' : 'STAGE'}</span>
          <b>{String(shownLevel).padStart(2, '0')}</b>
          {!run.endless && <span>/ {String(run.route.length).padStart(2, '0')}</span>}
          {boss && <i>首领关</i>}
        </div>
        <div className="vitals">
          <Hp hp={run.player.hp} max={run.player.maxHp} />
          <span className="purse" title="金币" aria-label={`金币 ${run.gold}`}>
            <b>
              <i aria-hidden="true" />
              {run.gold}
            </b>
          </span>
          <button className="help-btn" aria-label="玩法说明" title="玩法说明" onClick={() => setHelp(true)}>
            ?
          </button>
          <Menu restart={restart} />
        </div>
      </header>

      <div className="cols">
        {showBattle ? (
          <Battle key={run.battleIndex} run={run} setRun={setRun} ending={ending} setEnding={setEnding} ping={ping} dock={dock} guideEpoch={guideEpoch} />
        ) : (
          <div className="between">
            <RunPanel run={run} />
            <Between run={run} apply={apply} restart={restart} />
          </div>
        )}
        <ArtifactPanel
          keys={run.artifacts}
          counters={counters}
          gold={run.battle?.gold ?? run.gold}
          ap={run.phase === 'battle' ? (run.battle?.ap ?? null) : null}
          pings={pings}
          open={drawer}
          onClose={() => setDrawer(false)}
          onSell={sellable ? (k) => apply(sellArtifact(run, k, config)) : undefined}
          itemDock={showBattle ? <div className="dock-slot" ref={setDock} /> : <ItemBag items={run.items} />}
        />
      </div>

      {help && (
        <Help
          onClose={() => setHelp(false)}
          onReplay={() => {
            resetGuide();
            setGuideEpoch((n) => n + 1);
            setHelp(false);
          }}
        />
      )}

      <footer className="bottom">
        <Artifacts keys={run.artifacts} gold={run.battle?.gold ?? run.gold} counters={counters} pings={pings} onOpen={() => setDrawer(true)} />
      </footer>
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
  dock,
  guideEpoch,
}: {
  run: RunState;
  setRun: (r: RunState) => void;
  ending: Ending | null;
  setEnding: (e: Ending | null) => void;
  ping: (key: ArtifactKey, label: string) => void;
  dock: HTMLElement | null;
  guideEpoch: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<BoardView | null>(null);
  const runRef = useRef(run);
  runRef.current = run;
  const busyRef = useRef(false);
  // 这一步的计算：基数 × 倍率。基数在出手时就定了（主动清除），倍率随连锁和神器逐步上涨
  const [mult, setMult] = useState({ base: 0, value: 1, chain: 0, final: false });
  const multRef = useRef(1);
  // 这一步的基数构成：主动部分出手即定；连锁部分随连锁进度按比例涨上去，结算时对齐精确值
  const stepBase = useRef({ active: 0, chain: 0, passive: 0 });
  const battle = run.battle!;

  const setBusy = (v: boolean) => {
    busyRef.current = v;
    if (viewRef.current) viewRef.current.busy = v;
  };

  const pickingRef = useRef<number | null>(null);
  // 弱引导：停手 HINT_DELAY 毫秒后提示一步（优先能做炸弹的交换，其次三消）；有任何操作就重新计时
  const hintTimer = useRef(0);
  const armHint = useCallback(() => {
    window.clearTimeout(hintTimer.current);
    viewRef.current?.clearHint();
    hintTimer.current = window.setTimeout(() => {
      const b = runRef.current.battle;
      const view = viewRef.current;
      if (!b || !view || busyRef.current || pickingRef.current != null || b.outcome !== 'ongoing') return;
      const h = findHint(b.board);
      if (h) view.showHint(h.from, h.to);
    }, HINT_DELAY);
  }, []);
  useEffect(() => () => window.clearTimeout(hintTimer.current), []);

  /** 播放一步（交换、点燃或道具）的结果：动画、计分弹字、过关判定与回合交接 */
  const finish = useCallback(async (next: RunState, log: ActionLog | null, events: ResolutionEvent[], at: Pos, pulseAt: Pos[] = []) => {
    const view = viewRef.current!;
    multRef.current = 1;
    const s = log?.settlement;
    stepBase.current = { active: (s?.rawBase ?? 0) - (s?.chainBase ?? 0), chain: s?.chainBase ?? 0, passive: log?.result.passiveClearCount ?? 0 };
    setMult({ base: stepBase.current.active, value: 1, chain: 0, final: false });
    const b = next.battle!;
    if (events.length) await view.play(events, b.board);
    else view.sync(b.board);
    if (pulseAt.length) view.pulse(pulseAt);
    // 改变爆炸范围的神器（雷鸣引线、十字引线、大口径）：这一步用到了就抖一下
    const shaped = new Set<ArtifactKey>();
    for (const e of events) if (e.type === 'wave') for (const x of e.explosions) if (x.byArtifact) shaped.add(x.byArtifact);
    for (const k of shaped) ping(k, RANGE_TAG[k] ?? '');
    // 神器逐件结算：倍率从连锁的值开始，每件神器抖一下、倍率跳一档，最后才出分
    if (s && log?.tally) {
      setMult((m) => ({ ...m, value: log.tally!.start }));
      await wait(160);
      for (const [i, t] of log.tally.steps.entries()) {
        // 放大镜是道具，不在神器栏里，只靠倍率数字跳动来表现
        if (t.key in ARTIFACTS) ping(t.key as ArtifactKey, t.label);
        sfx.tally(i);
        // 基数类神器（独行、冰淇淋等）生效时基数跟着跳
        setMult((m) => ({ ...m, value: t.value, base: (s.rawBase + t.baseBonus) * t.baseFactor }));
        await wait(240);
      }
    }
    if (s && s.settlementScore > 0) {
      sfx.score(s.settlementScore);
      view.popText(`+${fmt(s.settlementScore)}`, s.multiplier > 1 ? `×${s.multiplier.toFixed(1)}` : '', at, s.settlementScore >= 200);
      setMult((m) => ({ ...m, base: s.base, value: s.multiplier, final: true }));
    } else if (s) {
      // 基数为 0（“色封”下只消了被封的颜色）：倍率再高也是 0 分，照样弹出说明，不让结算看起来卡住
      view.popText('+0', b.rule?.key === 'sealed' ? '色封不计分' : '基数为 0', at);
      setMult((m) => ({ ...m, base: s.base, value: s.multiplier, final: true }));
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

  // ---- 新手引导：第一次玩时随情境弹一句提示，每句只出一次 ----
  const [tip, setTipState] = useState<TipKey | null>(() => (tipSeen('swap') ? null : 'swap'));
  const tipRef = useRef(tip);
  const setTip = useCallback((k: TipKey | null) => {
    tipRef.current = k;
    setTipState(k);
  }, []);
  const closeTip = () => {
    if (tipRef.current) markTip(tipRef.current);
    setTip(null);
  };
  const skipTips = () => {
    skipGuide();
    setTip(null);
  };
  /** 交换提示：立刻示范一步（平时要停手 5 秒才提示） */
  const demoSwap = useCallback(() => {
    const b = runRef.current.battle;
    const h = b && findHint(b.board);
    if (h) viewRef.current?.showHint(h.from, h.to);
  }, []);
  /** 一步走完：正在显示的提示算看过，再按情境挑下一句（这一步得了分讲计分，棋盘上有炸弹讲炸弹，最后讲过关） */
  const advanceGuide = useCallback(
    (scored: boolean) => {
      if (tipRef.current) markTip(tipRef.current);
      const b = runRef.current.battle;
      const hasBomb = !!b?.board.some((row) => row.some((t) => t?.kind === 'bomb'));
      setTip(nextTip(seenTips(), { scored, hasBomb, ongoing: b?.outcome === 'ongoing' }));
    },
    [setTip],
  );
  // 说明页里“重新看引导”
  const firstEpoch = useRef(guideEpoch);
  useEffect(() => {
    if (guideEpoch === firstEpoch.current) return;
    setTip('swap');
    demoSwap();
  }, [guideEpoch, setTip, demoSwap]);

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
    if (out.drop) showDrop(out.drop, at);
    setBusy(false);
    armHint();
    advanceGuide((out.log.settlement?.settlementScore ?? 0) > 0);
  }, [finish, armHint, advanceGuide]);

  // ---- 道具 ----
  const [picking, setPicking] = useState<number | null>(null);
  const [hint, setHint] = useState('');

  const choose = (slot: number | null) => {
    pickingRef.current = slot;
    if (slot == null) armHint();
    else viewRef.current?.clearHint();
    setPicking(slot);
    const key = slot == null ? null : runRef.current.items[slot];
    const target = key ? ITEMS[key].target : null;
    viewRef.current?.setPick(target === 'pair' || target === 'any' ? target : null);
    setHint(key === 'dropper' ? '先点取色的一格，再点相邻要染的一格' : key === 'glove' ? '先点一格，再点任意另一格互换（炸弹也行）' : '');
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
    setBusy(true);
    const at: Pos = 'to' in use ? use.to : { r: 4, c: 4 };
    // 回声直接加分：弹出得分；放大镜只是挂上，倍率旁会出现标记
    if (out.gained) {
      sfx.score(out.gained);
      view.popText(`+${fmt(out.gained)}`, '回声', at, out.gained >= 200);
    }
    if (use.key === 'magnifier') sfx.multUp(1);
    await finish(out.run, out.log ?? null, out.events ?? [], at);
    if (out.drop) showDrop(out.drop, at);
    setBusy(false);
    armHint();
    advanceGuide((out.log?.settlement?.settlementScore ?? 0) > 0 || !!out.gained);
  }, [finish, armHint, advanceGuide]);

  /** 掉落道具：棋盘上弹字，道具栏提示 */
  function showDrop(key: ItemKey, at: Pos) {
    sfx.bombMade();
    viewRef.current?.popText(`+${ITEMS[key].name}`, '获得道具', { r: Math.max(0, at.r - 1), c: at.c });
    setHint(`获得道具：${ITEMS[key].name}`);
  }

  const pickItem = (slot: number) => {
    if (busyRef.current) return;
    if (pickingRef.current === slot) return choose(null);
    const key = runRef.current.items[slot]!;
    if (key === 'shuffle' || key === 'magnifier' || key === 'echo') return void applyItem(slot, { key });
    choose(slot);
  };


  useEffect(() => {
    const view = new BoardView(canvasRef.current!, {
      onSwap: (from, to) => void doAction({ type: 'swap', from, to }),
      onIgnite: (at) => void doAction({ type: 'ignite', at }),
      onPickPair: (from, to) => {
        const slot = pickingRef.current;
        const key = slot == null ? null : runRef.current.items[slot];
        if (slot != null && (key === 'glove' || key === 'dropper')) void applyItem(slot, { key, from, to });
      },
      onActivity: () => armHint(),
      onChain: (passive, chain) => {
        const value = chainMultiplier(passive, ruleConfig(runRef.current.battle ?? {}, config));
        // 倍率跨过整数档时响一声
        if (Math.floor(value) > Math.floor(multRef.current)) sfx.multUp(Math.floor(value) - 1);
        multRef.current = value;
        const sb = stepBase.current;
        const base = sb.active + (sb.passive ? Math.round((sb.chain * Math.min(1, passive / sb.passive)) * 10) / 10 : 0);
        setMult((m) => ({ ...m, base, value, chain, final: false }));
      },
    });
    viewRef.current = view;
    view.sync(runRef.current.battle!.board, true);
    canvasRef.current!.focus({ preventScroll: true });
    armHint();
    if (tipRef.current === 'swap') demoSwap();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [doAction, applyItem, armHint, demoSwap]);

  const target = battle.goal?.target ?? 0;
  const score = useRolling(battle.totalScore);
  const wide = useFitMode() === 'wide';
  const bag = <ItemBag items={run.items} picking={picking} onPick={pickItem} hint={hint} />;
  const progress = target ? Math.min(1, score / target) : 0;

  return (
    <main className="battle">
      {/* 本关面板：宽屏在棋盘左侧单独一列，窄屏压缩成棋盘上方的几行 */}
      <section className={`hud${tip === 'score' || tip === 'goal' ? ' with-coach' : ''}`} aria-label="本关">
        <div className="score" aria-live="polite">
          <span className="cap">本关得分 / SCORE</span>
          <b>{fmt(score)}</b>
          <span className="goal">
            目标 <b>{fmt(target)}</b> 分
          </span>
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={battle.totalScore}>
            <span style={{ transform: `scaleX(${progress})` }} />
          </div>
          <div className="bar-cap">
            <span>{Math.floor(progress * 100)}% 达成</span>
            <span>{score >= target ? '已达标' : `还差 ${fmt(target - score)}`}</span>
          </div>
        </div>
        <Calc {...mult} armed={!!battle.magnify} last={battle.lastScore ?? 0} />
        {(tip === 'score' || tip === 'goal') && <Coach tip={tip} onClose={closeTip} onSkip={skipTips} />}
        <Steps battle={battle} />
        <Upgrades levels={run.levels} heat={battle.bombHeat} />
        {(battle.rule || battle.task) && (
          <div className="notes">
            {battle.rule && <RuleBadge rule={battle.rule.key} color={battle.rule.color} />}
            {battle.task && <TaskLine task={battle.task} boss={levelInfo(run, run.battleIndex, config).boss} />}
          </div>
        )}
      </section>
      <div className="play">
        <div className="board-cap">
          <span>连成三个，让连锁发生。</span>
        </div>
        <div className="stage">
          <canvas ref={canvasRef} tabIndex={0} aria-label="棋盘：拖动或点选相邻方块交换，点两下炸弹引爆" />
          {ending && <EndingCard ending={ending} onNext={() => setEnding(null)} />}
          {!ending && (tip === 'swap' || tip === 'bomb') && <Coach tip={tip} onClose={closeTip} onSkip={skipTips} onBoard />}
        </div>
        {!(wide && dock) && bag}
      </div>
      {wide && dock && createPortal(bag, dock)}
    </main>
  );
}

/** 引导提示：黑底白字一句话，箭头指向要看的地方；“知道了”关掉这一句，“跳过引导”全部不再出现 */
function Coach({ tip, onClose, onSkip, onBoard }: { tip: TipKey; onClose: () => void; onSkip: () => void; onBoard?: boolean }) {
  return (
    <div className={`coach${onBoard ? ' on-board' : ''}`} role="status" key={tip}>
      <p>{TIPS[tip]}</p>
      <div className="coach-act">
        <button className="link" onClick={onSkip}>
          跳过引导
        </button>
        <button className="coach-ok" onClick={onClose}>
          知道了
        </button>
      </div>
    </div>
  );
}

/** 常驻说明：顶栏“?”打开，六个分页签（目标、消除、计分、炸弹、关卡之间、道具）讲清一局怎么玩；底部可以重新看引导 */
function Help({ onClose, onReplay }: { onClose: () => void; onReplay: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const steps = config.scoreTurns * config.apPerTurn;
  const sections: [string, ReactNode][] = [
    [
      '目标',
      <>
        <p>
          一共 {config.scoreTargets.length} 关，打完还可以挑战无尽模式。每关有 {steps} 步（{config.scoreTurns} 回合 × {config.apPerTurn} 步），分数凑够目标就立即过关，剩下的每一步换 {config.goldPerStep} 金币。步数用完还没凑够，按差距扣生命；生命（{config.playerMaxHp}）扣完，这一局结束。
        </p>
      </>,
    ],
    [
      '消除',
      <>
        <p>拖动或先后点选，交换相邻两块；同色连成 3 个就消除，只有能消除的交换才算数。消除后上面的方块落下来，又连上就继续消除，这叫连锁。</p>
      </>,
    ],
    [
      '计分',
      <>
        <p className="help-calc">
          <span className="cell base">基数</span>×<span className="cell rate">倍率</span>
        </p>
        <p>每一步得分 = 基数 × 倍率。清掉的每一块都计基数（方块基数几级就算几）；消除后掉下来又连上的越多，倍率越高。印记会再加基数或倍率。</p>
      </>,
    ],
    [
      '炸弹',
      <>
        <ul className="help-bombs">
          <li>
            <BombIcon bomb="H" size={22} />
            <span>连成 4 个：清一整行或一整列</span>
          </li>
          <li>
            <BombIcon bomb="A" size={22} />
            <span>T 形或 L 形：清周围 3×3</span>
          </li>
          <li>
            <BombIcon bomb="CB" size={22} />
            <span>连成 5 个：清掉棋盘上某一种颜色</span>
          </li>
        </ul>
        <p>点两下炸弹原地引爆，或和旁边一块交换引爆；两枚炸弹交换会合体，范围更大。</p>
      </>,
    ],
    [
      '关卡之间',
      <>
        <p>
          过关得金币，在商店买升级（方块基数、三类炸弹的等级）和印记；印记最多带 {config.artifactSlots} 枚，可以半价卖出。第 3、6、9 关是首领关，各有一条特殊规则，开打前会写明。每关开打前可以选一个任务，完成有奖励。
        </p>
      </>,
    ],
    [
      '道具',
      <>
        <p>
          关内做出五连炸弹或一步连锁 {ITEM_PARAMS.dropChain} 层以上时掉落，最多带 {config.itemSlots} 件，跨关保留，用了不扣步。点道具再按提示点棋盘。
        </p>
      </>,
    ],
  ];
  const [tab, setTab] = useState(0);
  return (
    <>
      <div className="help-backdrop" onClick={onClose} />
      <div className="help" role="dialog" aria-label="玩法说明">
        <header>
          <h2>怎么玩</h2>
          <button className="link" onClick={onClose}>
            关闭
          </button>
        </header>
        {/* 分页签：一次只看一节，内容永远放得下，不用滚动 */}
        <nav className="help-tabs" role="tablist">
          {sections.map(([title], i) => (
            <button key={title} role="tab" aria-selected={tab === i} onClick={() => setTab(i)}>
              <span>{String(i + 1).padStart(2, '0')}</span>
              {title}
            </button>
          ))}
        </nav>
        <section role="tabpanel">
          <h3>{sections[tab]![0]}</h3>
          {sections[tab]![1]}
        </section>
        <footer>
          <button className="ghost small" onClick={onReplay}>
            重新看新手引导
          </button>
        </footer>
      </div>
    </>
  );
}


/** 道具的一句话简介（卡片上用；完整说明在悬停提示和说明页） */
const ITEM_SHORT: Record<ItemKey, string> = {
  glove: '任意两格互换',
  dropper: '取色染相邻一格',
  shuffle: '整盘重新排列',
  magnifier: '下一步倍率 ×2',
  echo: '再得上一步的分',
};

/** 道具：两列卡片（图标、名字、一句话），关内可点（选中反白），关卡之间只读；空位是虚线框 */
function ItemBag({ items, picking, onPick, hint }: { items: ItemKey[]; picking?: number | null; onPick?: (slot: number) => void; hint?: string }) {
  return (
    <section className="bag" aria-label="道具">
      <div className="phead">
        <h3>随身道具 / ITEMS</h3>
        <span>
          {items.length} / {config.itemSlots}
        </span>
      </div>
      <ul>
        {Array.from({ length: config.itemSlots }, (_, i) => {
          const k = items[i];
          return k ? (
            <li key={i}>
              <button className="item" aria-pressed={picking === i} disabled={!onPick} onClick={() => onPick?.(i)} title={ITEMS[k].text}>
                <ItemIcon item={k} size={28} />
                <b>{ITEMS[k].name}</b>
                <small>{ITEM_SHORT[k]}</small>
              </button>
            </li>
          ) : (
            <li key={i} className="empty" aria-hidden="true" />
          );
        })}
      </ul>
      {(hint || !items.length) && <p className="hint">{hint || `五连炸弹或 ${ITEM_PARAMS.dropChain} 层连锁会掉落道具`}</p>}
    </section>
  );
}

/** 升级等级与实际数值；关内的炸弹按本关当前等级显示，并带引爆进度条（够数再升一级） */
function Upgrades({ levels, heat }: { levels: Record<UpgradeKey, number>; heat?: BattleState['bombHeat'] | undefined }) {
  return (
    <div className="upgrades">
      <span className="cap">升级 / UPGRADES</span>
      <ul className="levels">
        {UPGRADE_KEYS.map((k) => {
          const h = k !== 'block' && heat ? heat[k] : null;
          const lv = h ? h.level : levels[k];
          const up = lv > levels[k];
          return (
            <li key={k} title={upgradeEffectText(k, levels[k], config)}>
              <UpgradeIcon upgrade={k} size={20} />
              <span className="what">
                {upgradeName(k)}
                {lv > 1 && <small>{levelEffect(k, lv)}</small>}
              </span>
              <b className={up ? 'up' : ''}>
                Lv.{lv}
                {up && ' ↑'}
              </b>
              {h && k !== 'block' && (
                <span className="meter" title={`本关再引爆 ${config.bombHeatEvery[k] - h.count} 枚升一级`}>
                  <i style={{ transform: `scaleX(${h.count / config.bombHeatEvery[k]})` }} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
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

/** 这一步的计分：蓝底基数 × 红底倍率两大块（块内左上角小字标名），数值变化时弹一下；下方一行写上一步得分和连锁层数 */
function Calc({ base, value, chain, final, armed, last }: { base: number; value: number; chain: number; final: boolean; armed?: boolean; last: number }) {
  const b = Math.round(base * 10) / 10;
  return (
    <div className={`mult${final ? ' final' : ''}`}>
      <div className="calc" aria-label={`基数 ${b} 乘倍率 ${value.toFixed(1)}`}>
        <span className="cell base">
          <small>基数</small>
          <b key={b}>{fmt(b)}</b>
        </span>
        <span className="times" aria-hidden="true">
          ×
        </span>
        <span className="cell rate">
          <small>倍率</small>
          <b key={value.toFixed(1)}>{value.toFixed(1)}</b>
        </span>
      </div>
      <p className="note">
        <span>{last > 0 ? <>上一步 <b>+{fmt(last)}</b></> : '基数 × 倍率'}</span>
        <span>{chain > 0 ? `${chain} 层连锁` : armed ? '放大镜 ×2 待用' : ''}</span>
      </p>
    </div>
  );
}

function Steps({ battle }: { battle: BattleState }) {
  const turns = battle.goal?.turns ?? config.scoreTurns;
  const perTurn = turnAp(battle, config);
  const left = (turns - battle.turn) * perTurn + battle.ap;
  return (
    <div className="steps">
      <div className="steps-head">
        <span className="cap">剩余步数 / STEPS</span>
        <b className="left">
          {left}
          <small>/{turns * perTurn}</small>
        </b>
      </div>
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

/** 关卡之间的左栏：本局总分、九关路线（已过、下一关、首领）、下一关预告和升级等级。宽屏才显示，保持三栏不变 */
function RunPanel({ run }: { run: RunState }) {
  const done = run.phase === 'over' && run.outcome !== 'won' ? run.battleIndex - 1 : run.battleIndex;
  const nextLevel = run.battleIndex + 1;
  const next = levelInfo(run, nextLevel, config);
  const showNext = run.phase === 'shop' || run.phase === 'artifact';
  return (
    <aside className="runpanel" aria-label="本局">
      <div className="score">
        <span className="lab">本局总分 / TOTAL</span>
        <b>{fmt(run.totalScore)}</b>
      </div>
      <div className="route">
        <span className="lab">{run.endless ? `无尽 / ENDLESS · 已过 ${done} 关` : `路线 / ROUTE · 已过 ${done}/${run.route.length}`}</span>
        {!run.endless && (
          <ol>
            {run.route.map((_, i) => {
              const lv = i + 1;
              const cls = [lv <= done ? 'done' : '', lv === nextLevel && run.phase !== 'over' ? 'next' : '', levelInfo(run, lv, config).boss ? 'boss' : ''].join(' ');
              return <li key={i} className={cls} title={`第 ${lv} 关${levelInfo(run, lv, config).boss ? ' · 首领' : ''}`} />;
            })}
          </ol>
        )}
      </div>
      {showNext && (!run.endless ? nextLevel <= run.route.length : true) && (
        <div className="next">
          <span className="lab">下一关 / NEXT · 第 {nextLevel} 关{next.boss ? ' · 首领' : ''}</span>
          <b>目标 {fmt(next.target)}</b>
          {next.rule && <span className="rule-name">首领规则：{BOSS_RULES[next.rule].name}</span>}
        </div>
      )}
      <Upgrades levels={run.levels} />
    </aside>
  );
}

function Between({ run, apply, restart }: { run: RunState; apply: (r: RunResult) => void; restart: () => void }) {
  switch (run.phase) {
    case 'starter':
      return (
        <Panel eyebrow="开局" title="选一枚印记">
          <ArtifactChoices keys={run.starterChoices} onPick={(k) => apply(pickStarter(run, k))} />
        </Panel>
      );
    case 'map':
      return <MapPanel run={run} apply={apply} />;
    case 'artifact':
      return (
        <Panel eyebrow="首领奖励" title="选一枚印记">
          <ArtifactChoices keys={run.artifactChoices} full={run.artifacts.length >= config.artifactSlots} onPick={(k) => apply(chooseArtifact(run, k, config))} />
          {run.artifacts.length >= config.artifactSlots && <p className="hint">印记栏满了：在印记栏里卖掉一枚，或者跳过。</p>}
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
  return t.tier === 'easy' ? `奖励 ${boss ? config.taskGoldBoss : config.taskGold} 金币` : `奖励一枚随机印记（栏满改给 ${config.taskFullGold} 金币）`;
}

/** 关内的任务进度：左边一条蓝线，标题写奖励；单步类显示最好的一步，累计类显示总数；速通、轻装到达标时才判定 */
function TaskLine({ task, boss }: { task: TaskState; boss: boolean }) {
  const { def, progress, done, failed } = task;
  const shown = def.kind === 'mult' ? `×${Math.max(1, progress).toFixed(1)}` : fmt(Math.floor(progress));
  const goal = def.kind === 'mult' ? `×${def.goal}` : fmt(def.goal);
  const status = done ? '完成' : failed ? '失败' : def.kind === 'speed' || def.kind === 'noItem' ? '达标时判定' : `${shown} / ${goal}`;
  return (
    <div className={`taskline${done ? ' done' : ''}${failed ? ' failed' : ''}`} key={done ? 'done' : 'todo'}>
      <span className="cap">支线任务 · {taskRewardShort(def, boss)}</span>
      <p>
        <span>{taskText(def)}</span>
        <b className="prog">{status}</b>
      </p>
    </div>
  );
}

function taskRewardShort(t: TaskDef, boss: boolean): string {
  return t.tier === 'easy' ? `奖励 ${boss ? config.taskGoldBoss : config.taskGold} 金币` : '奖励一枚印记';
}

/** 首领规则：左边一条红线，标题“首领规则 / 名字”，下面一句说明；路线页用大号 */
function RuleBadge({ rule, color, big }: { rule: keyof typeof BOSS_RULES; color?: Color | undefined; big?: boolean }) {
  const r = BOSS_RULES[rule];
  return (
    <div className={`rule${big ? ' big' : ''}`}>
      <span className="cap">首领规则 / {r.name}</span>
      <p>
        {r.text}
        {color && `本关不计分的是${COLOR_NAME[color]}。`}
      </p>
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

/** 商店：升级 / 神器 / 补给三组，底部常驻金币和“下一关” */
function Shop({ run, apply }: { run: RunState; apply: (r: RunResult) => void }) {
  const hurt = run.player.hp < run.player.maxHp;
  const reroll = rerollPrice(run, config);
  const full = run.artifacts.length >= config.artifactSlots;
  return (
    <Panel eyebrow={`第 ${run.battleIndex} 关之后`} title="商店">
      <section className="shop-group">
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
      </section>
      <section className="shop-group">
        <h2 className="sub">
          印记
          <span>
            {run.artifacts.length}/{config.artifactSlots}
            {full ? ' · 栏满了，先在构筑栏卖掉一件' : ' · 在构筑栏里可以半价卖出'}
          </span>
          <button className="ghost small reroll" disabled={run.gold < reroll} onClick={() => apply(rerollShop(run, config))}>
            刷新 · {reroll}
          </button>
        </h2>
        {run.shopArtifacts.length > 0 ? (
          <div className="choices">
            {run.shopArtifacts.map((k, i) => {
              const price = artifactPrice(k, config);
              return (
                <button key={k} className="choice" disabled={run.gold < price || full} onClick={() => apply(buyArtifact(run, i, config))}>
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
          <p className="hint">印记已经买空了。</p>
        )}
      </section>
      <section className="shop-group">
        <h2 className="sub">补给</h2>
        <div className="supply">
          <button className="rest" disabled={!hurt || run.gold < config.healPrice} onClick={() => apply(buyHeal(run, config))}>
            <b>回血</b>
            <span>
              生命 +{config.healAmount} · {config.healPrice} 金币
            </span>
          </button>
          <p className="hint">
            道具 {run.items.length}/{config.itemSlots}
            {run.items.length > 0 && `：${run.items.map((k) => ITEMS[k].name).join('、')}`}。道具不在商店卖：关内做出五连炸弹或一步连锁 {ITEM_PARAMS.dropChain} 层以上时掉落（每关最多 {ITEM_PARAMS.dropsPerLevel} 件）。
          </p>
        </div>
      </section>
      <div className="dock">
        <span className="gold big">
          <i />
          {run.gold}
        </span>
        <button className="primary big" onClick={() => apply(leaveShop(run))}>
          {!run.endless && run.battleIndex >= run.route.length ? '结束' : '下一关'}
        </button>
      </div>
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
    <button className="artifacts" onClick={onOpen} aria-label={`查看道具、印记与升级（印记 ${keys.length}/${config.artifactSlots}）`}>
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
            <span className="nm">{a.name}</span>
            <Progress artifact={k} n={counters?.[k] ?? 0} gold={gold} count={keys.length} />
          </span>
        );
      })}
      <span className="slots">
        印记 {keys.length}/{config.artifactSlots} ▸
      </span>
    </button>
  );
}

/** 升级等级换算成的实际数值：方块基数是每块的基数；炸弹 n 级时炸掉的每块多计 n−1 基数，这一步引爆过该类炸弹时倍率再加 0.1×(n−1) */
function levelEffect(k: UpgradeKey, lv: number): string {
  if (k === 'block') return `每块 ${lv} 基数`;
  return `+${bombBlockBonus(lv)} 基数 · 倍率 +${(((lv - 1) * config.bombLevelMultTenths) / 10).toFixed(1)}`;
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
      return `进度 ${n % P.rulerEvery}/${P.rulerEvery}${n >= P.rulerEvery ? ` · 已加基数 +${Math.floor(n / P.rulerEvery) * P.rulerBase}` : ''}`;
    case 'marathon':
      return n > 0 ? `已连续 ${n} 步 · 下一步不爆炸则 +${((n + 1) * P.marathonTenths) / 10}` : `下一步不爆炸则 +${P.marathonTenths / 10}`;
    case 'iceCream':
      return `当前基数 +${Math.max(0, P.iceCreamBase - n)}，还能撑 ${Math.ceil(Math.max(0, P.iceCreamBase - n) / P.iceCreamMelt)} 关`;
    case 'medal':
      return n > 0 ? `已得 ${n} 枚 · 倍率 +${(n * P.medalTenths) / 10}` : null;
    case 'tycoon':
      return gold >= P.tycoonPer ? `当前基数 +${Math.floor(gold / P.tycoonPer) * P.tycoonBase}` : null;
    case 'collector':
      return `当前倍率 +${(count * P.collectorTenths) / 10}`;
    case 'vacancy':
      return count < config.artifactSlots ? `当前倍率 +${((config.artifactSlots - count) * P.vacancyTenths) / 10}` : null;
    case 'piggyBank':
      return gold >= P.piggyPer ? `关末利息 +${Math.min(P.piggyMax, Math.floor(gold / P.piggyPer))}` : null;
    default:
      return null;
  }
}

/** 右栏：宽屏常驻在棋盘右侧，窄屏为抽屉。上面是道具（带说明），下面是神器（每件写明稀有度、效果、当前状态，商店和领奖时可以卖出）；窄屏抽屉里另列升级等级 */
function ArtifactPanel({
  keys,
  counters,
  gold,
  ap,
  pings,
  open,
  onClose,
  onSell,
  itemDock,
}: {
  /** 道具区：关内是道具栏的挂载点（宽屏时关卡把可点的道具栏放进来），关卡之间是只读的道具列表 */
  itemDock: ReactNode;
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
      <aside className={`side${open ? ' open' : ''}`} aria-label="道具与印记">
        <header>
          <button className="link close" onClick={onClose}>
            关闭
          </button>
        </header>
        {itemDock}
        <div className="phead arts-head">
          <h3>印记 / MARKS</h3>
          <span>
            {keys.length} / {config.artifactSlots}
          </span>
        </div>
        {onSell && keys.length > 0 && <p className="hint">点“卖出”得半价金币。</p>}
        <ol className="arts">
          {keys.map((k, i) => {
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
                {/* 标题行：编号、名字、右边稀有度；商店和领奖时换成“卖出”按钮（省一行高度，右栏不用滚动） */}
                <div className="head">
                  <span className="idx">{String(i + 1).padStart(2, '0')}</span>
                  <b>{a.name}</b>
                  {onSell ? (
                    selling === k ? (
                      <button className="sell" onClick={() => (onSell(k), setSelling(null))} onBlur={() => setSelling(null)} autoFocus>
                        确认 +{artifactSellPrice(k, config)}
                      </button>
                    ) : (
                      <button className="ghost small" onClick={() => setSelling(k)}>
                        卖出 +{artifactSellPrice(k, config)}
                      </button>
                    )
                  ) : (
                    <small className={`rar ${a.rarity}`}>{RARITY_NAME[a.rarity]}</small>
                  )}
                </div>
                <p className="text" title={a.text}>
                  {a.text}
                </p>
                {status && <p className="status">{status}</p>}
              </li>
            );
          })}
          {Array.from({ length: Math.max(0, config.artifactSlots - keys.length) }, (_, i) => (
            <li key={`empty-${i}`} className="card empty" aria-hidden="true" />
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
    tycoon: gold >= P.tycoonPer ? `基数 +${Math.floor(gold / P.tycoonPer) * P.tycoonBase}` : '',
    collector: `+${(count * P.collectorTenths) / 10}`,
    vacancy: count < config.artifactSlots ? `+${((config.artifactSlots - count) * P.vacancyTenths) / 10}` : '',
  };
  if (artifact in extra) return extra[artifact] ? <span className="count">{extra[artifact]}</span> : null;
  if (artifact === 'ruler') {
    const bonus = Math.floor(n / ARTIFACT_PARAMS.rulerEvery) * ARTIFACT_PARAMS.rulerBase;
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
    <span className="hp">
      <small>生命</small>
      <b>
        {hp}
        <em>/{max}</em>
      </b>
      <span className="meter">
        <i style={{ transform: `scaleX(${hp / max})` }} />
      </span>
    </span>
  );
}

/** 右上角的设置入口：点 ⚙ 弹出小浮层，放音效、连锁音阶、最好成绩和重新开始；点外面或按 Esc 关掉 */
function Menu({ restart }: { restart: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setConfirming(false);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  const best = open ? loadBest() : null;
  return (
    <div className="menu" ref={wrapRef}>
      <button className="gear" aria-label="设置" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <GearIcon size={20} />
      </button>
      {open && (
        <div className="pop" role="dialog" aria-label="设置">
          <SoundPicker />
          <div className="pop-row">
            <span className="lab">最好成绩</span>
            <span>{best ? `通过 ${best.level} 关 · ${fmt(best.score)} 分` : '还没有'}</span>
          </div>
          <div className="pop-row restart">
            {confirming ? (
              <>
                <span>放弃这一局？</span>
                <button
                  className="danger"
                  onClick={() => {
                    close();
                    restart();
                  }}
                  autoFocus
                >
                  放弃并重开
                </button>
                <button className="link" onClick={() => setConfirming(false)}>
                  取消
                </button>
              </>
            ) : (
              <button className="ghost small" onClick={() => setConfirming(true)}>
                重新开始
              </button>
            )}
          </div>
        </div>
      )}
    </div>
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
    <>
      <div className="sound pop-row" role="group" aria-label="音效">
        <span className="lab">音效</span>
        {(Object.keys(KIT_NAMES) as SoundKit[]).map((k) => (
          <button key={k} aria-pressed={kit === k} onClick={() => pick(k)}>
            {KIT_NAMES[k]}
          </button>
        ))}
      </div>
      <div className="sound pop-row" role="group" aria-label="连锁音阶">
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
    </>
  );
}

