// 画板式自适应（2026-10-07）：界面按固定尺寸的画板排版，再整体等比缩放到窗口里居中，任何窗口都正好一屏、不滚动。
// 横屏用 1440×960 的三栏画板，竖屏（手机）用 400×860 的单栏画板。模式写在 <html> 的 class 上（wide / narrow），
// 缩放比例写在 CSS 变量 --s 上；变化时广播 fitchange，棋盘画布据此重算分辨率。
import { useSyncExternalStore } from 'react';

export type FitMode = 'wide' | 'narrow';

export const FRAMES: Record<FitMode, { w: number; h: number }> = {
  wide: { w: 1440, h: 960 },
  narrow: { w: 400, h: 860 },
};

/** 宽屏画板缩得比这更小时（比如横过来的手机），改用竖屏画板 */
const MIN_WIDE_SCALE = 0.5;

interface Fit {
  mode: FitMode;
  s: number;
}

function compute(): Fit {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const scale = (m: FitMode) => Math.min(w / FRAMES[m].w, h / FRAMES[m].h);
  const mode: FitMode = w >= h * 0.95 && scale('wide') >= MIN_WIDE_SCALE ? 'wide' : 'narrow';
  return { mode, s: scale(mode) };
}

let fit: Fit = { mode: 'wide', s: 1 };
const listeners = new Set<() => void>();

function apply(): void {
  fit = compute();
  const root = document.documentElement;
  root.classList.toggle('wide', fit.mode === 'wide');
  root.classList.toggle('narrow', fit.mode === 'narrow');
  root.style.setProperty('--s', String(fit.s));
  root.style.setProperty('--fw', `${FRAMES[fit.mode].w}px`);
  root.style.setProperty('--fh', `${FRAMES[fit.mode].h}px`);
  window.dispatchEvent(new Event('fitchange'));
  for (const l of listeners) l();
}

/** 启动时调用一次：先算好模式和比例，再监听窗口变化 */
export function installFit(): void {
  apply();
  window.addEventListener('resize', apply);
}

/** 当前的缩放比例（棋盘画布用来算绘制分辨率） */
export const fitScale = (): number => fit.s;

/** React 里读当前模式；窗口变化时重新渲染 */
export function useFitMode(): FitMode {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => fit.mode,
  );
}
