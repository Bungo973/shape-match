// 棋盘尺寸开关：默认取引擎配置（2026-09-29 定为 10×10），网址加 ?board=8 或 ?board=9 可对比。
// 必须最先导入：在任何模块读取默认配置之前改写棋盘尺寸。敌人数值不随尺寸调整。
import { DEFAULT_CONFIG } from '../engine';

const n = Number(new URLSearchParams(window.location.search).get('board'));
export const BOARD_N = Number.isInteger(n) && n >= 6 && n <= 12 ? n : DEFAULT_CONFIG.rows;
DEFAULT_CONFIG.rows = BOARD_N;
DEFAULT_CONFIG.cols = BOARD_N;
