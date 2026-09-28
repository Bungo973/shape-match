// 嵌片在界面上的识别样式：角标用字与主色。正式图标到位前，用字作占位图案。
import type { InsertType, Rarity } from '../engine';

export const INSERT_GLYPH: Record<InsertType, string> = {
  blade: '刃',
  bulwark: '垒',
  venomSac: '囊',
  catalystSalt: '盐',
  earthPowder: '土',
  flammable: '燃',
  emberClay: '陶',
  quakeStone: '震',
  blastPowder: '药',
};

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
