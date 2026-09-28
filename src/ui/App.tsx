import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_CONFIG,
  endTurn,
  playerAction,
  startBattle,
  type ActionLog,
  type BattleState,
  type BombKind,
  type Intent,
  type Pos,
} from '../engine';
import { DEMO_ENEMY, DEMO_INSERTS, DEMO_PLAYER } from './demo';
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
/** 网址带 ?seed=123 时固定开局，便于复现同一局面 */
const initialSeed = () => Number(new URLSearchParams(window.location.search).get('seed')) || newSeed();

function newBattle(seed: number): BattleState {
  return startBattle({ seed, player: DEMO_PLAYER, enemy: DEMO_ENEMY, inserts: DEMO_INSERTS });
}

export function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [scale, setScale] = useState(1);
  const [seed, setSeed] = useState(initialSeed);
  const [battle, setBattle] = useState(() => newBattle(seed));
  const battleRef = useRef(battle);
  battleRef.current = battle;
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [lastLog, setLastLog] = useState<ActionLog | null>(null);
  const [toast, setToast] = useState('');
  const [speed, setSpeed] = useState(1);
  const [placeBomb, setPlaceBomb] = useState<BombKind | null>(null);
  const placeRef = useRef(placeBomb);
  placeRef.current = placeBomb;

  const setBusyBoth = (v: boolean) => {
    busyRef.current = v;
    setBusy(v);
    if (stageRef.current) stageRef.current.busy = v;
  };

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? '' : t)), 1400);
  };

  const refreshStage = (s: BattleState) => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.sync(s.board);
    stage.drawInserts(s.inserts, s.current.suppressedId);
  };

  // ---- 行动 ----
  const runAction = useCallback(async (action: Parameters<typeof playerAction>[1]) => {
    if (busyRef.current) return;
    const out = playerAction(battleRef.current, action);
    if (!out.ok) return flash(REASON_TEXT[out.reason] ?? '无效操作');
    const stage = stageRef.current!;
    setBusyBoth(true);
    await stage.play(out.log.result.events);
    stage.sync(out.state.board);
    setLastLog(out.log);
    await stage.playPlayerEffects(out.log);
    setBattle(out.state);
    setBusyBoth(false);
  }, []);

  const doEndTurn = useCallback(async () => {
    if (busyRef.current || battleRef.current.outcome !== 'ongoing') return;
    setBusyBoth(true);
    const { state, log } = endTurn(battleRef.current);
    if (log) await stageRef.current!.playEnemyTurn(log);
    setBattle(state);
    refreshStage(state);
    setBusyBoth(false);
  }, []);

  // AP 用完自动结束回合
  useEffect(() => {
    if (!busy && battle.ap === 0 && battle.outcome === 'ongoing') {
      const t = window.setTimeout(doEndTurn, 350);
      return () => window.clearTimeout(t);
    }
  }, [busy, battle, doEndTurn]);

  // ---- 调试：放炸弹 ----
  const onPlace = useCallback((at: Pos) => {
    const kind = placeRef.current;
    if (!kind) return;
    const s: BattleState = JSON.parse(JSON.stringify(battleRef.current));
    s.board[at.r]![at.c] = { id: s.nextId++, kind: 'bomb', bomb: kind };
    setBattle(s);
    stageRef.current?.sync(s.board);
  }, []);

  // ---- 舞台创建与缩放 ----
  useEffect(() => {
    let disposed = false;
    const fit = () => Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    setScale(fit());
    void Stage.create(hostRef.current!, window.devicePixelRatio * fit(), {
      onSwap: (from, to) => void runAction({ type: 'swap', from, to }),
      onIgnite: (at) => void runAction({ type: 'ignite', at }),
      onPlace,
    }).then((stage) => {
      if (disposed) return stage.destroy();
      stageRef.current = stage;
      refreshStage(battleRef.current);
    });
    const onResize = () => {
      const s = fit();
      setScale(s);
      stageRef.current?.setResolution(window.devicePixelRatio * s);
    };
    const onKey = (e: KeyboardEvent) => {
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
  }, [runAction, doEndTurn, onPlace]);

  useEffect(() => stageRef.current?.setSpeed(speed), [speed]);
  useEffect(() => {
    if (stageRef.current) stageRef.current.placeMode = placeBomb !== null;
  }, [placeBomb]);

  const restart = () => {
    const s = newSeed();
    setSeed(s);
    const b = newBattle(s);
    setBattle(b);
    setLastLog(null);
    refreshStage(b);
  };

  const { player, enemy } = battle;
  const st = lastLog?.settlement;
  const A = lastLog?.result.activeClearsByType;

  return (
    <div className="viewport">
      <div className="frame" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}>
        <div ref={hostRef} className="canvas-host" />

        {/* 玩家状态 */}
        <div className="panel player-panel">
          <div className="name">炼成师</div>
          <Bar value={player.hp} max={player.maxHp} kind="hp" />
          <div className="row">
            <span className="chip shield">护盾 {player.shield}</span>
            <span className="chip">
              行动力
              {Array.from({ length: DEFAULT_CONFIG.apPerTurn }, (_, i) => (
                <i key={i} className={`pip ${i < battle.ap ? 'on' : ''}`} />
              ))}
            </span>
            <span className="chip catalyst">
              充能
              {Array.from({ length: DEFAULT_CONFIG.chargeCap }, (_, i) => (
                <i key={i} className={`pip violet ${i < player.catalystCharges ? 'on' : ''}`} />
              ))}
            </span>
            <span className={`chip ${battle.gravity === 'up' ? 'warn' : ''}`}>
              重力 {battle.gravity === 'up' ? `↑ 剩 ${battle.gravityTurnsLeft} 回合` : '↓'}
            </span>
          </div>
        </div>

        {/* 敌人状态 */}
        <div className="panel enemy-panel">
          <div className="name">
            {enemy.def.name} <span className="turn">第 {battle.turn} 回合</span>
          </div>
          <Bar value={enemy.hp} max={enemy.def.maxHp} kind="hp" />
          <div className="row">
            <span className="chip shield">护盾 {enemy.shield}</span>
            <span className="chip intent">意图：{enemy.stunPending ? '（将被眩晕取消）' : intentText(enemy.intent, enemy.chargeBonus)}</span>
          </div>
          <div className="row">
            <span className="label">毒气</span>
            <Bar value={enemy.poison} max={DEFAULT_CONFIG.poisonThreshold} kind="poison" />
            <span className="note">回合末 −{DEFAULT_CONFIG.poisonDecay}</span>
          </div>
        </div>

        {/* 结算明细 */}
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
                <span className="dim">被动清除 {lastLog!.result.passiveClearCount}{lastLog!.erosionConsumed ? '，被侵蚀降一档' : ''}</span>
                <span className="eq">=</span>
                <b className="c-atk">伤害 {st.finalEffects.attack}</b>
                <b className="c-sh">护盾 {st.finalEffects.shield}</b>
                <b className="c-po">毒气 {st.finalEffects.poison}</b>
              </div>
              <div className="settle-row dim">
                结算分 {st.settlementScore} · 本场累计 {battle.totalScore}
                {st.chargesGained > 0 ? ` · 新充能 +${st.chargesGained}` : ''}
              </div>
            </>
          ) : (
            <div className="dim">交换相邻方块或点燃炸弹。第一次下落前的清除给基数，之后的连锁提高倍率。</div>
          )}
        </div>

        <button className="end-turn" disabled={busy || battle.outcome !== 'ongoing'} onClick={() => void doEndTurn()}>
          结束回合 <small>E</small>
        </button>

        {/* 调试工具 */}
        <div className="debug">
          <span>种子 {seed}</span>
          <button onClick={restart}>新战斗</button>
          <span>速度</span>
          {[1, 2, 4].map((v) => (
            <button key={v} className={speed === v ? 'on' : ''} onClick={() => setSpeed(v)}>
              {v}×
            </button>
          ))}
          <span>放炸弹</span>
          {(['H', 'V', 'A', 'CB'] as BombKind[]).map((k) => (
            <button key={k} className={placeBomb === k ? 'on' : ''} onClick={() => setPlaceBomb(placeBomb === k ? null : k)}>
              {k}
            </button>
          ))}
        </div>

        {toast && <div className="toast">{toast}</div>}

        {battle.outcome !== 'ongoing' && (
          <div className="result">
            <h1>{battle.outcome === 'won' ? '胜利！' : '倒下了……'}</h1>
            <p>本场结算分 {battle.totalScore}</p>
            <button onClick={restart}>再来一场</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Bar({ value, max, kind }: { value: number; max: number; kind: 'hp' | 'poison' }) {
  return (
    <div className={`bar ${kind}`}>
      <div className="fill" style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%` }} />
      <span>
        {value} / {max}
      </span>
    </div>
  );
}
