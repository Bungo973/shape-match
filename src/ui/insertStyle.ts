// 嵌片在界面上的识别样式。
// 大尺寸（奖励卡、列表）用美术标志图片；小尺寸（棋盘格角标、徽章）用下面的矢量符号，
// 符号按外轮廓区分，缩到 16 像素仍可辨认。网页与 Pixi 棋盘共用同一份符号定义。
import type { InsertType, Rarity } from '../engine';

export const INSERT_HEX: Record<InsertType, number> = {
  blade: 0x9fd3ff,
  bulwark: 0xffd166,
  venomSac: 0x7dff8a,
  catalystSalt: 0xff8cf0,
  earthPowder: 0xd9a066,
  flammable: 0xff6b3d,
  emberClay: 0xffa05c,
  quakeStone: 0xb0a4ff,
  blastPowder: 0xff4a4a,
};

export const insertCss = (t: InsertType) => `#${INSERT_HEX[t].toString(16).padStart(6, '0')}`;

export const RARITY_TEXT: Record<Rarity, string> = { common: '普通', rare: '稀有', epic: '高级', perfect: '完美' };

/** 美术标志图片：public/game/insert-{slug}.webp */
export const insertEmblem = (t: InsertType) => `/game/insert-${t.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}.webp`;

const star = (points: number, outer: number, inner: number) => {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / points - Math.PI / 2;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)},${(12 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(' ')}"/>`;
};

/** 24×24 坐标系中的符号图形（不含颜色） */
const SYMBOL_SHAPES: Record<InsertType, string> = {
  // 锋刃：向前推进的尖角
  blade: '<path d="M3 4 L22 12 L3 20 L9 12 Z"/>',
  // 壁垒：拱门
  bulwark: '<path d="M3 21 L3 11 A9 9 0 0 1 21 11 L21 21 L16 21 L16 13 A4 4 0 0 0 8 13 L8 21 Z"/>',
  // 毒囊：鼓胀的囊泡与一个小气泡
  venomSac: '<circle cx="10.5" cy="13.5" r="8"/><circle cx="19.5" cy="4.5" r="3"/>',
  // 催化盐：堆叠的盐晶
  catalystSalt: '<rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/><rect x="8" y="3" width="8" height="8"/>',
  // 土质火药：三颗颗粒排成三角
  earthPowder: '<circle cx="12" cy="5.5" r="3.6"/><circle cx="5" cy="17.5" r="3.6"/><circle cx="19" cy="17.5" r="3.6"/>',
  // 易燃物质：火苗
  flammable: '<path d="M12 2 C15 8 20 10 20 15 A8 8 0 0 1 4 15 C4 10 9 8 12 2 Z"/>',
  // 火星陶：不规则碎片
  emberClay: '<path d="M4 8 L13 2.5 L21.5 9 L17.5 21.5 L6.5 18.5 Z"/>',
  // 震裂石：四向裂开的尖星
  quakeStone: star(4, 11, 3.2),
  // 火药嵌片：向外爆发的八角星
  blastPowder: star(8, 11.5, 5.5),
};

/** 完整的 SVG 字符串：带深色描边，保证在任何底色上都清楚 */
export function insertSymbolSvg(t: InsertType, size = 24): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"><g fill="${insertCss(t)}" stroke="#101010" stroke-width="1.6" stroke-linejoin="round">${SYMBOL_SHAPES[t]}</g></svg>`;
}
