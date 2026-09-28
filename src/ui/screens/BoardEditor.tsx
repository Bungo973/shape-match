// 棋盘调整（非战斗阶段）：从随身匣选嵌片、旋转、预览合法落位、确认嵌入。嵌入即固定。
import { useEffect, useMemo, useState } from 'react';
import { canPlace, DEFAULT_CONFIG, INSERT_DEFS, normalize, rotate, type Pos, type RunState } from '../../engine';
import { InsertBadge, InsertSymbol, ShapePreview } from '../components';
import { insertCss } from '../insertStyle';

const CELL = 60;
const SIZE = { rows: DEFAULT_CONFIG.rows, cols: DEFAULT_CONFIG.cols };

export function BoardEditor({
  run,
  onInstall,
  onClose,
}: {
  run: RunState;
  onInstall: (inventoryId: string, cells: Pos[]) => string | null;
  onClose: () => void;
}) {
  const [selId, setSelId] = useState<string | null>(run.inventory[0]?.id ?? null);
  const selected = run.inventory.find((i) => i.id === selId) ?? null;
  const [shape, setShape] = useState<Pos[]>(() => (selected ? normalize(selected.shape) : []));
  const [hover, setHover] = useState<Pos | null>(null);
  const [pending, setPending] = useState<Pos[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setShape(selected ? normalize(selected.shape) : []);
    setPending(null);
  }, [selId]); // eslint-disable-line react-hooks/exhaustive-deps

  const spin = () => {
    if (pending) return;
    setShape((s) => (s.length ? rotate(s) : s));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') spin();
      if (e.key === 'Escape') (pending ? setPending(null) : onClose());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // 预览：以形状包围盒中心对齐鼠标所在格
  const preview = useMemo(() => {
    if (pending) return pending;
    if (!selected || !hover || shape.length === 0) return null;
    const cr = Math.floor(Math.max(...shape.map((p) => p.r)) / 2);
    const cc = Math.floor(Math.max(...shape.map((p) => p.c)) / 2);
    return shape.map((p) => ({ r: hover.r + p.r - cr, c: hover.c + p.c - cc }));
  }, [pending, selected, hover, shape]);
  const legal = preview ? canPlace(SIZE, run.installed, preview, DEFAULT_CONFIG.maxInstalledInserts) : false;
  const inPreview = (r: number, c: number) => preview?.some((p) => p.r === r && p.c === c) ?? false;

  const confirm = () => {
    if (!selected || !pending) return;
    const err = onInstall(selected.id, pending);
    if (err) {
      setError(err);
      return;
    }
    setPending(null);
    setError('');
    setSelId(run.inventory.find((i) => i.id !== selected.id)?.id ?? null);
  };

  return (
    <div className="screen editor">
      <h2>调整棋盘</h2>
      <p className="sub">嵌入后固定，不能移动、旋转或取下；只有商店或特殊事件能取出。按 R 或右键旋转。</p>
      <div className="editor-body">
        <div
          className="editor-board"
          style={{ width: CELL * SIZE.cols, height: CELL * SIZE.rows }}
          onMouseLeave={() => setHover(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            spin();
          }}
        >
          {Array.from({ length: SIZE.rows }, (_, r) =>
            Array.from({ length: SIZE.cols }, (_, c) => {
              const owner = run.installed.find((i) => i.cells.some((p) => p.r === r && p.c === c));
              const pv = inPreview(r, c);
              return (
                <div
                  key={`${r},${c}`}
                  className={`ecell ${pv ? (pending ? 'pending' : legal ? 'legal' : 'illegal') : ''}`}
                  style={{ left: c * CELL, top: r * CELL, width: CELL, height: CELL, ...(owner ? { background: `${insertCss(owner.type)}33`, borderColor: insertCss(owner.type) } : {}) }}
                  onMouseEnter={() => setHover({ r, c })}
                  onClick={() => {
                    if (pending || !preview) return;
                    if (legal) setPending(preview);
                  }}
                >
                  {owner && <InsertSymbol type={owner.type} size={24} />}
                </div>
              );
            }),
          )}
        </div>

        <div className="editor-side">
          <h3>随身匣</h3>
          {run.inventory.length === 0 && <p className="sub">随身匣是空的。</p>}
          {run.inventory.map((i) => (
            <button key={i.id} className={`inv ${i.id === selId ? 'on' : ''}`} onClick={() => setSelId(i.id)}>
              <InsertBadge type={i.type} /> {INSERT_DEFS[i.type].name}
              <ShapePreview cells={i.shape} type={i.type} cell={12} />
            </button>
          ))}
          <p className="sub">
            已安装 {run.installed.length} / {DEFAULT_CONFIG.maxInstalledInserts}
          </p>
          {selected && !pending && (
            <button onClick={spin}>
              旋转 <small>R</small>
            </button>
          )}
          {pending && selected && (
            <div className="confirm">
              <p>把「{INSERT_DEFS[selected.type].name}」嵌入这里？嵌入后固定。</p>
              <button onClick={confirm}>确认嵌入</button>
              <button onClick={() => setPending(null)}>重新摆放</button>
            </div>
          )}
          {error && <p className="warn">{error}</p>}
          <button className="close" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
