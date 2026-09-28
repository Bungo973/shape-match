// 营地升级：选一块拥有的嵌片，再点选要添加的正交相邻格（精工刻刀可选两格）。
import { useState } from 'react';
import { DEFAULT_CONFIG, expansionCells, INSERT_DEFS, inventoryExpansionCells, upgradeCellCount, type Pos, type RunState } from '../../engine';
import { InsertBadge, InsertSymbol } from '../components';
import { insertCss } from '../insertStyle';

const SIZE = { rows: DEFAULT_CONFIG.rows, cols: DEFAULT_CONFIG.cols };
const same = (a: Pos, b: Pos) => a.r === b.r && a.c === b.c;

export function UpgradePicker({ run, onUpgrade, onCancel }: { run: RunState; onUpgrade: (id: string, cells: Pos[]) => string | null; onCancel: () => void }) {
  const owned = [...run.installed.map((i) => ({ id: i.id, type: i.type, installed: true })), ...run.inventory.map((i) => ({ id: i.id, type: i.type, installed: false }))];
  const [targetId, setTargetId] = useState<string | null>(owned[0]?.id ?? null);
  const [chosen, setChosen] = useState<Pos[]>([]);
  const [error, setError] = useState('');
  const max = upgradeCellCount(run);

  const installed = run.installed.find((i) => i.id === targetId);
  const stored = run.inventory.find((i) => i.id === targetId);
  const type = installed?.type ?? stored?.type;

  // 已选的格也算进形状，第二格的合法位置随之更新
  let shape: Pos[] = [];
  let legal: Pos[] = [];
  if (installed) {
    const grown = { ...installed, cells: [...installed.cells, ...chosen] };
    shape = grown.cells;
    legal = chosen.length < max ? expansionCells(SIZE, run.installed.map((i) => (i.id === grown.id ? grown : i)), grown) : [];
  } else if (stored) {
    shape = [...stored.shape, ...chosen];
    legal = chosen.length < max ? inventoryExpansionCells(shape) : [];
  }

  // 已安装的在整张棋盘上选；随身匣的在形状周围的小网格上选
  const all = [...shape, ...legal];
  const bounds = installed
    ? { r0: 0, r1: SIZE.rows - 1, c0: 0, c1: SIZE.cols - 1 }
    : { r0: Math.min(...all.map((p) => p.r)), r1: Math.max(...all.map((p) => p.r)), c0: Math.min(...all.map((p) => p.c)), c1: Math.max(...all.map((p) => p.c)) };
  const cell = installed ? 44 : 52;

  const pickTarget = (id: string) => {
    setTargetId(id);
    setChosen([]);
    setError('');
  };

  return (
    <div className="upgrade">
      <div className="upgrade-list">
        {owned.map((o) => (
          <button key={o.id} className={`inv ${o.id === targetId ? 'on' : ''}`} onClick={() => pickTarget(o.id)}>
            <InsertBadge type={o.type} /> {INSERT_DEFS[o.type].name} <small>{o.installed ? '已安装' : '随身匣'}</small>
          </button>
        ))}
      </div>
      {type && (
        <div className="upgrade-grid" style={{ width: (bounds.c1 - bounds.c0 + 1) * cell, height: (bounds.r1 - bounds.r0 + 1) * cell }}>
          {Array.from({ length: bounds.r1 - bounds.r0 + 1 }, (_, i) =>
            Array.from({ length: bounds.c1 - bounds.c0 + 1 }, (_, j) => {
              const p = { r: bounds.r0 + i, c: bounds.c0 + j };
              const mine = shape.some((q) => same(q, p));
              const isNew = chosen.some((q) => same(q, p));
              const other = installed ? run.installed.find((x) => x.id !== installed.id && x.cells.some((q) => same(q, p))) : undefined;
              const can = legal.some((q) => same(q, p));
              return (
                <div
                  key={`${p.r},${p.c}`}
                  className={`ucell ${mine ? 'mine' : ''} ${isNew ? 'new' : ''} ${can ? 'can' : ''}`}
                  style={{
                    left: j * cell,
                    top: i * cell,
                    width: cell,
                    height: cell,
                    ...(mine ? { background: `${insertCss(type)}55`, borderColor: insertCss(type) } : {}),
                    ...(other ? { background: `${insertCss(other.type)}22` } : {}),
                  }}
                  onClick={() => can && setChosen([...chosen, p])}
                >
                  {mine && (isNew ? <span style={{ color: insertCss(type) }}>+</span> : <InsertSymbol type={type} size={26} />)}
                  {other && <span style={{ opacity: 0.5 }}><InsertSymbol type={other.type} size={22} /></span>}
                </div>
              );
            }),
          )}
        </div>
      )}
      <div className="upgrade-actions">
        <p className="sub">
          点选高亮格添加覆盖范围（{chosen.length} / {max}），花费 {DEFAULT_CONFIG.upgradeCost} 金币。
        </p>
        {error && <p className="warn">{error}</p>}
        <button
          disabled={chosen.length === 0}
          onClick={() => {
            const err = onUpgrade(targetId!, chosen);
            if (err) setError(err);
          }}
        >
          确认升级
        </button>
        <button onClick={() => setChosen([])} disabled={chosen.length === 0}>
          重选
        </button>
        <button onClick={onCancel}>返回</button>
      </div>
    </div>
  );
}
