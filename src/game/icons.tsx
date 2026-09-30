// 界面里用的小图标：与棋盘同一套平涂几何图形，用 SVG 画，随文字缩放。
import type { BombKind, Color, UpgradeKey } from '../engine';
import { COLOR_HEX, INK, PAPER } from './board/paint';

export function TileIcon({ color, size = 22 }: { color: Color; size?: number }) {
  const fill = COLOR_HEX[color];
  return (
    <svg width={size} height={size} viewBox="-1 -1 2 2" aria-hidden="true">
      {color === 'attack' && <circle r="0.8" fill={fill} />}
      {color === 'shield' && <rect x="-0.72" y="-0.72" width="1.44" height="1.44" rx="0.16" fill={fill} />}
      {color === 'poison' && <polygon points="0,-0.86 0.82,0.6 -0.82,0.6" fill={fill} />}
      {color === 'catalyst' && <polygon points="0,-0.9 0.74,0 0,0.9 -0.74,0" fill={fill} />}
    </svg>
  );
}

/** 与棋盘上的“黑块白标”炸弹一致，静态版 */
export function BombIcon({ bomb, size = 22 }: { bomb: BombKind; size?: number }) {
  const w = 0.14;
  const arrow = 'M-0.46 0H0.46M0.3 -0.16L0.46 0L0.3 0.16M-0.3 -0.16L-0.46 0L-0.3 0.16';
  return (
    <svg width={size} height={size} viewBox="-1 -1 2 2" aria-hidden="true">
      <rect x="-0.86" y="-0.86" width="1.72" height="1.72" rx="0.17" fill={INK} />
      <g stroke={PAPER} strokeWidth={w} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {bomb === 'H' && <path d={arrow} />}
        {bomb === 'V' && <path d={arrow} transform="rotate(90)" />}
        {bomb === 'A' && <rect x="-0.4" y="-0.4" width="0.8" height="0.8" strokeLinecap="butt" />}
      </g>
      {bomb === 'A' && <rect x="-0.07" y="-0.07" width="0.14" height="0.14" fill={PAPER} />}
      {bomb === 'CB' &&
        [COLOR_HEX.attack, COLOR_HEX.shield, COLOR_HEX.poison, COLOR_HEX.catalyst].map((c, i) => (
          <circle key={c} cx={Math.cos((i * Math.PI) / 2) * 0.3} cy={Math.sin((i * Math.PI) / 2) * 0.3} r="0.17" fill={c} />
        ))}
    </svg>
  );
}

const BOMB_OF: Record<'line' | 'area' | 'color', BombKind> = { line: 'H', area: 'A', color: 'CB' };

export function UpgradeIcon({ upgrade, size = 22 }: { upgrade: UpgradeKey; size?: number }) {
  return upgrade === 'line' || upgrade === 'area' || upgrade === 'color' ? <BombIcon bomb={BOMB_OF[upgrade]} size={size} /> : <TileIcon color={upgrade} size={size} />;
}
