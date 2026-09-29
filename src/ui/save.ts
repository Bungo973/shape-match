// 本地自动保存当前一局；规则版本不符时放弃旧存档，开新局。
import { RUN_RULES_VERSION, RULES_VERSION, type RunState } from '../engine';

import { BOARD_N } from './boardSize';

// 不同棋盘尺寸的原型各存各的档
const KEY = BOARD_N === 8 ? 'dixia-micang/run' : `dixia-micang/run@${BOARD_N}`;

export function loadRun(): RunState | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const run = JSON.parse(raw) as RunState;
    if (run.rulesVersion !== RUN_RULES_VERSION) return null;
    if (run.battle && run.battle.rulesVersion !== RULES_VERSION) return null;
    return run;
  } catch {
    return null;
  }
}

export function saveRun(run: RunState): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(run));
  } catch {
    // 存储不可用（隐私模式等）时不影响游戏进行
  }
}

export function clearRun(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // 同上
  }
}
