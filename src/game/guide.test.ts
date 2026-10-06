// 新手引导：一步走完后挑哪一句提示
import { describe, expect, it } from 'vitest';
import { nextTip, type TipKey } from './guide';

const seen = (...k: TipKey[]) => new Set<TipKey>(k);
const step = { scored: false, hasBomb: false, ongoing: true };

describe('新手引导的提示顺序', () => {
  it('交换那句没看过时不往下讲；关卡结束时不出提示', () => {
    expect(nextTip(seen(), { ...step, scored: true })).toBeNull();
    expect(nextTip(seen('swap'), { ...step, scored: true, ongoing: false })).toBeNull();
  });

  it('得分讲计分，有炸弹讲炸弹，讲完计分再讲过关', () => {
    expect(nextTip(seen('swap'), { ...step, scored: true, hasBomb: true })).toBe('score');
    expect(nextTip(seen('swap'), { ...step, hasBomb: true })).toBe('bomb');
    expect(nextTip(seen('swap'), step)).toBeNull();
    expect(nextTip(seen('swap', 'score'), step)).toBe('goal');
    expect(nextTip(seen('swap', 'score'), { ...step, hasBomb: true })).toBe('bomb');
    expect(nextTip(seen('swap', 'score', 'bomb', 'goal'), { ...step, scored: true, hasBomb: true })).toBeNull();
  });
});
