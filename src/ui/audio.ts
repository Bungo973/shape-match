// 程序合成音效（Web Audio），不依赖音频文件；正式音效到位后可逐个替换。
// 浏览器要求在用户操作后才能发声，因此首次点击或按键时解锁。

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return window.localStorage.getItem('dixia-micang/muted') === '1';
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    window.localStorage.setItem('dixia-micang/muted', value ? '1' : '0');
  } catch {
    // 存储不可用时只在本次会话生效
  }
  if (master) master.gain.value = value ? 0 : 0.5;
}

function audio(): AudioContext | null {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** 在首次用户操作时解锁音频 */
export function installAudioUnlock(): void {
  const unlock = () => {
    audio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** 一个带包络的振荡音 */
function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number; slideTo?: number } = {}): void {
  const a = audio();
  if (!a || !master || muted) return;
  const t = a.currentTime + (opts.delay ?? 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur);
  const peak = opts.gain ?? 0.3;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** 一段经滤波的噪声，用于爆炸、嗖声 */
function noise(dur: number, opts: { filter?: BiquadFilterType; freq?: number; freqTo?: number; gain?: number; delay?: number } = {}): void {
  const a = audio();
  if (!a || !master || !noiseBuffer || muted) return;
  const t = a.currentTime + (opts.delay ?? 0);
  const src = a.createBufferSource();
  src.buffer = noiseBuffer;
  const f = a.createBiquadFilter();
  f.type = opts.filter ?? 'lowpass';
  f.frequency.setValueAtTime(opts.freq ?? 1200, t);
  if (opts.freqTo) f.frequency.exponentialRampToValueAtTime(opts.freqTo, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(opts.gain ?? 0.4, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

const semis = (base: number, n: number) => base * 2 ** (n / 12);

export const sfx = {
  /** 交换：短促的嗖声 */
  swap() {
    noise(0.09, { filter: 'bandpass', freq: 900, freqTo: 2400, gain: 0.18 });
  },
  /** 消除：音高随连锁层数升高（每层升两个半音） */
  pop(chain: number, count: number) {
    const base = semis(523, chain * 2);
    const n = Math.min(3, Math.max(1, Math.ceil(count / 3)));
    for (let i = 0; i < n; i++) tone(base * (1 + i * 0.25), 0.12, { type: 'triangle', gain: 0.22, delay: i * 0.035 });
  },
  /** 做出炸弹：上行琶音 */
  bombCreate() {
    [0, 4, 7, 12].forEach((s, i) => tone(semis(660, s), 0.14, { type: 'square', gain: 0.08, delay: i * 0.05 }));
  },
  /** 爆炸：噪声 + 低频冲击，size 越大越重 */
  explosion(size: number) {
    const k = Math.min(1.6, 0.6 + size / 20);
    noise(0.35 * k, { freq: 2200, freqTo: 200, gain: 0.35 * k });
    tone(110, 0.3 * k, { slideTo: 40, gain: 0.45 * k });
  },
  /** 倍率升档：明亮的和弦 */
  multiplierUp(tier: number) {
    const root = semis(523, tier * 3);
    [0, 4, 7, 12].forEach((s, i) => tone(semis(root, s), 0.35, { type: 'sawtooth', gain: 0.06, delay: i * 0.03 }));
    tone(semis(root, 24), 0.4, { gain: 0.12, delay: 0.1 });
  },
  /** 每步评价：级别越高，音越多 */
  rating(level: number) {
    const notes = [[0, 7], [0, 4, 7], [0, 4, 7, 12, 16]][Math.min(2, level - 1)]!;
    notes.forEach((s, i) => tone(semis(784, s), 0.2, { type: 'triangle', gain: 0.18, delay: i * 0.07 }));
  },
  /** 光点汇入目标 */
  absorb() {
    tone(1400, 0.06, { gain: 0.05, slideTo: 2200 });
  },
  /** 命中敌人 */
  hitEnemy(big: boolean) {
    noise(0.12, { filter: 'highpass', freq: 800, gain: 0.25 });
    tone(big ? 90 : 140, big ? 0.35 : 0.2, { slideTo: 45, gain: big ? 0.6 : 0.4 });
  },
  /** 主角受击 */
  playerHit() {
    tone(80, 0.3, { slideTo: 35, gain: 0.5 });
    noise(0.15, { freq: 600, gain: 0.25 });
  },
  /** 获得护盾 */
  shield() {
    tone(900, 0.25, { gain: 0.1, slideTo: 1800 });
    tone(1350, 0.25, { gain: 0.07, slideTo: 2700, delay: 0.04 });
  },
  /** 眩晕 */
  stun() {
    tone(1200, 0.3, { type: 'sawtooth', gain: 0.1, slideTo: 200 });
  },
};
