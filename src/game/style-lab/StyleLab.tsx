import { useEffect, useRef, useState } from 'react';
import {
  ARTIFACTS, DEFAULT_CONFIG, RARITY_NAME, UPGRADE_KEYS, UPGRADE_NAMES,
  endTurn, findHint, playerAction, startBattle, stepsLeft, useItem,
  type Action, type ActionLog, type ArtifactKey, type BattleState, type ItemKey, type Pos,
} from '../../engine';
import { BombIcon, ItemIcon, UpgradeIcon } from '../icons';

const DIRECTIONS = [
  { key: 'poster', name: '瑞士海报', en: 'PLAY IN FORM', tag: '大胆 · 平涂 · 秩序', description: '把冲分做成一张可玩的现代主义海报。巨型数字、原色色块、硬朗网格，延续现有几何识别，但让计分成为主角。', craft: 'CSS Grid、纯色几何、粗线与短促位移。', motion: '数字上顶、硬切闪色；适合干脆的连锁。', cost: '低', colors: ['#f3efe4', '#df4935', '#235bc1', '#f4c94c'] },
  { key: 'terminal', name: '终端实验室', en: 'CHAIN / SYSTEM', tag: '荧光 · 等宽 · 精密', description: '把每一步看成一次连锁实验。黑底薄线、荧光描边、系统读数；计分横向展开，右侧像装配模块。', craft: '等宽字体、轮廓几何、径向辉光与细网格。', motion: '扫描、读数闪烁、消除后短暂余辉。', cost: '低—中', colors: ['#081817', '#a4f9bf', '#75c9ed', '#e9ce8c'] },
  { key: 'candy', name: '软糖玩具', en: 'a little chain club', tag: '柔软 · 圆润 · 轻快', description: '像把一盒彩色软糖倒在桌面上。浅奶油色、鼓起的棋子、圆润计分牌，神器变成可收集的小卡片。', craft: '渐变、内阴影、圆角与弹簧缩放；无需贴图。', motion: '挤压、回弹、颗粒散落；反馈轻快。', cost: '中', colors: ['#fff4e9', '#ec877b', '#7ba5df', '#99bfa1'] },
  { key: 'archive', name: '纸本档案', en: 'THE CHAIN ARCHIVE', tag: '纸感 · 衬线 · 克制', description: '一份正在填写的连锁研究档案。纸白、墨色、朱红印记与衬线大字；神器像藏品条目，局面像棋谱。', craft: '系统衬线字体、双线框、重复渐变与低饱和色。', motion: '印章显现、细线展开；长连锁也保持安静。', cost: '低', colors: ['#f1ecdf', '#aa493c', '#627d92', '#a79052'] },
  { key: 'theatre', name: '午夜剧院', en: 'THE MIDNIGHT CHAIN', tag: '深色 · 金线 · 华丽', description: '让冲分成为一场小型演出。墨紫背景、香槟金细线、宝石色棋子，计分在上方聚光，构筑如一组剧目卡。', craft: '多层渐变、细边框、轻量辉光与字距。', motion: '聚光、金色得分浮字、连锁逐级增亮。', cost: '中', colors: ['#171424', '#d6b97e', '#c77895', '#86abbf'] },
] as const;
type StyleKey = (typeof DIRECTIONS)[number]['key'];
const config = { ...DEFAULT_CONFIG, scoreMode: true };
const artifactKeys: ArtifactKey[] = ['chainLens', 'lastCall', 'piggyBank'];
const names = { attack: '圆形', shield: '方形', poison: '三角', catalyst: '菱形' };
const same = (a: Pos | null, b: Pos) => a?.r === b.r && a.c === b.c;
const fmt = (n: number) => n.toLocaleString('zh-CN');

function initialBattle(): BattleState {
  const state = startBattle({
    seed: 123, player: { hp: 32, maxHp: 40, shield: 0, catalystCharges: 0 },
    enemy: { id: 'style-sample', name: '第 3 关', maxHp: 1, script: [{ parts: [] }], fallbackDefend: 0, targetScore: 6700 },
    artifacts: artifactKeys, levels: { block: 3, line: 2, area: 1, color: 1 }, gold: 18,
    rule: 'cooldown', task: { kind: 'chain', tier: 'easy', goal: 8 },
  }, config);
  // 固定的中局展示快照。接下来的操作由现有引擎真实结算。
  state.totalScore = 4820;
  state.turn = 2;
  state.ap = 2;
  state.stepsTaken = 4;
  state.task!.progress = 5;
  for (const [r, c, bomb] of [[2, 6, 'H'], [5, 3, 'A'], [8, 8, 'CB']] as const) {
    state.board[r]![c] = { id: state.board[r]![c]!.id, kind: 'bomb', bomb };
  }
  return state;
}

export function StyleLab() {
  const queryStyle = new URLSearchParams(location.search).get('style');
  const [style, setStyle] = useState<StyleKey>(DIRECTIONS.find((d) => d.key === queryStyle)?.key ?? 'poster');
  const [battle, setBattle] = useState(initialBattle);
  const [selected, setSelected] = useState<Pos | null>(null);
  const [hint, setHint] = useState<ReturnType<typeof findHint>>(null);
  const [items, setItems] = useState<ItemKey[]>(['glove', 'magnifier']);
  const [armed, setArmed] = useState(false);
  const [message, setMessage] = useState('点选相邻两格交换，或点两下炸弹引爆。');
  const [last, setLast] = useState({ base: 120, multiplier: 2.5, score: 300, chain: 5 });
  const [pulse, setPulse] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const helpRef = useRef<HTMLDialogElement>(null);
  const direction = DIRECTIONS.find((d) => d.key === style)!;
  const remaining = stepsLeft(battle, config);
  const progress = Math.min(100, battle.totalScore / 6700 * 100);
  const over = battle.outcome !== 'ongoing';

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (showHelp) helpRef.current?.showModal();
    else helpRef.current?.close();
  }, [showHelp]);

  function switchStyle(key: StyleKey) {
    setStyle(key);
    const url = new URL(location.href);
    url.searchParams.set('style', key);
    history.replaceState(null, '', url);
  }

  function reset() {
    if (timer.current) clearTimeout(timer.current);
    setBattle(initialBattle()); setSelected(null); setHint(null); setArmed(false);
    setItems(['glove', 'magnifier']); setBusy(false); setPulse(0);
    setLast({ base: 120, multiplier: 2.5, score: 300, chain: 5 });
    setMessage('已恢复同一中局快照，可继续比较。');
  }

  function accept(next: BattleState, log: ActionLog | null) {
    setSelected(null); setHint(null); setArmed(false);
    if (log?.settlement) {
      const s = log.settlement;
      const chain = log.result.events.filter((e) => e.type === 'matches' && e.phase === 'passive').length;
      setLast({ base: s.base, multiplier: s.multiplier, score: s.settlementScore, chain });
      setPulse((n) => n + 1);
      setMessage(`本步 +${fmt(s.settlementScore)} 分 · ${chain} 层连锁${next.magnify ? ' · 放大镜待用' : ''}`);
    }
    if (next.ap === 0 && next.outcome === 'ongoing') next = endTurn(next, config).state;
    setBattle(next);
    setBusy(true);
    timer.current = setTimeout(() => setBusy(false), 650);
  }

  function act(action: Action) {
    if (busy || over) return;
    const result = playerAction(battle, action, config);
    if (result.ok) accept(result.state, result.log);
    else { setSelected(null); setMessage('这次交换不能消除，试试其他组合。'); }
  }

  function select(pos: Pos) {
    if (busy || over) return;
    if (!selected) { setSelected(pos); setHint(null); return; }
    if (same(selected, pos)) {
      if (battle.board[pos.r]![pos.c]?.kind === 'bomb' && !armed) act({ type: 'ignite', at: pos });
      else setSelected(null);
      return;
    }
    if (armed) {
      const result = useItem(battle, { key: 'glove', from: selected, to: pos }, config);
      if (result.ok) { setItems((bag) => bag.filter((i) => i !== 'glove')); setMessage('手套已使用，不消耗步数。'); accept(result.state, result.log); }
      else { setSelected(null); setMessage('这两格无法互换，请重新选两格。'); }
    } else if (Math.abs(selected.r - pos.r) + Math.abs(selected.c - pos.c) === 1) act({ type: 'swap', from: selected, to: pos });
    else setSelected(pos);
  }

  function demoStep() {
    if (busy || over) return;
    const nextHint = findHint(battle.board);
    if (nextHint) act({ type: 'swap', from: nextHint.from, to: nextHint.to });
    else {
      const r = battle.board.findIndex((row) => row.some((t) => t?.kind === 'bomb'));
      if (r >= 0) act({ type: 'ignite', at: { r, c: battle.board[r]!.findIndex((t) => t?.kind === 'bomb') } });
    }
  }

  function itemClick(key: ItemKey) {
    if (busy || over) return;
    if (key === 'glove') {
      setArmed(!armed); setSelected(null); setHint(null);
      setMessage(armed ? '已取消手套。' : '手套：点选任意两格互换，再点道具可取消。');
    } else if (key === 'magnifier') {
      const result = useItem(battle, { key }, config);
      if (result.ok) { setBattle(result.state); setItems((bag) => bag.filter((i) => i !== key)); setMessage('放大镜已挂上：下一步倍率 ×2，不消耗步数。'); }
    }
  }

  return <div className="lab-page">
    <header className="lab-header">
      <div><span className="lab-eyebrow">三消 × 肉鸽 / UI STUDIES · 2026</span><h1>同一局面，五种视觉性格。</h1></div>
      <a className="demo-link" href="/" target="_blank" rel="noreferrer">打开当前 demo ↗</a>
    </header>
    <nav className="style-tabs" aria-label="UI 风格选择">
      {DIRECTIONS.map((d, i) => <button key={d.key} aria-pressed={d.key === style} onClick={() => switchStyle(d.key)}><span className="tab-number">0{i + 1}</span><span>{d.name}</span><span className="tab-swatches">{d.colors.slice(1).map((c) => <i key={c} style={{ background: c }} />)}</span></button>)}
    </nav>
    <div className="preview-meta"><span><b>{direction.name}</b> / {direction.tag}</span><span>纯代码绘制 · 同一状态切换 · 可试玩</span></div>

    <section className={`game-preview ${style}`} aria-label={`${direction.name} UI 样本`}>
      <header className="game-header">
        <div className="game-brand"><span className="brand-kicker">MATCH THREE / ROGUELIKE</span><h2>{direction.en}</h2></div>
        <div className="game-vitals"><span className="hp-readout"><small>生命</small><strong>{battle.player.hp}<em>/40</em></strong><i><i style={{ width: `${battle.player.hp / 40 * 100}%` }} /></i></span><span className="gold-readout"><small>金币</small><strong>18</strong></span><button className="help" onClick={() => setShowHelp(true)} aria-label="样本玩法说明">?</button></div>
      </header>
      <div className="play-layout">
        <aside className="score-panel">
          <div className="level-caption"><span>STAGE <b>03</b> / 09</span><span className="boss-tag">首领关</span></div>
          <div className="score-display"><span className="section-caption">本关得分 / SCORE</span><strong key={`s${pulse}`}>{fmt(battle.totalScore)}</strong><span className="target-label">目标 <b>6,700</b> <span>分</span></span><div className="goal-track" role="progressbar" aria-label="本关目标进度" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></div><div className="progress-caption"><span>{Math.round(progress)}% 达成</span><span>还差 {fmt(Math.max(0, 6700 - battle.totalScore))}</span></div></div>
          <div className="calculation" key={`calc${pulse}`}><div className="base-number"><small>基数</small><b>{last.base}</b></div><span className="multiply">×</span><div className="mult-number"><small>倍率</small><b>{last.multiplier.toFixed(1)}</b></div><p>上一步 <strong>+{fmt(last.score)}</strong><span>{last.chain} 层连锁</span></p></div>
          <div className="steps-panel"><div><span className="section-caption">剩余步数</span><strong>{remaining}<small>/15</small></strong></div><div className="step-dots">{Array.from({ length: 5 }, (_, group) => <span key={group} className={group + 1 === battle.turn ? 'current' : ''}>{Array.from({ length: 3 }, (_, i) => <i key={i} className={group * 3 + i >= 15 - remaining ? 'available' : ''} />)}</span>)}</div><small>第 {battle.turn} 回合 / 共 5 回合</small></div>
          <div className="rule-panel"><span className="section-caption">首领规则 / 冷却</span><p>本关爆破等级不会上升。</p></div>
          <div className="task-panel"><span className="section-caption">支线任务 · 奖励 5 金币</span><p>一步连锁达到 8 层 <b>{battle.task?.done ? '完成' : `${battle.task?.progress ?? 0}/8`}</b></p></div>
        </aside>

        <main className="board-panel">
          <div className="board-caption"><span>连成三个，让连锁发生。</span><span>10 × 10</span></div>
          <div className={`board-wrap ${busy ? 'resolving' : ''}`}>
            <div className="tile-board" aria-label="三消棋盘">
              {battle.board.map((row, r) => row.map((tile, c) => {
                const pos = { r, c };
                const highlighted = hint && (same(hint.from, pos) || same(hint.to, pos));
                return <button className={`tile-cell ${same(selected, pos) ? 'selected' : ''} ${highlighted ? 'hinted' : ''}`} key={`${r}-${c}`} aria-label={`${r + 1}行${c + 1}列 ${tile?.kind === 'normal' ? names[tile.color] : '炸弹'}`} aria-pressed={same(selected, pos)} disabled={over || busy} onClick={() => select(pos)}>
                  {tile?.kind === 'normal' ? <span key={tile.id} className={`piece ${tile.color}`} /> : tile?.kind === 'bomb' ? <span className="bomb-piece"><BombIcon bomb={tile.bomb} size={36} /></span> : null}
                </button>;
              }))}
            </div>
            {pulse > 0 && <div key={pulse} className="score-float" aria-hidden="true">+{fmt(last.score)}<small>{last.chain > 0 ? `${last.chain} CHAIN` : 'SCORE'}</small></div>}
            {over && <div className="end-overlay"><span>{battle.outcome === 'won' ? 'STAGE CLEAR' : 'STAGE COMPLETE'}</span><h3>{battle.outcome === 'won' ? '目标达成。' : '本关已结束。'}</h3><p>本关 {fmt(battle.totalScore)} 分{battle.outcome === 'won' ? ` · 提前 ${remaining} 步` : ` · 生命 ${battle.player.hp}`}</p><button onClick={reset}>恢复样本再试一次</button></div>}
          </div>
          <div className="board-actions"><button onClick={demoStep} disabled={busy || over} className="primary-action">演示一步 <span>↗</span></button><button onClick={() => { setHint(findHint(battle.board)); setMessage('描边的两格可以交换，试试看。'); }} disabled={busy || over}>提示</button><button onClick={reset}>重置局面</button></div>
          <p className="live-message" role="status">{battle.magnify && <b>×2 待用 · </b>}{message}</p>
        </main>

        <aside className="build-panel">
          <section className="item-panel"><div className="panel-heading"><h3>随身道具</h3><span>{items.length} / 3</span></div><div className="item-grid">{items.map((key) => <button className={`item-button ${armed && key === 'glove' ? 'armed' : ''}`} key={key} disabled={over || busy} aria-pressed={armed && key === 'glove'} onClick={() => itemClick(key)}><ItemIcon item={key} size={32} /><b>{key === 'glove' ? '手套' : '放大镜'}</b><small>{key === 'glove' ? '任意两格互换' : '下一步倍率 ×2'}</small></button>)}</div><p className="small-note">不消耗步数 · 道具最多携带 3 件</p></section>
          <section className="artifact-panel"><div className="panel-heading"><h3>神器构筑</h3><span>3 / 6</span></div><div className="artifact-list">{artifactKeys.map((key, i) => <details key={key} className={`artifact-card ${ARTIFACTS[key].rarity}`} open><summary><span className="artifact-index">0{i + 1}</span><b>{ARTIFACTS[key].name}</b><small>{RARITY_NAME[ARTIFACTS[key].rarity]}</small></summary><p>{ARTIFACTS[key].text}</p></details>)}</div><div className="empty-artifacts">还有 3 个空位，留给下一次发现。</div></section>
          <section className="upgrade-panel"><div className="panel-heading"><h3>本关等级</h3><span>UPGRADES</span></div><div className="upgrade-list">{UPGRADE_KEYS.map((key) => <div key={key}><UpgradeIcon upgrade={key} size={20} /><span>{UPGRADE_NAMES[key]}</span><b>Lv.{battle.levels[key]}</b></div>)}</div></section>
        </aside>
      </div>
      <footer className="game-footer"><span>每一步，都有新的可能。</span><span>{direction.en} · STUDY {DIRECTIONS.findIndex((d) => d.key === style) + 1}/5</span></footer>
    </section>

    <section className="direction-notes"><div><span className="lab-eyebrow">DESIGN DIRECTION / 设计意图</span><h3>{direction.name}</h3><p>{direction.description}</p></div><div><span className="lab-eyebrow">代码实现</span><p>{direction.craft}</p><span className="lab-eyebrow">动效方向 · 实现成本 {direction.cost}</span><p>{direction.motion}</p></div><div><span className="lab-eyebrow">PALETTE / 调色板</span><div className="palette">{direction.colors.map((color) => <span key={color}><i style={{ background: color }} /><code>{color}</code></span>)}</div></div></section>
    <p className="lab-footnote">这是视觉与交互样本。切换风格保留局面；重置恢复相同快照。交换、计分、道具与回合沿用现有规则引擎；未接入存档、商店和整局流程。素材全部来自代码，不依赖图片或远程字体。</p>
    <dialog ref={helpRef} className="help-dialog" onCancel={() => setShowHelp(false)} onClick={(e) => { if (e.target === e.currentTarget) setShowHelp(false); }}><h2>试试同一局面的不同感觉</h2><p>点选相邻两格，同色连成 3 个就消除。点两下炸弹可原地引爆。「演示一步」会走一个合法交换，触发真实计分。</p><p>手套允许任意两格互换；放大镜使下一步倍率翻倍。神器标题可展开或收起说明。</p><p>这是一份固定中局快照，操作不写入正式游戏存档。</p><button onClick={() => setShowHelp(false)}>知道了</button></dialog>
  </div>;
}
