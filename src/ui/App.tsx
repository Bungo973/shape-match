import { useCallback, useEffect, useRef, useState } from 'react';
import {
  campRest,
  campUpgrade,
  chooseArtifact,
  chooseInsert,
  DEFAULT_CONFIG,
  installInsert,
  newRun,
  pickStarter,
  rerollInserts,
  runAction,
  runEndTurn,
  startNextBattle,
  type Action,
  type ActionLog,
  type BattleState,
  type BombKind,
  type Intent,
  type Pos,
  type RunResult,
  type RunState,
} from '../engine';
import { ArtifactCard } from './components';
import { clearRun, loadRun, saveRun } from './save';
import { BoardEditor } from './screens/BoardEditor';
import { ArtifactScreen, CampScreen, MapScreen, ResultScreen, RewardScreen, StarterScreen } from './screens/Screens';
import { Stage, STAGE_H, STAGE_W } from './stage/Stage';

const REASON_TEXT: Record<string, string> = {
  sameColor: '同色方块不能交换',
  notAdjacent: '只能交换相邻的格子',
  noAp: '行动力已用完',
  notBomb: '只能点燃炸弹',
  battleOver: '战斗已结束',
};

function intentText(intent: Intent, chargeBonus: number): string {
  return intent.parts
    .map((p) => {
      switch (p.kind) {
        case 'attack':
          return `攻击 ${p.amount + chargeBonus}`;
        case 'defend':
          return `防御 ${p.amount}`;
        case 'charge':
          return `蓄力 +${p.amount}`;
        case 'erodeMultiplier':
          return '侵蚀倍率';
        case 'suppressInsert':
          return '压制嵌片';
        case 'gravityUp':
          return '重力反转';
      }
    })
    .join(' · ');
}

const newSeed = () => Math.floor(Math.random() * 1e9);
/** 网址带 ?seed=123 时从该种子开新局，便于复现 */
const urlSeed = () => Number(new URLSearchParams(window.location.search).get('seed')) || null;

function initialRun(): RunState {
  const seed = urlSeed();
  if (seed) return newRun(seed);
  return loadRun() ?? newRun(newSeed());
}

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
      showBattle(r.run.battle);
    }
  };

  const restart = () => {
    clearRun();
    setLastLog(null);
    setEditing(false);
    setRun(newRun(newSeed()));
  };

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
            <div className="panel player-panel">
              <div className="name">
                炼成师 <span className="turn">金币 {run.gold}</span>
              </div>
              <Bar value={b.player.hp} max={b.player.maxHp} />
              <div className="row">
                <span className="chip shield">护盾 {b.player.shield}</span>
                <span className="chip">
                  行动力
                  {Array.from({ length: Math.max(DEFAULT_CONFIG.apPerTurn, b.ap) }, (_, i) => (
                    <i key={i} className={`pip ${i < b.ap ? 'on' : ''}`} />
                  ))}
                </span>
                <span className="chip catalyst">
                  充能
                  {Array.from({ length: DEFAULT_CONFIG.chargeCap }, (_, i) => (
                    <i key={i} className={`pip violet ${i < b.player.catalystCharges ? 'on' : ''}`} />
                  ))}
                </span>
                <span className={`chip ${b.gravity === 'up' ? 'warn' : ''}`}>重力 {b.gravity === 'up' ? `↑ 剩 ${b.gravityTurnsLeft} 回合` : '↓'}</span>
                {b.current.erosionArmed && <span className="chip warn">倍率被侵蚀</span>}
              </div>
            </div>

            <div className="artifact-strip">
              {run.artifacts.map((k) => (
                <ArtifactCard key={k} k={k} compact />
              ))}
            </div>

            <div className="panel enemy-panel">
              <div className="name">
                {b.enemy.def.name}{' '}
                <span className="turn">
                  第 {run.battleIndex} 战 · 第 {b.turn} 回合
                </span>
              </div>
              <Bar value={b.enemy.hp} max={b.enemy.def.maxHp} />
              <div className="row">
                <span className="chip shield">护盾 {b.enemy.shield}</span>
                <span className="chip intent">意图：{b.enemy.stunPending ? '（将被眩晕取消）' : intentText(b.enemy.intent, b.enemy.chargeBonus)}</span>
              </div>
              <div className="row">
                <span className="label">毒气</span>
                <Bar value={b.enemy.poison} max={DEFAULT_CONFIG.poisonThreshold} kind="poison" />
                <span className="note">回合末 −{DEFAULT_CONFIG.poisonDecay}</span>
              </div>
            </div>

            <div className="panel settle-panel">
              {st && A ? (
                <>
                  <div className="settle-row">
                    <span className="label">主动基数</span>
                    <b className="c-atk">攻 {st.baseValues.attack}</b>
                    <b className="c-sh">盾 {st.baseValues.shield}</b>
                    <b className="c-po">毒 {st.baseValues.poison}</b>
                    <span className="dim">
                      （清除 攻{A.attack} 盾{A.shield} 毒{A.poison} 催{A.catalyst}
                      {st.chargesUsed > 0 ? `，充能各 +${st.chargesUsed * DEFAULT_CONFIG.chargeBonus}` : ''}
                      {lastLog!.result.socketBonuses.attack + lastLog!.result.socketBonuses.shield + lastLog!.result.socketBonuses.poison > 0 ? '，含嵌片' : ''}）
                    </span>
                  </div>
                  <div className="settle-row big">
                    <span className="mult">× {st.multiplier}</span>
                    <span className="dim">
                      被动清除 {lastLog!.result.passiveClearCount}
                      {lastLog!.erosionConsumed ? '，被侵蚀降一档' : ''}
                    </span>
                    <span className="eq">=</span>
                    <b className="c-atk">伤害 {st.finalEffects.attack}</b>
                    <b className="c-sh">护盾 {st.finalEffects.shield}</b>
                    <b className="c-po">毒气 {st.finalEffects.poison}</b>
                  </div>
                  <div className="settle-row dim">
                    结算分 {st.settlementScore} · 本场累计 {b.totalScore}
                    {st.chargesGained > 0 ? ` · 新充能 +${st.chargesGained}` : ''}
                    {lastLog!.result.overloadFired ? ' · 过载：本步不获得护盾' : ''}
                  </div>
                </>
              ) : (
                <div className="dim">交换相邻方块或点燃炸弹。第一次下落前的清除给基数，之后的连锁提高倍率。</div>
              )}
            </div>

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

        {toast && <div className="toast">{toast}</div>}
      </div>
    </div>
  );
}

function Bar({ value, max, kind = 'hp' }: { value: number; max: number; kind?: 'hp' | 'poison' }) {
  return (
    <div className={`bar ${kind}`}>
      <div className="fill" style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%` }} />
      <span>
        {value} / {max}
      </span>
    </div>
  );
}
