// 程序合成音效（Web Audio），不依赖音频文件，和画面一样全部由代码生成。
// 三套音色（木琴、玻璃、方波）共用同一组事件，游戏底栏可切换，便于试听比较。
// 浏览器要求在用户操作后才能发声，因此首次点击或按键时解锁。

export type SoundKit = 'wood' | 'glass' | 'chip' | 'off';

export const KIT_NAMES: Record<SoundKit, string> = { wood: '木琴', glass: '玻璃', chip: '方波', off: '静音' };

const KEY = 'score-chase/sound';
const SHEPARD_KEY = 'score-chase/shepard';

let ac: AudioContext | null = null;
let out: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let kit: SoundKit = readKit();

function readKit(): SoundKit {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'glass' || v === 'chip' || v === 'off' ? v : 'wood';
  } catch {
    return 'wood';
  }
}

let shepardOn = readShepard();

function readShepard(): boolean {
  try {
    return window.localStorage.getItem(SHEPARD_KEY) !== '0';
  } catch {
    return true;
  }
}

export const getKit = () => kit;
export const getShepard = () => shepardOn;

/** 连锁音阶用谢泼德音调：听起来一直在往上走，实际音域不变 */
export function setShepard(on: boolean): void {
  shepardOn = on;
  try {
    window.localStorage.setItem(SHEPARD_KEY, on ? '1' : '0');
  } catch {
    // 同上
  }
}

export function setKit(k: SoundKit): void {
  kit = k;
  try {
    window.localStorage.setItem(KEY, k);
  } catch {
    // 存储不可用时只在本次会话生效
  }
}

function ctx(): AudioContext | null {
  if (!ac) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ac = new Ctor();
    // 压缩器兜底：连锁时很多声音叠在一起也不会爆音
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    out = ac.createGain();
    out.gain.value = 0.55;
    out.connect(comp).connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') void ac.resume();
  return ac;
}

export function installAudioUnlock(): void {
  const unlock = () => {
    ctx();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** 同一类声音 40ms 内只响一次，避免大连锁时几十个声音同时触发 */
const lastAt = new Map<string, number>();
function gate(name: string, ms = 40): boolean {
  const now = performance.now();
  if (now - (lastAt.get(name) ?? -1e9) < ms) return false;
  lastAt.set(name, now);
  return true;
}

function ready(): AudioContext | null {
  if (kit === 'off') return null;
  const a = ctx();
  return a && out ? a : null;
}

// ---------- 基本音源 ----------

function env(a: AudioContext, g: GainNode, t: number, peak: number, attack: number, decay: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

/** 一个音符，音色由当前音色组决定；vel 为 0–1 的力度 */
function note(freq: number, vel = 0.6, delay = 0, len = 1): void {
  const a = ready();
  if (!a) return;
  const t = a.currentTime + delay;
  const peak = 0.05 + 0.25 * vel;
  if (kit === 'wood') {
    // 木琴：基音 + 约 4 倍的泛音，泛音衰减更快
    for (const [ratio, gain, decay] of [[1, 1, 0.32], [3.93, 0.35, 0.07]] as const) {
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = 'sine';
      o.frequency.value = freq * ratio;
      env(a, g, t, peak * gain, 0.003, decay * len);
      o.connect(g).connect(out!);
      o.start(t);
      o.stop(t + decay * len + 0.05);
    }
  } else if (kit === 'glass') {
    // 玻璃：调频合成的钟声，调制深度随时间回落
    const car = a.createOscillator();
    const mod = a.createOscillator();
    const mg = a.createGain();
    const g = a.createGain();
    car.frequency.value = freq;
    mod.frequency.value = freq * 3.5;
    mg.gain.setValueAtTime(freq * 1.6, t);
    mg.gain.exponentialRampToValueAtTime(freq * 0.05, t + 0.4 * len);
    mod.connect(mg).connect(car.frequency);
    env(a, g, t, peak * 0.8, 0.004, 0.7 * len);
    car.connect(g).connect(out!);
    car.start(t);
    mod.start(t);
    car.stop(t + 0.75 * len);
    mod.stop(t + 0.75 * len);
  } else {
    // 方波：短促干净的电子音
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    env(a, g, t, peak * 0.35, 0.002, 0.12 * len);
    o.connect(g).connect(out!);
    o.start(t);
    o.stop(t + 0.15 * len);
  }
}

/**
 * 谢泼德音：同一音级在 7 个八度上同时发声，音量按对数频率取钟形分布（中心在 C5 附近）。
 * 音级每升一步，高处的分音变弱、低处的分音变强，所以连续上行听起来永远在升，却不会越来越尖。
 * semis 只看它在八度内的位置。
 */
function shepard(semis: number, vel = 0.6, delay = 0, len = 1): void {
  const a = ready();
  if (!a) return;
  const t = a.currentTime + delay;
  const pc = ((semis % 12) + 12) % 12;
  const f0 = 32.7 * 2 ** (pc / 12);
  const center = Math.log2(C5);
  const decay = (kit === 'glass' ? 0.8 : kit === 'chip' ? 0.16 : 0.38) * len;
  const peak = (0.05 + 0.25 * vel) * (kit === 'chip' ? 0.3 : 0.75);
  for (let o = 0; o < 8; o++) {
    const f = f0 * 2 ** o;
    if (f < 40 || f > 9000) continue;
    const x = (Math.log2(f) - center) / 1.3;
    const amp = Math.exp(-0.5 * x * x);
    if (amp < 0.02) continue;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = kit === 'chip' ? 'triangle' : 'sine';
    osc.frequency.value = f;
    env(a, g, t, peak * amp, kit === 'glass' ? 0.006 : 0.003, decay);
    osc.connect(g).connect(out!);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }
}

/** 滤波噪声：爆炸、交换的“嗖” */
function hiss(dur: number, o: { type?: BiquadFilterType; from?: number; to?: number; gain?: number; delay?: number; q?: number } = {}): void {
  const a = ready();
  if (!a || !noiseBuf) return;
  const t = a.currentTime + (o.delay ?? 0);
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.from ?? 1000, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  const g = a.createGain();
  env(a, g, t, o.gain ?? 0.2, 0.005, dur);
  src.connect(f).connect(g).connect(out!);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

/** 低频冲击：正弦从高滑到低 */
function thump(from: number, to: number, dur: number, gain: number, delay = 0): void {
  const a = ready();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  env(a, g, t, gain, 0.004, dur);
  o.connect(g).connect(out!);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// ---------- 音阶：C 大调五声音阶，连锁每深一层往上走一级 ----------

const PENTA = [0, 2, 4, 7, 9];
const C5 = 523.25;
/** 五声音阶第 n 级相对 C 的半音数 */
const pentaSemis = (n: number) => PENTA[((n % PENTA.length) + PENTA.length) % PENTA.length]! + 12 * Math.floor(n / PENTA.length);
function degree(n: number, base = C5): number {
  const oct = Math.floor(n / PENTA.length);
  const s = PENTA[((n % PENTA.length) + PENTA.length) % PENTA.length]! + 12 * oct;
  return base * 2 ** (s / 12);
}

// ---------- 事件 ----------

export const sfx = {
  /** 选中一格 */
  select() {
    if (gate('select')) note(degree(-3), 0.15, 0, 0.4);
  },
  /** 交换 */
  swap() {
    hiss(0.08, { from: 1400, to: 3200, gain: 0.07, q: 2 });
  },
  /** 不能消除的交换：闷的一下 */
  reject() {
    thump(180, 110, 0.12, 0.25);
    note(degree(-6), 0.25, 0, 0.5);
  },
  /** 消除：主动消除为第 0 层，连锁每层升一级；清得越多越响 */
  clear(chain: number, count: number) {
    if (!gate('clear', 30)) return;
    const vel = Math.min(1, 0.35 + count / 12);
    if (shepardOn) {
      shepard(pentaSemis(chain), vel);
      if (count >= 5) shepard(pentaSemis(chain + 2), vel * 0.5, 0.03);
      return;
    }
    note(degree(chain), vel);
    if (count >= 5) note(degree(chain + 2), vel * 0.6, 0.03);
  },
  /** 做出炸弹：两音上行 */
  bombMade() {
    if (!gate('made', 60)) return;
    note(degree(5), 0.55, 0, 0.8);
    note(degree(8), 0.65, 0.07, 1.2);
  },
  /** 爆炸：直线为嗖声扫过，3×3 为低频冲击，五连为快速琶音 */
  blast(shape: string, size: number) {
    if (!gate('blast', 55)) return;
    const k = Math.min(1.4, 0.7 + size / 30);
    if (shape === 'H' || shape === 'V' || shape === 'rows3' || shape === 'cols3' || shape === 'cross') {
      hiss(0.28, { from: 500, to: 4200, gain: 0.22 * k, q: 1.5 });
      thump(160, 60, 0.18, 0.3 * k);
    } else if (shape === 'CB' || shape === 'board' || shape === 'lightning') {
      [0, 1, 2, 3, 4, 5, 7].forEach((d, i) => note(degree(d + 2), 0.45, i * 0.035, 0.7));
      hiss(0.4, { type: 'highpass', from: 3000, gain: 0.08 });
    } else {
      thump(140, 40, 0.32 * k, 0.55 * k);
      hiss(0.3 * k, { type: 'lowpass', from: 2400, to: 180, gain: 0.3 * k });
    }
  },
  /** 倍率跨过整数档 */
  multUp(tier: number) {
    if (!gate('mult', 80)) return;
    note(degree(4 + tier * 2), 0.6, 0, 1.3);
    note(degree(6 + tier * 2), 0.4, 0.05, 1.3);
  },
  /** 一步结算：分数越高，和弦越满 */
  score(points: number) {
    const n = points >= 400 ? 4 : points >= 150 ? 3 : points >= 40 ? 2 : 1;
    for (let i = 0; i < n; i++) note(degree(5 + i * 2), 0.35 + 0.1 * i, 0.04 * i, 1.4);
  },
  /** 新回合开始 */
  turn() {
    note(degree(-2), 0.25, 0, 0.6);
    note(degree(0), 0.25, 0.06, 0.6);
  },
  /** 神器在棋盘上放下炸弹、触发效果 */
  artifact() {
    note(degree(7), 0.45, 0, 1);
    note(degree(9), 0.35, 0.05, 1);
  },
  /** 过关 */
  win() {
    [0, 2, 4, 5, 7].forEach((d, i) => note(degree(d + 3), 0.55 + i * 0.05, i * 0.08, 1.6));
  },
  /** 未达标 */
  short() {
    note(degree(3), 0.45, 0, 1.4);
    note(degree(1), 0.45, 0.14, 1.4);
    note(degree(-1), 0.5, 0.28, 2);
  },
  /** 界面按钮 */
  ui() {
    if (gate('ui', 60)) note(degree(2), 0.3, 0, 0.6);
  },
};
