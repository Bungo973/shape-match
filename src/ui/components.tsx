// 界面通用组件：神器卡、升级卡、嵌片卡（卡牌原型用）、形状预览。
import { ARTIFACTS, DEFAULT_CONFIG, INSERT_DEFS, normalize, UPGRADE_NAMES, upgradeEffectText, type ArtifactKey, type InsertType, type Pos, type UpgradeKey } from '../engine';
import { insertCss, insertEmblem, insertSymbolSvg, RARITY_TEXT } from './insertStyle';

/** 嵌片的矢量符号（小尺寸使用） */
export function InsertSymbol({ type, size = 18 }: { type: InsertType; size?: number }) {
  return <span className="symbol" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: insertSymbolSvg(type, size) }} />;
}

export function InsertBadge({ type, size = 28 }: { type: InsertType; size?: number }) {
  return (
    <span className="badge" style={{ width: size, height: size, borderColor: insertCss(type) }}>
      <InsertSymbol type={type} size={Math.round(size * 0.7)} />
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

/** 神器图标文件名：public/game/artifact-{slug}.webp */
const artifactIcon = (k: ArtifactKey) => `/game/artifact-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}.webp`;

export function ArtifactCard({ k, onPick, compact }: { k: ArtifactKey; onPick?: () => void; compact?: boolean }) {
  const a = ARTIFACTS[k];
  return (
    <button className={`card artifact ${compact ? 'compact' : ''} ${a.cost ? 'cursed' : ''}`} onClick={onPick} disabled={!onPick}>
      {!compact && <img className="artifact-icon" src={artifactIcon(k)} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />}
      <div className="card-title">
        {compact && <img className="artifact-icon-sm" src={artifactIcon(k)} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />}
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
      <img className="insert-emblem" src={insertEmblem(type)} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
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

const UPGRADE_ICON: Record<UpgradeKey, string> = {
  attack: '/game/tile-attack.webp',
  shield: '/game/tile-shield.webp',
  poison: '/game/tile-poison.webp',
  catalyst: '/game/tile-catalyst.webp',
  line: '/game/bomb-line.webp',
  area: '/game/bomb-area.webp',
  color: '/game/bomb-color.webp',
};

/** 升级卡：展示当前等级与升级后的效果 */
export function UpgradeCard({
  upKey,
  level,
  gain = 1,
  slot,
  onPick,
  selected,
  disabled,
}: {
  upKey: UpgradeKey;
  level: number;
  gain?: number;
  slot?: keyof typeof SLOT_TEXT;
  onPick?: () => void;
  selected?: boolean;
  disabled?: boolean;
}) {
  return (
    <button className={`card upgrade ${selected ? 'selected' : ''}`} onClick={onPick} disabled={disabled || !onPick}>
      {slot && <div className={`slot slot-${slot}`}>{SLOT_TEXT[slot]}</div>}
      <img className="upgrade-icon" src={UPGRADE_ICON[upKey]} alt="" />
      <div className="card-title">{UPGRADE_NAMES[upKey]}</div>
      <div className="dim">
        {level} 级 → {level + gain} 级
      </div>
      <div className="card-text">{upgradeEffectText(upKey, level + gain, DEFAULT_CONFIG)}</div>
      <div className="card-note">当前：{upgradeEffectText(upKey, level, DEFAULT_CONFIG)}</div>
    </button>
  );
}

