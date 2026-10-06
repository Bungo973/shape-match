// 界面里用的小图标：与棋盘同一套平涂几何图形，用 SVG 画，随文字缩放。
import type { BombKind, ItemKey, UpgradeKey } from '../engine';
import { COLOR_HEX, INK, PAPER } from './board/paint';

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

/** 方块基数：四色图形排成田字格，表示四色通用 */
export function BlockIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-1 -1 2 2" aria-hidden="true">
      <circle cx="-0.46" cy="-0.46" r="0.36" fill={COLOR_HEX.attack} />
      <rect x="0.12" y="-0.8" width="0.68" height="0.68" rx="0.08" fill={COLOR_HEX.shield} />
      <polygon points="-0.46,0.08 -0.08,0.8 -0.84,0.8" fill={COLOR_HEX.poison} />
      <polygon points="0.46,0.06 0.82,0.46 0.46,0.86 0.1,0.46" fill={COLOR_HEX.catalyst} />
    </svg>
  );
}

export function UpgradeIcon({ upgrade, size = 22 }: { upgrade: UpgradeKey; size?: number }) {
  return upgrade === 'block' ? <BlockIcon size={size} /> : <BombIcon bomb={BOMB_OF[upgrade]} size={size} />;
}

/** 道具图标：同一套平涂几何语言 */
export function ItemIcon({ item, size = 22 }: { item: ItemKey; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-1 -1 2 2" aria-hidden="true">
      {item === 'glove' && (
        <g>
          <rect x="-0.86" y="-0.3" width="0.6" height="0.6" rx="0.06" fill={COLOR_HEX.attack} />
          <rect x="0.26" y="-0.3" width="0.6" height="0.6" rx="0.06" fill={COLOR_HEX.shield} />
          <path d="M-0.56 -0.48 Q0 -1 0.56 -0.48 M0.56 0.48 Q0 1 -0.56 0.48" fill="none" stroke={INK} strokeWidth="0.13" />
          <path d="M0.36 -0.62 L0.58 -0.46 L0.62 -0.74 M-0.36 0.62 L-0.58 0.46 L-0.62 0.74" fill="none" stroke={INK} strokeWidth="0.13" strokeLinejoin="round" />
        </g>
      )}
      {item === 'dropper' && (
        // 吸管：斜放的黑管，尖端滴下一滴红
        <g>
          <g transform="rotate(45)">
            <rect x="-0.16" y="-0.95" width="0.32" height="0.42" rx="0.08" fill={INK} />
            <rect x="-0.1" y="-0.55" width="0.2" height="0.95" fill={INK} />
          </g>
          <circle cx="-0.52" cy="0.62" r="0.24" fill={COLOR_HEX.attack} />
        </g>
      )}
      {item === 'shuffle' && (
        <g transform="rotate(12)">
          <rect x="-0.8" y="-0.8" width="0.7" height="0.7" fill={COLOR_HEX.attack} />
          <rect x="0.1" y="-0.8" width="0.7" height="0.7" fill={COLOR_HEX.poison} />
          <rect x="-0.8" y="0.1" width="0.7" height="0.7" fill={COLOR_HEX.catalyst} />
          <rect x="0.1" y="0.1" width="0.7" height="0.7" fill={COLOR_HEX.shield} />
        </g>
      )}
      {item === 'magnifier' && (
        // 放大镜：黄色镜片、黑框、黑柄
        <g>
          <circle cx="-0.2" cy="-0.2" r="0.52" fill={COLOR_HEX.poison} stroke={INK} strokeWidth="0.16" />
          <rect x="0.22" y="0.3" width="0.62" height="0.24" fill={INK} transform="rotate(45 0.22 0.3)" />
        </g>
      )}
      {item === 'echo' && (
        // 回声：一个实心红圆，外面两圈逐渐变细的黑弧
        <g>
          <circle cx="-0.45" cy="0" r="0.3" fill={COLOR_HEX.attack} />
          <path d="M-0.05 -0.5 A0.62 0.62 0 0 1 -0.05 0.5" fill="none" stroke={INK} strokeWidth="0.16" />
          <path d="M0.35 -0.78 A0.95 0.95 0 0 1 0.35 0.78" fill="none" stroke={INK} strokeWidth="0.1" />
        </g>
      )}
    </svg>
  );
}
