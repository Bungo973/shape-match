import { useCallback, useEffect, useRef, useState } from 'react';
import {
  campRest,
  campUpgrade,
  debugLevelUp,
  chooseArtifact,
  chooseInsert,
  DEFAULT_CONFIG,
  installInsert,
  newRun,
  pickStarter,
  poisonDecay,
  poisonThreshold,
  rerollInserts,
  runAction,
  runEndTurn,
  startNextBattle,
  UPGRADE_KEYS,
  UPGRADE_NAMES,
  type UpgradeKey,
  type Action,
  type ActionLog,
  type BattleState,
  type BombKind,
  type Intent,
  type Pos,
  type RunResult,
  type RunState,
} from '../engine';
import { ArtifactStrip, EnemyPanel, PlayerPanel, REASON_TEXT, SettlePanel } from './Hud';
import { isMuted, setMuted } from './audio';
import { rateMove } from './rating';
import { clearRun, loadRun, saveRun } from './save';
import { BoardEditor } from './screens/BoardEditor';
import { ArtifactScreen, CampScreen, MapScreen, ResultScreen, RewardScreen, StarterScreen } from './screens/Screens';
import { Stage, STAGE_H, STAGE_W } from './stage/Stage';

const newSeed = () => Math.floor(Math.random() * 1e9);
/** 网址带 ?seed=123 时从该种子开新局，便于复现 */
const urlSeed = () => Number(new URLSearchParams(window.location.search).get('seed')) || null;

function initialRun(): RunState {
  const seed = urlSeed();
  if (seed) return newRun(seed);
  return loadRun() ?? newRun(newSeed());
}

const LEVEL_LABEL: Record<UpgradeKey, string> = { attack: '攻', shield: '盾', poison: '毒', catalyst: '催', line: '直线', area: '3×3', color: '五连' };

export function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [scale, setScale] = useState(1);
  const [run, setRunState] = useState(initialRun);
  const runRef = useRef(run);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [lastLog, setLastLog] = useState<ActionLog | null>(null);
  const [toast, setToast] = useState('');
  const [speed, setSpeed] = useState(1);
  const [muted, setMutedState] = useState(isMuted);
  const [placeBomb, setPlaceBomb] = useState<BombKind | null>(null);
  const placeRef = useRef(placeBomb);
  placeRef.current = placeBomb;
  const [editing, setEditing] = useState(false);

  const setRun = (r: RunState) => {
    runRef.current = r;
    setRunState(r);
    saveRun(r);
  };

  const setBusyBoth = (v: boolean) => {
    busyRef.current = v;
    setBusy(v);
    if (stageRef.current) stageRef.current.busy = v;
  };

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? '' : t)), 1600);
  };

  /** 执行一个局流程操作；失败时提示原因并返回原因文本 */
  const apply = (r: RunResult): string | null => {
    if (!r.ok) {
      flash(REASON_TEXT[r.reason] ?? r.reason);
      return r.reason;
    }
    setRun(r.run);
    return null;
  };

  const showBattle = (b: BattleState) => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.setEnemy(b.enemy.def.id);
    stage.sync(b.board);
    stage.drawInserts(b.inserts, b.current.suppressedId);
  };

  // ---- 战斗 ----
  const doAction = useCallback(async (action: Action) => {
    if (busyRef.current) return;
    const out = runAction(runRef.current, action);
    if (!out.ok || !out.log) return void flash(out.ok ? '无效操作' : (REASON_TEXT[out.reason] ?? out.reason));
    const stage = stageRef.current!;
    setBusyBoth(true);
    await stage.play(out.log.result.events);
    if (out.run.battle) stage.sync(out.run.battle.board);
    setLastLog(out.log);
    const rating = rateMove(out.log);
    if (rating) stage.showRating(rating);
    await stage.playPlayerEffects(out.log);
    setRun(out.run);
    setBusyBoth(false);
  }, []);

  const doEndTurn = useCallback(async () => {
    const cur = runRef.current;
    if (busyRef.current || cur.phase !== 'battle' || cur.battle?.outcome !== 'ongoing') return;
    setBusyBoth(true);
    const out = runEndTurn(cur);
    if (out.ok) {
      if (out.log) await stageRef.current!.playEnemyTurn(out.log);
      setRun(out.run);
      if (out.run.battle) showBattle(out.run.battle);
    }
    setBusyBoth(false);
  }, []);

  // AP 用完自动结束回合
  const battle = run.phase === 'battle' ? run.battle : null;
  useEffect(() => {
    if (!busy && battle && battle.ap === 0 && battle.outcome === 'ongoing') {
      const t = window.setTimeout(() => void doEndTurn(), 350);
      return () => window.clearTimeout(t);
    }
  }, [busy, battle, doEndTurn]);

  // ---- 调试：放炸弹 ----
  const onPlace = useCallback((at: Pos) => {
    const kind = placeRef.current;
    const cur = runRef.current;
    if (!kind || !cur.battle) return;
    const r: RunState = JSON.parse(JSON.stringify(cur));
    const b = r.battle!;
    b.board[at.r]![at.c] = { id: b.nextId++, kind: 'bomb', bomb: kind };
    setRun(r);
    stageRef.current?.sync(b.board);
  }, []);

  // ---- 舞台创建与缩放 ----
  useEffect(() => {
    let disposed = false;
    const fit = () => Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    setScale(fit());
    void Stage.create(hostRef.current!, window.devicePixelRatio * fit(), {
      onSwap: (from, to) => void doAction({ type: 'swap', from, to }),
      onIgnite: (at) => void doAction({ type: 'ignite', at }),
      onPlace,
    }).then((stage) => {
      if (disposed) return stage.destroy();
      stageRef.current = stage;
      stage.setSpeed(speed);
      const b = runRef.current.battle;
      if (b) showBattle(b);
    });
    const onResize = () => {
      const s = fit();
      setScale(s);
      stageRef.current?.setResolution(window.devicePixelRatio * s);
    };
    const onKey = (e: KeyboardEvent) => {
      if (runRef.current.phase !== 'battle') return;
      if (stageRef.current?.handleKey(e.key)) e.preventDefault();
      if (e.key === 'e' || e.key === 'E') void doEndTurn();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      stageRef.current?.destroy();
      stageRef.current = null;
    };
  }, [doAction, doEndTurn, onPlace]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => stageRef.current?.setSpeed(speed), [speed]);
  useEffect(() => {
    if (stageRef.current) stageRef.current.placeMode = placeBomb !== null;
  }, [placeBomb]);

  // ---- 局流程 ----
  const startBattle = () => {
    const r = startNextBattle(runRef.current);
    if (apply(r) === null && r.run.battle) {
      setLastLog(null);
      stageRef.current?.resetBoard();
      showBattle(r.run.battle);
    }
  };

  const restart = () => {
    clearRun();
    setLastLog(null);
    setEditing(false);
    setRun(newRun(newSeed()));
  };

  // 原型：直接调整升级等级（左键 +1，右键 −1），正式接入奖励与营地前用来试手感
  const debugLevel = (key: UpgradeKey, delta: number) => setRun(debugLevelUp(runRef.current, key, delta));

  const debugWeaken = () => {
    const r: RunState = JSON.parse(JSON.stringify(runRef.current));
    if (!r.battle) return;
    r.battle.enemy.hp = 1;
    r.battle.enemy.shield = 0;
    setRun(r);
    flash('调试：敌人只剩 1 生命，任意消除即可获胜');
  };

  const b = run.battle;
  const st = lastLog?.settlement;
  const A = lastLog?.result.activeClearsByType;

  return (
    <div className="viewport">
      <div className="frame" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}>
        <div ref={hostRef} className="canvas-host" />

        {run.phase === 'battle' && b && (
          <>
            <PlayerPanel b={b} gold={run.gold} />
            <ArtifactStrip artifacts={run.artifacts} />
            <EnemyPanel b={b} battleIndex={run.battleIndex} />
            <SettlePanel b={b} lastLog={lastLog} hint="交换相邻方块或点燃炸弹。第一次下落前的清除给基数，之后的连锁提高倍率。" />
            <button className="end-turn" disabled={busy || b.outcome !== 'ongoing'} onClick={() => void doEndTurn()}>
              结束回合 <small>E</small>
            </button>
          </>
        )}

        {run.phase === 'starter' && <StarterScreen run={run} onPick={(k) => apply(pickStarter(run, k))} />}
        {run.phase === 'map' && <MapScreen run={run} onStart={startBattle} onEdit={() => setEditing(true)} />}
        {run.phase === 'reward' && <RewardScreen run={run} onPick={(i) => apply(chooseInsert(run, i))} onReroll={(keep) => apply(rerollInserts(run, keep))} />}
        {run.phase === 'artifact' && <ArtifactScreen run={run} onPick={(k) => apply(chooseArtifact(run, k))} />}
        {run.phase === 'camp' && (
          <CampScreen run={run} onRest={() => apply(campRest(run))} onUpgrade={(id, cells) => apply(campUpgrade(run, id, cells))} onEdit={() => setEditing(true)} />
        )}
        {run.phase === 'over' && <ResultScreen run={run} onRestart={restart} />}
        {editing && run.phase !== 'battle' && run.phase !== 'over' && (
          <BoardEditor run={run} onInstall={(id, cells) => apply(installInsert(runRef.current, id, cells))} onClose={() => setEditing(false)} />
        )}

        {/* 调试工具 */}
        <div className="debug">
          <span>种子 {run.seed}</span>
          <button onClick={restart}>新的一局</button>
          <button
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
          >
            {muted ? '🔇 静音' : '🔊 声音'}
          </button>
          <span>速度</span>
          {[1, 2, 4].map((v) => (
            <button key={v} className={speed === v ? 'on' : ''} onClick={() => setSpeed(v)}>
              {v}×
            </button>
          ))}
          {run.phase === 'battle' && (
            <>
              <span>放炸弹</span>
              {(['H', 'V', 'A', 'CB'] as BombKind[]).map((k) => (
                <button key={k} className={placeBomb === k ? 'on' : ''} onClick={() => setPlaceBomb(placeBomb === k ? null : k)}>
                  {k}
                </button>
              ))}
              <button onClick={debugWeaken}>残血</button>
            </>
          )}
        </div>

        <div className="levels-debug" title="原型：左键 +1 级，右键 −1 级">
          <div className="levels-title">升级（原型）</div>
          {UPGRADE_KEYS.map((k) => (
            <button
              key={k}
              className={run.levels[k] > 1 ? 'on' : ''}
              title={`${UPGRADE_NAMES[k]} ${run.levels[k]} 级`}
              onClick={() => debugLevel(k, 1)}
              onContextMenu={(e) => {
                e.preventDefault();
                debugLevel(k, -1);
              }}
            >
              {LEVEL_LABEL[k]} {run.levels[k]}
            </button>
          ))}
        </div>

        {toast && <div className="toast">{toast}</div>}
      </div>
    </div>
  );
}
