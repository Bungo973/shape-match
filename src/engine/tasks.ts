// 每关可选任务（2026-10-06）：开关前从一易一难两条里选一条，本关里做到就算完成，奖励在关卡结束时发（没达标也照发）。
// 易任务给金币，难任务给一件随机神器。判定只用每步日志里已有的数据，不新增结算时机。见 docs/DESIGN_JOURNAL.md。
import { createRng, mixSeed } from './rng';
import type { ActionLog } from './battle';

export type TaskKind = 'chain' | 'bigClear' | 'mult' | 'bigStep' | 'colorBombs' | 'detonations' | 'noItem' | 'speed';
export type TaskTier = 'easy' | 'hard';

export interface TaskDef {
  kind: TaskKind;
  tier: TaskTier;
  /** 门槛：单步类为这一步要达到的数，累计类为本关总数，速通为剩余步数；轻装为 1 */
  goal: number;
}

/** 关内的任务进度：单步类记最好的一步，累计类记总数 */
export interface TaskState {
  def: TaskDef;
  progress: number;
  done: boolean;
  /** 轻装：用过道具就失败 */
  failed?: boolean;
}

/** 单步类取最好的一步，累计类相加；速通与轻装在达标时判定 */
const BEST_OF: TaskKind[] = ['chain', 'bigClear', 'mult', 'bigStep'];

/**
 * 每类任务在第 level 关的易、难门槛：按熟练自动玩家每关的自然分布定，易取中位（约一半顺手完成）、难取前两成，见 BALANCE_LOG。
 * 这些数在各关之间变化不大（难度主要来自目标分），只有倍率和引爆数随关卡略升；单步高分按本关目标分的比例。
 */
export const TASK_GOALS: Record<TaskKind, (level: number, target: number) => Record<TaskTier, number>> = {
  chain: () => ({ easy: 8, hard: 10 }),
  bigClear: () => ({ easy: 130, hard: 165 }),
  mult: (l) => ({ easy: half(6 + l / 8), hard: half(7.5 + l / 4) }),
  bigStep: (_l, t) => ({ easy: Math.round(t * 0.33), hard: Math.round(t * 0.5) }),
  colorBombs: () => ({ easy: 3, hard: 6 }),
  detonations: (l) => ({ easy: 30 + l, hard: 48 + 2 * l }),
  noItem: () => ({ easy: 1, hard: 1 }),
  speed: () => ({ easy: 4, hard: 8 }),
};

/** 取到 0.5 */
function half(x: number): number {
  return Math.round(x * 2) / 2;
}

/** 只出易任务的类别（目前没有）；轻装几乎白送金币（模拟完成 79%），暂不进池 */
const EASY_ONLY: TaskKind[] = [];
const RETIRED: TaskKind[] = ['noItem'];
const KINDS = (Object.keys(TASK_GOALS) as TaskKind[]).filter((k) => !RETIRED.includes(k));

/** 第 level 关的两条候选：一易一难，类别不同；按局种子固定。exclude 为本关做不到的类别（如“低压”下的倍率） */
export function taskOptions(seed: number, level: number, target: number, exclude: TaskKind[] = []): [TaskDef, TaskDef] {
  const rng = createRng(mixSeed(seed, 0x7a5c, level));
  const pick = (pool: TaskKind[]) => pool[rng.int(pool.length)]!;
  const kinds = KINDS.filter((k) => !exclude.includes(k));
  const hardKind = pick(kinds.filter((k) => !EASY_ONLY.includes(k)));
  const easyKind = pick(kinds.filter((k) => k !== hardKind));
  return [
    { kind: easyKind, tier: 'easy', goal: TASK_GOALS[easyKind](level, target).easy },
    { kind: hardKind, tier: 'hard', goal: TASK_GOALS[hardKind](level, target).hard },
  ];
}

export function newTaskState(def: TaskDef): TaskState {
  return { def, progress: 0, done: false };
}

/** 这一步日志里与任务相关的数 */
function stepValue(kind: TaskKind, log: ActionLog): number {
  const ev = log.result.events;
  switch (kind) {
    case 'chain':
      return ev.filter((e) => e.type === 'matches' && e.phase === 'passive').length;
    case 'bigClear': {
      let n = 0;
      for (const e of ev) {
        if (e.type === 'matches') n += e.cleared.length;
        if (e.type === 'wave') n += e.cleared.length + e.consumed.length;
      }
      return n;
    }
    case 'mult':
      return log.settlement?.multiplier ?? 0;
    case 'bigStep':
      return log.settlement?.settlementScore ?? 0;
    case 'colorBombs':
      return ev.reduce((n, e) => n + (e.type === 'matches' ? e.created.filter((c) => c.bomb === 'CB').length : 0), 0);
    case 'detonations':
      return log.result.detonatedByType.line + log.result.detonatedByType.area + log.result.detonatedByType.color;
    default:
      return 0;
  }
}

/** 每走一步（含道具）更新任务进度；item 为这一步是否用了道具 */
export function updateTask(task: TaskState, log: ActionLog | null, item: boolean): void {
  if (task.done) return;
  const { kind, goal } = task.def;
  if (kind === 'noItem') {
    if (item) task.failed = true;
    return;
  }
  if (kind === 'speed' || !log) return;
  const v = stepValue(kind, log);
  task.progress = BEST_OF.includes(kind) ? Math.max(task.progress, v) : task.progress + v;
  if (task.progress >= goal) task.done = true;
}

/** 达标时判定速通与轻装 */
export function finishTask(task: TaskState, stepsLeft: number): void {
  if (task.done) return;
  if (task.def.kind === 'speed') {
    task.progress = stepsLeft;
    task.done = stepsLeft >= task.def.goal;
  }
  if (task.def.kind === 'noItem') task.done = !task.failed;
}
