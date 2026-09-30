// 玩法开关（2026-09-30 原型）：网址加 ?mode=score 进入冲分模式，每关在限定回合内凑够目标分；
// 缺省为打怪模式。与 boardSize 一样须在读取默认配置前导入。
import { DEFAULT_CONFIG } from '../engine';

export const SCORE_MODE = new URLSearchParams(window.location.search).get('mode') === 'score';
DEFAULT_CONFIG.scoreMode = SCORE_MODE;
