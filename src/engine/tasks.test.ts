import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import { useItem } from './battle';
import { levelInfo, levelTasks, newRun, pickStarter, runAction, runEndTurn, startNextBattle, type RunResult, type RunState } from './run';
import { finishTask, newTaskState, taskOptions, updateTask, type TaskDef } from './tasks';
import { boardWith } from './test-utils';

const config = { ...DEFAULT_CONFIG, scoreMode: true };
const ok = (r: RunResult): RunState => {
  if (!r.ok) throw new Error(r.reason);
  return r.run;
};

describe('任务候选', () => {
  it('每关一易一难、类别不同；同种子相同；轻装不进池', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (let level = 1; level <= 9; level++) {
        const [easy, hard] = taskOptions(seed, level, 3000);
        expect(easy.tier).toBe('easy');
        expect(hard.tier).toBe('hard');
        expect(easy.kind).not.toBe(hard.kind);
        expect([easy.kind, hard.kind]).not.toContain('noItem');
        expect(taskOptions(seed, level, 3000)).toEqual([easy, hard]);
      }
    }
  });
});

/** 冲分第一关，选第 index 条任务，并把任务换成指定的 def */
function withTask(def: TaskDef, board: Record<string, string> = { '4,0': 'H' }): RunState {
  let run = newRun(4, config);
  run = ok(pickStarter(run, run.starterChoices[0]!));
  run = ok(startNextBattle(run, config, 0));
  run.battle!.task = newTaskState(def);
  run.battle!.board = boardWith(board);
  return run;
}

describe('任务进度与奖励', () => {
  it('引爆类累计；达到门槛即完成，易任务给金币', () => {
    const run = withTask({ kind: 'detonations', tier: 'easy', goal: 1 });
    run.battle!.goal = { target: 1, turns: 5 };
    const won = ok(runAction(run, { type: 'ignite', at: { r: 4, c: 0 } }, config));
    expect(won.taskResult).toMatchObject({ done: true, gold: config.taskGold });
    expect(won.income!.task).toBe(config.taskGold);
  });

  it('难任务给一件没有的神器；神器栏满时改给金币', () => {
    const run = withTask({ kind: 'detonations', tier: 'hard', goal: 1 });
    run.battle!.goal = { target: 1, turns: 5 };
    const before = run.artifacts.length;
    const won = ok(runAction(run, { type: 'ignite', at: { r: 4, c: 0 } }, config));
    expect(won.taskResult!.artifact).toBeTruthy();
    expect(won.artifacts).toHaveLength(before + 1);
    const full = withTask({ kind: 'detonations', tier: 'hard', goal: 1 });
    full.battle!.goal = { target: 1, turns: 5 };
    full.artifacts = ['redNose', 'banana', 'loner', 'smallStep', 'piggyBank', 'goldWatch'];
    const paid = ok(runAction(full, { type: 'ignite', at: { r: 4, c: 0 } }, config));
    expect(paid.taskResult).toMatchObject({ done: true, artifact: null, gold: config.taskFullGold });
  });

  it('没达标也照发任务奖励', () => {
    const run = withTask({ kind: 'detonations', tier: 'easy', goal: 1 });
    let r = ok(runAction(run, { type: 'ignite', at: { r: 4, c: 0 } }, config));
    // 只差 1 分没达标：扣一点血，本局继续
    r.battle!.goal = { target: r.battle!.totalScore + 1, turns: 5 };
    r.battle!.turn = 5;
    r.battle!.ap = 0;
    r = ok(runEndTurn(r, config));
    expect(r.battle!.totalScore).toBeLessThan(r.battle!.goal!.target);
    expect(r.taskResult).toMatchObject({ done: true, gold: config.taskGold });
  });

  it('速通看达标时剩下的步数；轻装用过道具就失败', () => {
    const speed = newTaskState({ kind: 'speed', tier: 'easy', goal: 4 });
    finishTask(speed, 5);
    expect(speed.done).toBe(true);
    const slow = newTaskState({ kind: 'speed', tier: 'hard', goal: 8 });
    finishTask(slow, 5);
    expect(slow.done).toBe(false);
    const run = withTask({ kind: 'noItem', tier: 'easy', goal: 1 });
    const used = useItem(run.battle!, { key: 'shuffle' }, config);
    if (!used.ok) throw new Error(used.reason);
    expect(used.state.task!.failed).toBe(true);
    finishTask(used.state.task!, 10);
    expect(used.state.task!.done).toBe(false);
  });

  it('单步类记最好的一步，不累加', () => {
    const t = newTaskState({ kind: 'mult', tier: 'easy', goal: 100 });
    const log = (m: number) => ({ result: { events: [], detonatedByType: { line: 0, area: 0, color: 0 } }, settlement: { multiplier: m } }) as never;
    updateTask(t, log(3), false);
    updateTask(t, log(2), false);
    expect(t.progress).toBe(3);
  });

  it('开关时带上选中的任务（0 易、1 难）', () => {
    let run = newRun(4, config);
    run = ok(pickStarter(run, run.starterChoices[0]!));
    const [, hard] = levelTasks(run, 1, config);
    expect(ok(startNextBattle(run, config, 1)).battle!.task!.def).toEqual(hard);
  });
});

describe('任务与首领规则', () => {
  it('“低压”关不出倍率任务', () => {
    let checked = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const run = newRun(seed, config);
      for (const level of [3, 6, 9]) {
        if (levelInfoRule(run, level) !== 'lowCap') continue;
        checked++;
        expect(levelTasks(run, level, config).map((t) => t.kind)).not.toContain('mult');
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});

function levelInfoRule(run: RunState, level: number) {
  return levelInfo(run, level, config).rule;
}
