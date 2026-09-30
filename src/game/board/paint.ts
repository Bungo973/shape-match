// 构成风格的调色与图形，规格见 docs/VISUAL_STYLE.md。所有图形以格心为原点、以格宽 S 为尺度绘制。
import type { BombKind, Color } from '../../engine';

export const INK = '#161616';
export const PAPER = '#F2F1EC';
export const GRID_LINE = 'rgba(22,22,22,0.10)';

export const COLOR_HEX: Record<Color, string> = {
  attack: '#D6362A',
  shield: '#1D4E9E',
  poison: '#EFB622',
  catalyst: '#1F8A5B',
};

export type ShapeKind = 'circle' | 'square' | 'tri' | 'diamond';

export const COLOR_SHAPE: Record<Color, ShapeKind> = {
  attack: 'circle',
  shield: 'square',
  poison: 'tri',
  catalyst: 'diamond',
};

/** 方块在界面上的名字：只讲颜色和形状，不再有攻击、护盾等含义 */
export const COLOR_NAME: Record<Color, string> = {
  attack: '红圆',
  shield: '蓝方',
  poison: '黄三角',
  catalyst: '绿菱形',
};

const TAU = Math.PI * 2;

function poly(ctx: CanvasRenderingContext2D, pts: [number, number][]): void {
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 图形路径；r 为图形“半径” */
export function shapePath(ctx: CanvasRenderingContext2D, kind: ShapeKind, r: number): void {
  ctx.beginPath();
  switch (kind) {
    case 'circle':
      ctx.arc(0, 0, r, 0, TAU);
      break;
    case 'square':
      rrect(ctx, -r * 0.86, -r * 0.86, r * 1.72, r * 1.72, r * 0.2);
      break;
    case 'tri':
      poly(ctx, [[0, -r * 1.08], [r * 1.02, r * 0.74], [-r * 1.02, r * 0.74]]);
      break;
    case 'diamond':
      poly(ctx, [[0, -r * 1.12], [r * 0.92, 0], [0, r * 1.12], [-r * 0.92, 0]]);
      break;
  }
}

export function drawNormal(ctx: CanvasRenderingContext2D, color: Color, S: number): void {
  ctx.fillStyle = COLOR_HEX[color];
  shapePath(ctx, COLOR_SHAPE[color], S * 0.34);
  ctx.fill();
}

/**
 * 炸弹（2026-09-30 定“黑块白标”）：方块里不再有黑色，黑色专门留给炸弹。
 * 黑色圆角方块上画白色记号：直线为双向箭头，3×3 为方框加中心点，五连为四色圆点缓慢旋转。
 * t 为毫秒时间，ph 为每枚炸弹自己的相位，待机时箭头向外轻推、方框呼吸，免得整盘同步。
 */
export function drawBomb(ctx: CanvasRenderingContext2D, bomb: BombKind, S: number, t = 0, ph = 0): void {
  const h = S * 0.36;
  ctx.fillStyle = INK;
  ctx.beginPath();
  rrect(ctx, -h, -h, h * 2, h * 2, S * 0.07);
  ctx.fill();
  const k = 0.5 + 0.5 * Math.sin(t / 380 + ph);
  const w = Math.max(2, S * 0.065);
  ctx.strokeStyle = PAPER;
  ctx.fillStyle = PAPER;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (bomb === 'H' || bomb === 'V') {
    ctx.save();
    if (bomb === 'V') ctx.rotate(Math.PI / 2);
    const L = h * (0.5 + 0.12 * k);
    const a = h * 0.26;
    ctx.beginPath();
    ctx.moveTo(-L, 0);
    ctx.lineTo(L, 0);
    ctx.moveTo(L - a, -a);
    ctx.lineTo(L, 0);
    ctx.lineTo(L - a, a);
    ctx.moveTo(-L + a, -a);
    ctx.lineTo(-L, 0);
    ctx.lineTo(-L + a, a);
    ctx.stroke();
    ctx.restore();
  } else if (bomb === 'A') {
    const q = h * (0.42 + 0.1 * k);
    ctx.strokeRect(-q, -q, q * 2, q * 2);
    ctx.fillRect(-w / 2, -w / 2, w, w);
  } else {
    ctx.save();
    ctx.rotate(t / 1400 + ph);
    const d = h * 0.34;
    const r = h * 0.2;
    MULTI.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(Math.cos((i * TAU) / 4) * d, Math.sin((i * TAU) / 4) * d, r, 0, TAU);
      ctx.fill();
    });
    ctx.restore();
  }
}

const MULTI = [COLOR_HEX.attack, COLOR_HEX.shield, COLOR_HEX.poison, COLOR_HEX.catalyst];

/** 石块：只在打怪模式出现，这里给一个不抢眼的斜线方块 */
export function drawStone(ctx: CanvasRenderingContext2D, S: number): void {
  const h = S * 0.36;
  ctx.fillStyle = '#B9B5AA';
  ctx.fillRect(-h, -h, h * 2, h * 2);
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = Math.max(1.5, S * 0.04);
  ctx.beginPath();
  for (let i = -2; i <= 2; i++) {
    ctx.moveTo(-h + i * h * 0.6, h);
    ctx.lineTo(h + i * h * 0.6, -h);
  }
  ctx.save();
  ctx.clip(new Path2D(`M${-h} ${-h}h${h * 2}v${h * 2}h${-h * 2}z`));
  ctx.stroke();
  ctx.restore();
}

export function drawTri(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.beginPath();
  poly(ctx, [[0, -size * 0.6], [size * 0.55, size * 0.4], [-size * 0.55, size * 0.4]]);
  ctx.fill();
}
