// 嵌片卡模式（原型）：?mode=card 进入。连打第一段落三战，战后三选一加卡或跳过。
// 设计见 docs/CARD_DESIGN.md（讨论稿）。旧的交换模式在 App.tsx，互不影响。
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ATTRIBUTE_CARDS,
  CARD_DEFS,
  createRng,
  endTurn,
  makeCard,
  mixSeed,
  normalize,
  playerAction,
  rotate,
  SEGMENT_1,
  startBattle,
  starterDeck,
  type ActionLog,
  type BattleState,
  type BombKind,
  type CardInstance,
  type Color,
  type PlayerState,
  type Pos,
} from '../engine';
import { EnemyPanel, PlayerPanel, REASON_TEXT, SettlePanel } from './Hud';
import { Stage, STAGE_H, STAGE_W } from './stage/Stage';

type Phase = 'pick' | 'battle' | 'reward' | 'over';

/** 卡片的识别色：属性卡用对应方块的颜色，基础卡用中性的铜色 */
const CARD_HEX: Record<Color | 'basic', number> = { attack: 0xe6edf5, shield: 0x5aa8ff, poison: 0x5cff6a, catalyst: 0xff5ce1, basic: 0xd9a066 };
const cardHex = (c: CardInstance) => CARD_HEX[CARD_DEFS[c.defId]!.attribute ?? 'basic'];
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

const newSeed = () => Math.floor(Math.random() * 1e9);
const urlSeed = () => Number(new URLSearchParams(window.location.search).get('seed')) || newSeed();
const START_PLAYER: PlayerState = { hp: 40, maxHp: 40, shield: 0, catalystCharges: 0 };

/** 以形状包围盒中心对齐鼠标所在格 */
function placeAt(shape: Pos[], at: Pos): Pos[] {
  const cr = Math.floor(Math.max(...shape.map((p) => p.r)) / 2);
  const cc = Math.floor(Math.max(...shape.map((p) => p.c)) / 2);
  return shape.map((p) => ({ r: at.r + p.r - cr, c: at.c + p.c - cc }));
}
const inside = (cells: Pos[]) => cells.every((p) => p.r >= 0 && p.r < 8 && p.c >= 0 && p.c < 8);

function CardShape({ cells, color, cell = 16 }: { cells: Pos[]; color: number; cell?: number }) {
  const n = normalize(cells);
  const rows = Math.max(...n.map((p) => p.r)) + 1;
  const cols = Math.max(...n.map((p) => p.c)) + 1;
  return (
    <div className="shape" style={{ width: cols * cell, height: rows * cell }}>
      {n.map((p) => (
        <i key={`${p.r},${p.c}`} style={{ left: p.c * cell, top: p.r * cell, width: cell - 2, height: cell - 2, background: css(color) }} />
      ))}
    </div>
  );
}

export function CardApp() {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [scale, setScale] = useState(1);
  const [seed, setSeed] = useState(urlSeed);
  const [phase, setPhase] = useState<Phase>('pick');
  const [deck, setDeck] = useState<CardInstance[]>([]);
  const [battleIndex, setBattleIndex] = useState(0);
  const [battle, setBattleState] = useState<BattleState | null>(null);
  const battleRef = useRef<BattleState | null>(null);
  const [rewards, setRewards] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<'won' | 'lost' | null>(null);
  const [lastLog, setLastLog] = useState<ActionLog | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [selected, setSelected] = useState<number | null>(null);
  const selectedRef = useRef<number | null>(null);
  const [shape, setShape] = useState<Pos[]>([]);
  const shapeRef = useRef<Pos[]>([]);
  const hoverRef = useRef<Pos | null>(null);
  const [toast, setToast] = useState('');
  const [speed, setSpeed] = useState(1);
  const [placeBomb, setPlaceBomb] = useState<BombKind | null>(null);
  const placeRef = useRef(placeBomb);
  placeRef.current = placeBomb;
  const uidRef = useRef(100);

  const setBattle = (b: BattleState | null) => {
    battleRef.current = b;
    setBattleState(b);
  };
  const setBusyBoth = (v: boolean) => {
    busyRef.current = v;
    setBusy(v);
    if (stageRef.current) stageRef.current.busy = v;
  };
  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? '' : t)), 1500);
  };

  // ---- 放置预览 ----
  const refreshGhost = useCallback(() => {
    const stage = stageRef.current;
    const b = battleRef.current;
    const idx = selectedRef.current;
    const at = hoverRef.current;
    if (!stage) return;
    if (!b?.cards || idx === null || !at || placeRef.current) return stage.setGhost(null, false, 0);
    const cells = placeAt(shapeRef.current, at);
    stage.setGhost(cells, inside(cells), cardHex(b.cards.hand[idx]!));
  }, []);

  const select = useCallback(
    (idx: number | null) => {
      const b = battleRef.current;
      selectedRef.current = idx;
      setSelected(idx);
      const s = idx !== null && b?.cards?.hand[idx] ? normalize(b.cards.hand[idx]!.cells) : [];
      shapeRef.current = s;
      setShape(s);
      refreshGhost();
    },
    [refreshGhost],
  );

  const spin = useCallback(() => {
    if (selectedRef.current === null) return;
    shapeRef.current = rotate(shapeRef.current);
    setShape(shapeRef.current);
    refreshGhost();
  }, [refreshGhost]);

  // ---- 战斗流程 ----
  const beginBattle = (index: number, player: PlayerState, cards: CardInstance[]) => {
    const node = SEGMENT_1[index]!;
    const b = startBattle({ seed: mixSeed(seed, 0xca, index), player, enemy: node.enemy, deck: cards });
    setBattle(b);
    setBattleIndex(index);
    setLastLog(null);
    setPhase('battle');
    const stage = stageRef.current;
    if (stage) {
      stage.resetBoard();
      stage.setEnemy(node.enemy.id);
      stage.sync(b.board);
      stage.drawInserts([], null);
    }
    select(null);
  };

  const finishIfOver = (b: BattleState) => {
    if (b.outcome === 'lost') {
      setOutcome('lost');
      setPhase('over');
    } else if (b.outcome === 'won') {
      if (battleIndex + 1 >= SEGMENT_1.length) {
        setOutcome('won');
        setPhase('over');
      } else {
        // 三选一：从全部卡牌中抽，允许重复
        const rng = createRng(mixSeed(seed, 0xce, battleIndex));
        const ids = Object.keys(CARD_DEFS);
        setRewards([0, 1, 2].map(() => ids[rng.int(ids.length)]!));
        setPhase('reward');
      }
      select(null);
    }
  };

  const onCellClick = useCallback(
    async (at: Pos) => {
      const b = battleRef.current;
      const stage = stageRef.current;
      if (!b || !stage || busyRef.current) return;
      if (placeRef.current) {
        const next: BattleState = JSON.parse(JSON.stringify(b));
        next.board[at.r]![at.c] = { id: next.nextId++, kind: 'bomb', bomb: placeRef.current };
        setBattle(next);
        stage.sync(next.board);
        return;
      }
      const idx = selectedRef.current;
      if (idx === null) return flash('先从下方手牌中选一张卡');
      const cells = placeAt(shapeRef.current, at);
      const out = playerAction(b, { type: 'playCard', index: idx, cells });
      if (!out.ok) return flash(REASON_TEXT[out.reason] ?? out.reason);
      setBusyBoth(true);
      stage.setGhost(null, false, 0);
      selectedRef.current = null;
      setSelected(null);
      await stage.play(out.log.result.events);
      stage.sync(out.state.board);
      setLastLog(out.log);
      await stage.playPlayerEffects(out.log);
      setBattle(out.state);
      setBusyBoth(false);
      finishIfOver(out.state);
    },
    [battleIndex, seed], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const clickRef = useRef(onCellClick);
  clickRef.current = onCellClick;

  const doEndTurn = useCallback(async () => {
    const b = battleRef.current;
    if (!b || busyRef.current || b.outcome !== 'ongoing') return;
    setBusyBoth(true);
    select(null);
    const { state, log } = endTurn(b);
    if (log) await stageRef.current!.playEnemyTurn(log);
    setBattle(state);
    setBusyBoth(false);
    finishIfOver(state);
  }, [battleIndex, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const endRef = useRef(doEndTurn);
  endRef.current = doEndTurn;

  // 没有费用或打不起任何手牌时自动结束回合
  useEffect(() => {
    if (busy || phase !== 'battle' || !battle?.cards || battle.outcome !== 'ongoing') return;
    const affordable = battle.cards.hand.some((c) => CARD_DEFS[c.defId]!.cost <= battle.ap);
    if (!affordable) {
      const t = window.setTimeout(() => void endRef.current(), 450);
      return () => window.clearTimeout(t);
    }
  }, [busy, battle, phase]);

  // ---- 舞台 ----
  useEffect(() => {
    let disposed = false;
    const fit = () => Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    setScale(fit());
    void Stage.create(hostRef.current!, window.devicePixelRatio * fit(), {
      onSwap: () => undefined,
      onIgnite: () => undefined,
      onCellHover: (at) => {
        hoverRef.current = at;
        refreshGhost();
      },
      onCellClick: (at) => void clickRef.current(at),
    }).then((stage) => {
      if (disposed) return stage.destroy();
      stage.cardMode = true;
      stageRef.current = stage;
      stage.setSpeed(speed);
      const b = battleRef.current;
      if (b) {
        stage.setEnemy(b.enemy.def.id);
        stage.sync(b.board);
      }
    });
    const host = hostRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (selectedRef.current === null) return;
      e.preventDefault();
      spin();
    };
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      spin();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') spin();
      else if (e.key === 'Escape') select(null);
      else if (e.key === 'e' || e.key === 'E') void endRef.current();
      else if (/^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (battleRef.current?.cards?.hand[i]) select(selectedRef.current === i ? null : i);
      }
    };
    const onResize = () => {
      const s = fit();
      setScale(s);
      stageRef.current?.setResolution(window.devicePixelRatio * s);
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      disposed = true;
      host.removeEventListener('wheel', onWheel);
      host.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      stageRef.current?.destroy();
      stageRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => stageRef.current?.setSpeed(speed), [speed]);
  useEffect(() => refreshGhost(), [placeBomb, refreshGhost]);

  const restart = () => {
    setSeed(newSeed());
    setDeck([]);
    setBattle(null);
    setOutcome(null);
    setPhase('pick');
  };

  const b = battle;
  const hand = b?.cards?.hand ?? [];

  return (
    <div className="viewport">
      <div className="frame card-mode" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}>
        <div ref={hostRef} className="canvas-host" />

        {phase === 'battle' && b?.cards && (
          <>
            <PlayerPanel b={b} apLabel="费用" />
            <EnemyPanel b={b} battleIndex={battleIndex + 1} />
            <SettlePanel b={b} lastLog={lastLog} hint="选一张手牌，把它放到棋盘上：覆盖的格子被清除，覆盖到炸弹就引爆。滚轮或 R 旋转。" />
            <button className="end-turn" disabled={busy || b.outcome !== 'ongoing'} onClick={() => void doEndTurn()}>
              结束回合 <small>E</small>
            </button>
            <div className="hand">
              {hand.map((c, i) => {
                const d = CARD_DEFS[c.defId]!;
                const affordable = d.cost <= b.ap;
                return (
                  <button
                    key={c.uid}
                    className={`hand-card ${selected === i ? 'on' : ''} ${d.attribute ? 'attr' : ''}`}
                    style={{ borderColor: selected === i ? css(cardHex(c)) : undefined }}
                    disabled={busy || !affordable}
                    onClick={() => select(selected === i ? null : i)}
                  >
                    <span className="hand-cost">{d.cost}</span>
                    <span className="hand-key">{i + 1}</span>
                    <b>{d.name}</b>
                    <CardShape cells={selected === i ? shape : c.cells} color={cardHex(c)} cell={selected === i ? 15 : 13} />
                    {d.attribute && <small>{d.text.split('；')[1]}</small>}
                  </button>
                );
              })}
            </div>
            <div className="piles">
              抽牌堆 {b.cards.draw.length} · 弃牌堆 {b.cards.discard.length} · 牌组 {deck.length}
            </div>
          </>
        )}

        {phase === 'pick' && (
          <div className="screen">
            <h2>嵌片卡模式 · 选择起始属性卡</h2>
            <p className="sub">起始牌组：直条、方块、T 字、L 字各一张，再加一张你选的属性卡。每回合 3 费、抽 5 张。</p>
            <div className="cards">
              {ATTRIBUTE_CARDS.map((id) => {
                const c = makeCard(id, 'preview');
                return (
                  <button
                    key={id}
                    className="card"
                    onClick={() => {
                      const d = starterDeck(id);
                      setDeck(d);
                      setOutcome(null);
                      beginBattle(0, START_PLAYER, d);
                    }}
                  >
                    <div className="card-title">{CARD_DEFS[id]!.name}</div>
                    <div className="card-shape">
                      <CardShape cells={c.cells} color={cardHex(c)} cell={22} />
                    </div>
                    <div className="card-text">{CARD_DEFS[id]!.text}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {phase === 'reward' && b && (
          <div className="screen">
            <h2>胜利！选一张卡加入牌组</h2>
            <p className="sub">
              牌组现在 {deck.length} 张。每回合只抽 5 张，牌组越大，单张卡出现得越少，所以也可以跳过。
            </p>
            <div className="cards">
              {rewards.map((id, i) => {
                const c = makeCard(id, `r${i}`);
                return (
                  <button
                    key={i}
                    className="card"
                    onClick={() => {
                      const d = [...deck, makeCard(id, `c${uidRef.current++}`)];
                      setDeck(d);
                      beginBattle(battleIndex + 1, b.player, d);
                    }}
                  >
                    <div className="card-title">
                      {CARD_DEFS[id]!.name} <small>{CARD_DEFS[id]!.cost} 费</small>
                    </div>
                    <div className="card-shape">
                      <CardShape cells={c.cells} color={cardHex(c)} cell={22} />
                    </div>
                    <div className="card-text">{CARD_DEFS[id]!.text}</div>
                  </button>
                );
              })}
            </div>
            <div className="actions">
              <button onClick={() => beginBattle(battleIndex + 1, b.player, deck)}>跳过</button>
            </div>
          </div>
        )}

        {phase === 'over' && (
          <div className="screen result-screen">
            <h1>{outcome === 'won' ? '三战全胜！' : '倒下了……'}</h1>
            <p>
              到达第 {battleIndex + 1} 战 · 剩余生命 {b?.player.hp ?? 0} · 牌组 {deck.length} 张
            </p>
            <button className="primary" onClick={restart}>
              再来一局
            </button>
          </div>
        )}

        <div className="debug">
          <span>卡牌原型 · 种子 {seed}</span>
          <button onClick={restart}>重开</button>
          <span>速度</span>
          {[1, 2, 4].map((v) => (
            <button key={v} className={speed === v ? 'on' : ''} onClick={() => setSpeed(v)}>
              {v}×
            </button>
          ))}
          {phase === 'battle' && (
            <>
              <span>放炸弹</span>
              {(['H', 'V', 'A', 'CB'] as BombKind[]).map((k) => (
                <button key={k} className={placeBomb === k ? 'on' : ''} onClick={() => setPlaceBomb(placeBomb === k ? null : k)}>
                  {k}
                </button>
              ))}
              <button
                onClick={() => {
                  if (!b) return;
                  const next: BattleState = JSON.parse(JSON.stringify(b));
                  next.enemy.hp = 1;
                  next.enemy.shield = 0;
                  setBattle(next);
                }}
              >
                残血
              </button>
            </>
          )}
        </div>

        {toast && <div className="toast">{toast}</div>}
      </div>
    </div>
  );
}
