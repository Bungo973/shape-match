// 本地自动保存冲分一局；规则版本不符时放弃旧存档，开新局。与旧界面的存档分开存放。
import { RULES_VERSION, RUN_RULES_VERSION, type RunState } from '../engine';

const KEY = 'score-chase/run';

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

// 最好成绩：通关与无尽模式都算，按到达的关卡、再按总分比较
const BEST_KEY = 'score-chase/best';

export interface Best {
  level: number;
  score: number;
}

export function loadBest(): Best | null {
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    return raw ? (JSON.parse(raw) as Best) : null;
  } catch {
    return null;
  }
}

/** 记录一局的成绩；返回是否刷新了最好成绩 */
export function recordBest(result: Best): boolean {
  const best = loadBest();
  if (best && (best.level > result.level || (best.level === result.level && best.score >= result.score))) return false;
  try {
    window.localStorage.setItem(BEST_KEY, JSON.stringify(result));
  } catch {
    // 同上
  }
  return true;
}

