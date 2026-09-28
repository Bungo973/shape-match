// 界面通用组件：神器卡、嵌片卡、形状预览。
import { ARTIFACTS, INSERT_DEFS, normalize, type ArtifactKey, type InsertType, type Pos } from '../engine';
import { INSERT_GLYPH, insertCss, RARITY_TEXT } from './insertStyle';

export function InsertBadge({ type, size = 28 }: { type: InsertType; size?: number }) {
  return (
    <span className="badge" style={{ width: size, height: size, fontSize: size * 0.55, borderColor: insertCss(type), color: insertCss(type) }}>
      {INSERT_GLYPH[type]}
    </span>
  );
}

/** 小网格预览嵌片形状；highlight 为额外标出的格（相对坐标） */
export function ShapePreview({ cells, type, cell = 18 }: { cells: Pos[]; type: InsertType; cell?: number }) {
  const n = normalize(cells);
  const rows = Math.max(...n.map((p) => p.r)) + 1;
  const cols = Math.max(...n.map((p) => p.c)) + 1;
  return (
    <div className="shape" style={{ width: cols * cell, height: rows * cell }}>
      {n.map((p) => (
        <i key={`${p.r},${p.c}`} style={{ left: p.c * cell, top: p.r * cell, width: cell - 2, height: cell - 2, background: insertCss(type) }} />
      ))}
    </div>
  );
}

export function ArtifactCard({ k, onPick, compact }: { k: ArtifactKey; onPick?: () => void; compact?: boolean }) {
  const a = ARTIFACTS[k];
  return (
    <button className={`card artifact ${compact ? 'compact' : ''} ${a.cost ? 'cursed' : ''}`} onClick={onPick} disabled={!onPick}>
      <div className="card-title">
        {a.name} <small>{a.id}</small>
      </div>
      <div className="card-text">{a.text}</div>
      {a.cost && <div className="card-cost">代价：{a.cost}</div>}
    </button>
  );
}

const SLOT_TEXT = { stable: '稳定', build: '构筑', surprise: '惊喜' } as const;

export function InsertCard({
  type,
  shape,
  slot,
  placeable,
  onPick,
  selected,
}: {
  type: InsertType;
  shape: Pos[];
  slot?: keyof typeof SLOT_TEXT;
  placeable?: boolean;
  onPick?: () => void;
  selected?: boolean;
}) {
  const d = INSERT_DEFS[type];
  return (
    <button className={`card insert ${selected ? 'selected' : ''}`} onClick={onPick} disabled={!onPick}>
      {slot && <div className={`slot slot-${slot}`}>{SLOT_TEXT[slot]}</div>}
      <div className="card-title">
        <InsertBadge type={type} /> {d.name} <small className={`rarity r-${d.rarity}`}>{RARITY_TEXT[d.rarity]}</small>
      </div>
      <div className="card-shape">
        <ShapePreview cells={shape} type={type} cell={22} />
      </div>
      <div className="card-text">{d.text}</div>
      {placeable !== undefined && <div className={`card-note ${placeable ? 'ok' : 'warn'}`}>{placeable ? '当前棋盘可以嵌入' : '当前棋盘放不下，可先存入随身匣'}</div>}
    </button>
  );
}
