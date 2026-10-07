// 构成风格的棋盘：Canvas 2D 绘制，gsap 负责时间线。只负责展示和发出动作，规则全部来自引擎的事件日志。
// 播放顺序沿用旧舞台的因果排期：爆炸在来源炸弹被波及时点燃，下落按列各自进行，之后的匹配等涉及的列落定。
import gsap from 'gsap';
import { posKey, samePos, type Board, type Explosion, type Pos, type ResolutionEvent, type Tile } from '../../engine';
import { sfx } from '../audio';
import { COLOR_HEX, drawBomb, drawNormal, drawStone, drawTri, GRID_LINE, INK, PAPER, BOARD_BG } from './paint';

/** 拖过这么多格就算交换（拖动跟手在此之前） */
const DRAG_SWAP = 0.35;
const REDUCED = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
// 减少动态效果：所有时长乘 0.35
if (REDUCED) gsap.globalTimeline.timeScale(1 / 0.35);

// 时长（秒），见 VISUAL_STYLE「动作」
const SWAP = 0.17;
const CLEAR = 0.23;
const CLEAR_BLAST = 0.3;
/** 消除播到这个比例时，上方方块就开始下落，不等消除完全结束 */
const FALL_OVERLAP = 0.55;
/** 下落时长 = 系数 × √格数：同一加速度，整列像一个整体一起落下，不会被拉开 */
const FALL_K = 0.16;
/** 被波及的炸弹要等这么久才点燃，让接力看得出先后 */
const FUSE = 0.07;
const MORPH = 0.14;

interface Sprite {
  id: number;
  tile: Tile;
  /** 以格为单位的位置 */
  x: number;
  y: number;
  s: number;
  a: number;
  rot: number;
  /** 落地压扁 0..1 */
  sq: number;
  /** 鼠标悬停的放大程度 0..1，逐帧趋向目标 */
  h?: number;
}

interface Blast {
  e: Explosion;
  life: number;
  max: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  life: number;
  max: number;
  size: number;
  color: string;
  tri: boolean;
}

interface Pop {
  x: number;
  y: number;
  text: string;
  sub: string;
  life: number;
  max: number;
  big: boolean;
}

interface Ring {
  x: number;
  y: number;
  life: number;
  max: number;
}

export interface BoardHandlers {
  onSwap(from: Pos, to: Pos): void;
  onIgnite(at: Pos): void;
  /** 道具选格：选一格（锤子、炸药包）或相邻两格（手套） */
  onPickCell?(at: Pos): void;
  onPickPair?(from: Pos, to: Pos): void;
  /** 播放中被动清除累计变化，供倍率槽实时显示 */
  onChain?(passive: number, chain: number): void;
  /** 玩家碰了棋盘（按下或按键），用于重置提示的计时 */
  onActivity?(): void;
}

export class BoardView {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites = new Map<number, Sprite>();
  private grid: (number | null)[][] = [];
  private rows = 0;
  private cols = 0;
  private W = 0;
  private dpr = 1;
  private blasts: Blast[] = [];
  private particles: Particle[] = [];
  private pops: Pop[] = [];
  private rings: Ring[] = [];
  private shake = 0;
  private raf = 0;
  private last = 0;
  private sel: Pos | null = null;
  /** 选中后经过的毫秒：选中的方块回弹放大，然后轻轻上下浮动 */
  private selT = 0;
  /** 电脑上鼠标悬停的格（触屏不记） */
  private hover: Pos | null = null;
  private drag: { p: Pos; x: number; y: number } | null = null;
  /** 拖动中跟着手指挪开的那块方块，松手没交换时弹回原位 */
  private dragged: Sprite | null = null;
  private cursor: Pos = { r: 0, c: 0 };
  private showCursor = false;
  private readonly ro: ResizeObserver;
  private readonly listeners = new AbortController();
  /** 播放或等待引擎时为 true，期间不接受输入 */
  busy = false;
  /** 道具选格模式；null 为普通的交换与点燃 */
  /** 道具选格：cell 选一格，pair 选相邻两格（吸管），any 选任意两格（手套） */
  private pick: 'cell' | 'pair' | 'any' | null = null;
  /** 弱引导：停手一会儿后提示的一步，两格朝对方轻轻顶一顶 */
  private hint: { a: Pos; b: Pos; t: number } | null = null;

  showHint(a: Pos, b: Pos): void {
    if (REDUCED) return;
    this.hint = { a, b, t: 0 };
  }

  clearHint(): void {
    this.hint = null;
  }

  /** 提示中某格的偏移（以格为单位）：每 1.8 秒朝对方顶两下 */
  private hintOffset(p: Pos): { x: number; y: number } {
    const h = this.hint;
    if (!h) return { x: 0, y: 0 };
    const other = p.r === h.a.r && p.c === h.a.c ? h.b : p.r === h.b.r && p.c === h.b.c ? h.a : null;
    if (!other) return { x: 0, y: 0 };
    const phase = (h.t % 1800) / 1800;
    const k = phase < 0.36 ? Math.abs(Math.sin((phase / 0.36) * Math.PI * 2)) * 0.1 : 0;
    return { x: (other.c - p.c) * k, y: (other.r - p.r) * k };
  }

  setPick(mode: 'cell' | 'pair' | 'any' | null): void {
    this.pick = mode;
    this.sel = null;
    this.canvas.style.cursor = mode ? 'crosshair' : '';
  }

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly handlers: BoardHandlers,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement!);
    this.resize();
    this.bind();
    this.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(50, now - this.last);
      this.last = now;
      this.draw(dt);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  destroy(): void {
    // 解绑画布上的输入：开发模式下 React 会把棋盘挂载两次，旧视图不解绑就会继续收点击，和新视图抢着处理
    this.listeners.abort();
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const s of this.sprites.values()) gsap.killTweensOf(s);
  }

  private resize(): void {
    const w = this.canvas.parentElement!.clientWidth;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = w;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(w * this.dpr);
  }

  private get S(): number {
    return this.cols ? this.W / this.cols : 0;
  }

  // ---------- 与引擎状态同步 ----------

  /** 以棋盘为准重建显示：已有的方块就地更新，新出现的弹入，消失的移除 */
  sync(board: Board, popIn = false): void {
    this.rows = board.length;
    this.cols = board[0]?.length ?? 0;
    const seen = new Set<number>();
    this.grid = board.map((row, r) =>
      row.map((t, c) => {
        if (!t) return null;
        seen.add(t.id);
        let s = this.sprites.get(t.id);
        if (!s) {
          s = { id: t.id, tile: t, x: c, y: r, s: popIn ? 0 : 1, a: 1, rot: 0, sq: 0 };
          this.sprites.set(t.id, s);
          if (popIn) gsap.to(s, { s: 1, duration: 0.32, delay: (r + c) * 0.012, ease: 'back.out(2)' });
        }
        s.tile = t;
        s.x = c;
        s.y = r;
        return t.id;
      }),
    );
    for (const [id, s] of this.sprites) {
      if (seen.has(id)) continue;
      gsap.killTweensOf(s);
      this.sprites.delete(id);
    }
    if (this.sel && !this.grid[this.sel.r]?.[this.sel.c]) this.sel = null;
  }

  private spriteAt(p: Pos): Sprite | undefined {
    const id = this.grid[p.r]?.[p.c];
    return id == null ? undefined : this.sprites.get(id);
  }

  clearSelection(): void {
    this.sel = null;
  }

  // ---------- 播放引擎事件 ----------

  async play(events: ResolutionEvent[], finalBoard: Board): Promise<void> {
    const master = gsap.timeline();
    let passive = 0;
    let chain = 0;
    const settled = new Array<number>(this.cols).fill(0);
    const clearEnd = new Array<number>(this.cols).fill(0);
    let hitAt = new Map<number, number>();
    let cursor = 0;
    const settledOf = (ps: Pos[]) => Math.max(0, ...ps.map((p) => settled[p.c] ?? 0));
    const markCleared = (t: number, p: Pos, dur: number) => {
      clearEnd[p.c] = Math.max(clearEnd[p.c]!, t + dur * FALL_OVERLAP);
      hitAt.set(posKey(p), t);
    };
    const reportChain = (t: number, n: number) => {
      if (n <= 0) return;
      passive += n;
      chain++;
      const p = passive;
      const k = chain;
      master.call(() => this.handlers.onChain?.(p, k), [], t);
    };

    for (const ev of events) {
      switch (ev.type) {
        case 'swap': {
          master.call(() => sfx.swap(), [], cursor);
          master.add(this.swapTl(ev.from, ev.to), cursor);
          cursor += SWAP;
          settled.fill(cursor);
          clearEnd.fill(cursor);
          break;
        }
        case 'paint': {
          // 吸管：那一格就地换成新颜色并脉冲一下
          master.call(() => sfx.select(), [], cursor);
          this.morph(master, ev.at, ev.id, ev.tile, cursor);
          const sp = this.sprites.get(ev.id);
          if (sp) master.fromTo(sp, { s: 0.6 }, { s: 1, duration: 0.24, ease: 'back.out(3)' }, cursor);
          cursor += 0.22;
          settled.fill(cursor);
          clearEnd.fill(cursor);
          break;
        }
        case 'ignite': {
          const s = this.spriteAt(ev.at);
          if (s) master.to(s, { s: 1.3, duration: 0.09, yoyo: true, repeat: 1, ease: 'power1.out' }, cursor);
          cursor += 0.18;
          settled.fill(cursor);
          clearEnd.fill(cursor);
          break;
        }
        case 'matches': {
          const cells = [...ev.cleared.map((c) => c.pos), ...ev.created.map((b) => b.at)];
          const start = Math.max(cursor, settledOf(cells));
          hitAt = new Map();
          for (const c of ev.cleared) {
            const s = this.sprites.get(c.id);
            if (s) master.add(this.clearTl(s, CLEAR), start);
            this.grid[c.pos.r]![c.pos.c] = null;
            markCleared(start, c.pos, CLEAR);
          }
          for (const b of ev.created) {
            this.morph(master, b.at, b.id, { id: b.id, kind: 'bomb', bomb: b.bomb }, start + MORPH);
            hitAt.set(posKey(b.at), start + MORPH);
          }
          if (ev.phase === 'passive') reportChain(start, ev.cleared.length);
          {
            const depth = ev.phase === 'passive' ? chain : 0;
            const n = ev.cleared.length;
            if (n > 0) master.call(() => sfx.clear(depth, n), [], start);
            if (ev.created.length) master.call(() => sfx.bombMade(), [], start + MORPH);
          }
          cursor = start;
          break;
        }
        case 'wave': {
          // 每个爆炸的点燃时刻：来源炸弹被波及的时刻（首波由玩家动作或匹配直接点燃）
          const ignite = ev.explosions.map((e) => {
            const t = hitAt.get(posKey(e.origin));
            return Math.max(cursor, t === undefined ? cursor : t + FUSE);
          });
          const touched = ev.explosions.flatMap((e) => e.cells);
          const start = Math.max(ignite.length ? Math.min(...ignite) : cursor, settledOf(touched));
          // 每格被波及的相对时刻：取最早到达它的爆炸
          const reach = new Map<number, number>();
          ev.explosions.forEach((e, i) => {
            const off = Math.max(0, ignite[i]! - start);
            master.call(() => {
              this.addBlast(e);
              sfx.blast(e.shape, e.cells.length);
            }, [], start + off);
            e.cells.forEach((p, j) => {
              const t = off + sweepDelay(e, p, j);
              const k = posKey(p);
              if (!reach.has(k) || reach.get(k)! > t) reach.set(k, t);
            });
          });
          const at = (p: Pos) => reach.get(posKey(p)) ?? 0;
          hitAt = new Map();
          for (const c of [...ev.consumed, ...ev.cleared]) {
            const s = this.sprites.get(c.id);
            const t = start + at(c.pos);
            if (s) master.add(this.clearTl(s, CLEAR_BLAST), t);
            if (this.grid[c.pos.r]?.[c.pos.c] === c.id) this.grid[c.pos.r]![c.pos.c] = null;
            markCleared(t, c.pos, CLEAR_BLAST);
          }
          for (const q of ev.queued) hitAt.set(posKey(q.at), start + at(q.at));
          for (const cv of ev.converted) {
            const t = start + (cv.from ? at(cv.from.pos) : 0) + 0.05;
            this.morph(master, cv.at, cv.id, { id: cv.id, kind: 'bomb', bomb: cv.bomb }, t);
            hitAt.set(posKey(cv.at), t);
          }
          if (ev.phase === 'passive') reportChain(start, ev.cleared.length + ev.consumed.length);
          cursor = start;
          break;
        }
        case 'gravity': {
          const byCol = this.gravityTls(ev);
          let first = Infinity;
          for (const [c, tl] of byCol) {
            const start = Math.max(clearEnd[c]!, settled[c]!);
            master.add(tl, start);
            settled[c] = start + tl.duration();
            clearEnd[c] = settled[c]!;
            first = Math.min(first, start);
          }
          if (Number.isFinite(first)) cursor = first;
          break;
        }
        case 'shuffle': {
          // 死局自动重排：等全部下落结束后整体缩小、换位、回弹
          const start = Math.max(cursor, ...settled);
          const all = [...this.sprites.values()];
          master.to(all, { s: 0.5, duration: 0.22, ease: 'power2.in' }, start);
          master.call(() => this.sync(finalBoard), [], start + 0.22);
          master.to(all, { s: 1, duration: 0.26, ease: 'back.out(2)' }, start + 0.22);
          cursor = start + 0.5;
          break;
        }
      }
    }
    await master;
    this.sync(finalBoard);
  }

  /** 把某格的方块就地变成另一块（做出炸弹、改造）：逻辑上立即换 ID，画面在 t 时刻换样并脉冲 */
  private morph(tl: gsap.core.Timeline, at: Pos, newId: number, tile: Tile, t: number): void {
    const oldId = this.grid[at.r]?.[at.c];
    let s = oldId == null ? undefined : this.sprites.get(oldId);
    if (s && oldId != null) {
      // 不能停掉它的动画：这块可能还在交换落位或下落途中，停掉会让产弹格留白
      this.sprites.delete(oldId);
    } else {
      s = { id: newId, tile, x: at.c, y: at.r, s: 0, a: 1, rot: 0, sq: 0 };
    }
    const sp = s;
    sp.id = newId;
    this.sprites.set(newId, sp);
    this.grid[at.r]![at.c] = newId;
    tl.call(() => {
      sp.tile = tile;
      sp.rot = 0;
      sp.a = 1;
      sp.x = at.c;
      sp.y = at.r;
    }, [], t);
    tl.fromTo(sp, { s: 1 }, { s: 1.35, duration: 0.13, yoyo: true, repeat: 1, ease: 'power2.out', immediateRender: false }, t);
  }

  private swapTl(from: Pos, to: Pos): gsap.core.Timeline {
    const tl = gsap.timeline();
    const a = this.spriteAt(from);
    const b = this.spriteAt(to);
    if (a) tl.to(a, { x: to.c, y: to.r, duration: SWAP, ease: 'power3.inOut' }, 0);
    if (b) tl.to(b, { x: from.c, y: from.r, duration: SWAP, ease: 'power3.inOut' }, 0);
    const ia = this.grid[from.r]![from.c]!;
    this.grid[from.r]![from.c] = this.grid[to.r]![to.c]!;
    this.grid[to.r]![to.c] = ia;
    return tl;
  }

  /** 消除：前 25% 放大到 1.2，之后回弹缩到 0，同时旋转；开始时迸出碎片 */
  private clearTl(s: Sprite, dur: number): gsap.core.Timeline {
    const tl = gsap.timeline();
    tl.call(() => this.burst(s));
    tl.to(s, { s: 1.2, duration: dur * 0.25, ease: 'none' }, 0);
    tl.to(s, { s: 0, duration: dur * 0.75, ease: 'back.in(1.7)' }, dur * 0.25);
    tl.to(s, { rot: 1.6, duration: dur, ease: 'none' }, 0);
    tl.call(() => {
      if (this.sprites.get(s.id) === s) this.sprites.delete(s.id);
    });
    return tl;
  }

  private gravityTls(ev: Extract<ResolutionEvent, { type: 'gravity' }>): Map<number, gsap.core.Timeline> {
    const byCol = new Map<number, gsap.core.Timeline>();
    const col = (c: number) => {
      let tl = byCol.get(c);
      if (!tl) byCol.set(c, (tl = gsap.timeline()));
      return tl;
    };
    // 同一加速度下落（时长与 √距离 成正比），落地压扁 8%
    const fall = (rows: number) => FALL_K * Math.sqrt(Math.max(1, rows));
    const land = (tl: gsap.core.Timeline, s: Sprite, t: number) =>
      tl.to(s, { sq: 1, duration: 0.06, yoyo: true, repeat: 1, ease: 'sine.out' }, t);
    for (const m of ev.moves) if (this.grid[m.from.r]?.[m.from.c] === m.id) this.grid[m.from.r]![m.from.c] = null;
    for (const m of ev.moves) {
      this.grid[m.to.r]![m.to.c] = m.id;
      const s = this.sprites.get(m.id);
      if (!s) continue;
      const tl = col(m.to.c);
      const d = fall(Math.abs(m.to.r - m.from.r));
      tl.to(s, { y: m.to.r, duration: d, ease: 'power2.in' }, 0);
      land(tl, s, d);
    }
    const dir = ev.gravity === 'down' ? -1 : 1;
    // 同一列新补的方块在棋盘外叠成一摞，整摞落下的距离都等于这一列的空格数
    const gap = new Map<number, number>();
    for (const sp of ev.spawns) gap.set(sp.to.c, (gap.get(sp.to.c) ?? 0) + 1);
    for (const sp of ev.spawns) {
      const k = gap.get(sp.to.c)!;
      const s: Sprite = { id: sp.id, tile: { id: sp.id, kind: 'normal', color: sp.color }, x: sp.to.c, y: sp.to.r + dir * k, s: 1, a: 1, rot: 0, sq: 0 };
      this.sprites.set(sp.id, s);
      this.grid[sp.to.r]![sp.to.c] = sp.id;
      const tl = col(sp.to.c);
      const d = fall(k);
      tl.to(s, { y: sp.to.r, duration: d, ease: 'power2.in' }, 0);
      land(tl, s, d);
    }
    return byCol;
  }

  /** 不能消除的交换：互相推进 40% 再回弹 */
  async rejectSwap(from: Pos, to: Pos): Promise<void> {
    sfx.reject();
    const a = this.spriteAt(from);
    const b = this.spriteAt(to);
    const tl = gsap.timeline();
    const k = 0.4;
    if (a) tl.to(a, { x: from.c + (to.c - from.c) * k, y: from.r + (to.r - from.r) * k, duration: 0.11, ease: 'power3.out' }, 0);
    if (b) tl.to(b, { x: to.c + (from.c - to.c) * k, y: to.r + (from.r - to.r) * k, duration: 0.11, ease: 'power3.out' }, 0);
    if (a) tl.to(a, { x: from.c, y: from.r, duration: 0.2, ease: 'back.out(1.7)' }, 0.11);
    if (b) tl.to(b, { x: to.c, y: to.r, duration: 0.2, ease: 'back.out(1.7)' }, 0.11);
    await tl;
  }

  /** 神器等在棋盘外放下的炸弹：脉冲并套一圈黑环 */
  pulse(cells: Pos[]): void {
    if (cells.length) sfx.artifact();
    for (const p of cells) {
      const s = this.spriteAt(p);
      if (s) gsap.fromTo(s, { s: 0.2 }, { s: 1, duration: 0.45, ease: 'back.out(3)' });
      this.rings.push({ x: p.c + 0.5, y: p.r + 0.5, life: 0, max: 520 });
    }
  }

  /** 棋盘上弹出文字；位置以格为单位 */
  popText(text: string, sub: string, at: { r: number; c: number }, big = false): void {
    this.pops.push({ x: at.c + 0.5, y: at.r + 0.5, text, sub, life: 0, max: big ? 1300 : 900, big });
  }

  // ---------- 特效 ----------

  private burst(s: Sprite): void {
    if (REDUCED || s.tile.kind !== 'normal') return;
    const color = COLOR_HEX[s.tile.color];
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const v = 0.1 + Math.random() * 0.12;
      this.particles.push({ x: s.x + 0.5, y: s.y + 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.02, life: 0, max: 700, size: 0.1, color, tri: i % 2 === 0 });
    }
  }

  private addBlast(e: Explosion): void {
    this.blasts.push({ e, life: 0, max: e.shape === 'CB' || e.shape === 'board' ? 460 : 380 });
    this.shake = Math.min(1, this.shake + 0.35);
  }

  // ---------- 输入 ----------

  private cellAt(e: PointerEvent): Pos | null {
    const rect = this.canvas.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * this.cols);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * this.rows);
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols ? { r, c } : null;
  }

  private bind(): void {
    const canvas = this.canvas;
    const signal = this.listeners.signal;
    // 所有监听都挂在同一个 AbortController 上，destroy 时一并解绑
    const cv = {
      addEventListener: <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void) => canvas.addEventListener(type, fn, { signal }),
      setPointerCapture: (id: number) => canvas.setPointerCapture(id),
      getBoundingClientRect: () => canvas.getBoundingClientRect(),
    };
    cv.addEventListener('pointerdown', (e) => {
      this.hint = null;
      this.handlers.onActivity?.();
      const p = this.cellAt(e);
      if (!p) return;
      this.showCursor = false;
      this.drag = { p, x: e.clientX, y: e.clientY };
      try {
        cv.setPointerCapture(e.pointerId);
      } catch {
        // 某些浏览器不支持时忽略
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.drag) {
        if (e.pointerType === 'mouse') this.hover = this.cellAt(e);
        return;
      }
      if (this.busy) return;
      const rect = cv.getBoundingClientRect();
      const s = rect.width / this.cols;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      const { r, c } = this.drag.p;
      const horiz = Math.abs(dx) > Math.abs(dy);
      const to = horiz ? { r, c: c + Math.sign(dx) } : { r: r + Math.sign(dy), c };
      const inside = to.r >= 0 && to.r < this.rows && to.c >= 0 && to.c < this.cols;
      const dist = Math.hypot(dx, dy) / s;
      if (dist < DRAG_SWAP) {
        // 拖动跟手：方块沿主方向跟着手指挪开（打个折，有阻尼感）；朝棋盘外拖只挪一点点
        if (!this.pick) this.follow(this.drag.p, horiz ? Math.sign(dx) : 0, horiz ? 0 : Math.sign(dy), dist * (inside ? 0.8 : 0.3));
        return;
      }
      this.drag = null;
      if (inside) {
        this.sel = null;
        // 交换动画从手指拖到的位置接着走，不跳回原位
        this.dragged = null;
        if (this.pick === 'pair' || this.pick === 'any') this.handlers.onPickPair?.({ r, c }, to);
        else if (!this.pick) this.handlers.onSwap({ r, c }, to);
      } else this.release();
    });
    cv.addEventListener('pointerup', () => {
      if (this.drag) this.click(this.drag.p);
      this.drag = null;
      this.release();
    });
    cv.addEventListener('pointercancel', () => {
      this.drag = null;
      this.release();
    });
    cv.addEventListener('pointerleave', () => (this.hover = null));
    // 键盘：方向键移动光标，回车或空格等同点击
    cv.addEventListener('keydown', (e) => {
      this.hint = null;
      this.handlers.onActivity?.();
      const d = ({ ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] } as Record<string, [number, number]>)[e.key];
      if (d) {
        this.cursor = { r: clamp(this.cursor.r + d[0], 0, this.rows - 1), c: clamp(this.cursor.c + d[1], 0, this.cols - 1) };
        this.showCursor = true;
        e.preventDefault();
      }
      if (e.key === 'Enter' || e.key === ' ') {
        this.showCursor = true;
        this.click(this.cursor);
        e.preventDefault();
      }
      if (e.key === 'Escape') this.sel = null;
    });
    cv.addEventListener('blur', () => (this.showCursor = false));
  }

  /** 拖动中把那块方块挪到 (原位 + 方向 × 距离) */
  private follow(p: Pos, dc: number, dr: number, d: number): void {
    const sp = this.spriteAt(p);
    if (!sp) return;
    if (this.dragged && this.dragged !== sp) this.release();
    this.dragged = sp;
    gsap.killTweensOf(sp, 'x,y');
    sp.x = p.c + dc * d;
    sp.y = p.r + dr * d;
  }

  /** 松手没换成：挪开的方块回弹到原位 */
  private release(): void {
    const sp = this.dragged;
    this.dragged = null;
    if (!sp) return;
    const home = this.posOf(sp.id);
    if (home) gsap.to(sp, { x: home.c, y: home.r, duration: REDUCED ? 0.06 : 0.22, ease: 'back.out(2.2)' });
  }

  private posOf(id: number): Pos | null {
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) if (this.grid[r]?.[c] === id) return { r, c };
    return null;
  }

  private click(p: Pos): void {
    if (this.busy) return;
    if (this.pick === 'cell') {
      this.handlers.onPickCell?.(p);
      return;
    }
    const s = this.sel;
    if (this.pick === 'pair' || this.pick === 'any') {
      if (s && (this.pick === 'any' ? !samePos(s, p) : Math.abs(s.r - p.r) + Math.abs(s.c - p.c) === 1)) {
        this.sel = null;
        this.handlers.onPickPair?.(s, p);
      } else this.sel = s && samePos(s, p) ? null : p;
      return;
    }
    if (s && samePos(s, p)) {
      // 点两下炸弹原地引爆
      if (this.spriteAt(p)?.tile.kind === 'bomb') {
        this.sel = null;
        this.handlers.onIgnite(p);
      } else this.sel = null;
      return;
    }
    if (s && Math.abs(s.r - p.r) + Math.abs(s.c - p.c) === 1) {
      this.sel = null;
      this.handlers.onSwap(s, p);
      return;
    }
    this.sel = p;
    this.selT = 0;
    sfx.select();
  }

  // ---------- 绘制 ----------

  private draw(dt: number): void {
    const { ctx, W, dpr } = this;
    const S = this.S;
    if (!W || !S) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BOARD_BG;
    ctx.fillRect(0, 0, W, W);
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < this.cols; i++) {
      ctx.moveTo(Math.round(i * S) + 0.5, 0);
      ctx.lineTo(Math.round(i * S) + 0.5, W);
    }
    for (let i = 1; i < this.rows; i++) {
      ctx.moveTo(0, Math.round(i * S) + 0.5);
      ctx.lineTo(W, Math.round(i * S) + 0.5);
    }
    ctx.stroke();

    ctx.save();
    if (this.shake > 0.01) {
      ctx.translate((Math.random() - 0.5) * 7 * this.shake, (Math.random() - 0.5) * 7 * this.shake);
      this.shake *= Math.pow(0.02, dt / 1000);
    }
    if (this.hover && !this.busy && !this.drag && !(this.sel && samePos(this.sel, this.hover))) {
      ctx.fillStyle = 'rgba(32,35,30,0.05)';
      ctx.fillRect(this.hover.c * S, this.hover.r * S, S, S);
    }
    // 选中：格子铺一层浅灰，方块回弹放大后轻轻上下浮动（减少动态效果时只放大）
    const hoverId = this.hover && !this.busy && !this.drag ? (this.grid[this.hover.r]?.[this.hover.c] ?? null) : null;
    let selId: number | null = null;
    let selScale = 1;
    let selLift = 0;
    if (this.sel) {
      ctx.fillStyle = 'rgba(35,91,193,0.12)';
      ctx.fillRect(this.sel.c * S, this.sel.r * S, S, S);
      this.selT += dt;
      selId = this.grid[this.sel.r]?.[this.sel.c] ?? null;
      selScale = REDUCED ? 1.1 : 1 + 0.12 * backOut(Math.min(1, this.selT / 200));
      selLift = REDUCED ? 0 : -0.05 * (0.5 - 0.5 * Math.cos((this.selT / 900) * Math.PI * 2));
    }
    for (const b of this.blasts) {
      b.life += dt;
      drawBlast(ctx, b.e, S, W, Math.min(1, b.life / b.max));
    }
    this.blasts = this.blasts.filter((b) => b.life < b.max);

    if (this.hint) this.hint.t += dt;
    for (const s of this.sprites.values()) {
      if (s.y < -1 || s.y > this.rows || s.s <= 0.001) continue;
      const off = this.hint ? this.hintOffset({ r: Math.round(s.y), c: Math.round(s.x) }) : { x: 0, y: 0 };
      // 悬停放大 1.07 倍（约 70 毫秒趋近，移开时同样缩回）；选中、拖动时用各自更大的倍数
      const h = (s.h ?? 0) + ((s.id === hoverId ? 1 : 0) - (s.h ?? 0)) * (REDUCED ? 1 : Math.min(1, dt / 70));
      s.h = h;
      const k = s.id === selId ? selScale : s === this.dragged ? 1.08 : 1 + 0.07 * h;
      ctx.save();
      ctx.translate((s.x + off.x + 0.5) * S, (s.y + off.y + (s.id === selId ? selLift : 0) + 0.5) * S);
      ctx.rotate(s.rot);
      ctx.scale(k * s.s * (1 + 0.04 * s.sq), k * s.s * (1 - 0.08 * s.sq));
      ctx.globalAlpha = clamp(s.a, 0, 1);
      if (s.tile.kind === 'normal') drawNormal(ctx, s.tile.color, S);
      else if (s.tile.kind === 'bomb') drawBomb(ctx, s.tile.bomb, S, REDUCED ? 0 : performance.now(), (s.id * 1.7) % 6.28);
      else drawStone(ctx, S);
      ctx.restore();
    }

    if (this.showCursor) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(this.cursor.c * S + 3, this.cursor.r * S + 3, S - 6, S - 6);
      ctx.setLineDash([]);
    }

    for (const g of this.rings) {
      g.life += dt;
      const p = Math.min(1, g.life / g.max);
      ctx.strokeStyle = INK;
      ctx.lineWidth = S * 0.12 * (1 - p);
      ctx.beginPath();
      ctx.arc(g.x * S, g.y * S, S * (0.5 + p * 0.7), 0, Math.PI * 2);
      ctx.stroke();
    }
    this.rings = this.rings.filter((g) => g.life < g.max);

    for (const q of this.particles) {
      q.life += dt;
      q.vy += 0.0009 * dt;
      q.x += (q.vx * dt) / S;
      q.y += (q.vy * dt) / S;
      q.rot += q.vr * dt;
      const size = q.size * S;
      ctx.save();
      ctx.globalAlpha = 1 - Math.min(1, q.life / q.max);
      ctx.fillStyle = q.color;
      ctx.translate(q.x * S, q.y * S);
      ctx.rotate(q.rot);
      if (q.tri) drawTri(ctx, size);
      else ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.restore();
    }
    this.particles = this.particles.filter((q) => q.life < q.max);
    ctx.restore();

    for (const q of this.pops) {
      q.life += dt;
      const p = Math.min(1, q.life / q.max);
      const x = clamp(q.x * S, S * 1.4, W - S * 1.4);
      const y = q.y * S - easeOut(p) * S * 0.9;
      const size = q.big ? Math.max(22, S * 0.72) : Math.max(15, S * 0.44);
      ctx.save();
      ctx.globalAlpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
      const pop = p < 0.12 ? 0.6 + (p / 0.12) * 0.4 : 1;
      ctx.translate(x, y);
      ctx.scale(pop, pop);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `400 ${size}px "Archivo Black", Impact, sans-serif`;
      // 平涂底块托住文字，不加阴影
      const w = ctx.measureText(q.text).width;
      ctx.fillStyle = PAPER;
      ctx.fillRect(-w / 2 - size * 0.25, -size * 0.62, w + size * 0.5, size * 1.2);
      ctx.fillStyle = INK;
      ctx.fillText(q.text, 0, 0);
      if (q.sub) {
        ctx.font = `400 ${size * 0.5}px "Archivo Black", Impact, sans-serif`;
        const sw = ctx.measureText(q.sub).width;
        ctx.fillStyle = COLOR_HEX.attack;
        ctx.fillRect(-sw / 2 - size * 0.18, size * 0.58, sw + size * 0.36, size * 0.62);
        ctx.fillStyle = PAPER;
        ctx.fillText(q.sub, 0, size * 0.9);
      }
      ctx.restore();
    }
    this.pops = this.pops.filter((q) => q.life < q.max);
  }
}

// ---------- 爆炸的画法 ----------

/** 格子被波及的相对时刻：直线从来源向两端扫开，五连按目标顺序依次命中 */
function sweepDelay(e: Explosion, p: Pos, index: number): number {
  const dr = Math.abs(p.r - e.origin.r);
  const dc = Math.abs(p.c - e.origin.c);
  switch (e.shape) {
    case 'H':
    case 'V':
    case 'rows3':
    case 'cols3':
    case 'cross':
      return 0.017 * (dr + dc);
    case 'CB':
    case 'board':
    case 'lightning':
      return 0.03 + 0.012 * index;
    default:
      return 0.03 * Math.max(dr, dc);
  }
}

function drawBlast(ctx: CanvasRenderingContext2D, e: Explosion, S: number, W: number, p: number): void {
  const cx = (e.origin.c + 0.5) * S;
  const cy = (e.origin.r + 0.5) * S;
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  const thick = S * 0.34 * (1 - p * p);
  const reach = W * Math.min(1, p * 3);
  const rowsOf = () => [...new Set(e.cells.map((c) => c.r))];
  const colsOf = () => [...new Set(e.cells.map((c) => c.c))];
  switch (e.shape) {
    case 'H':
    case 'V': {
      if (e.shape === 'H') ctx.fillRect(cx - reach, cy - thick / 2, reach * 2, thick);
      else ctx.fillRect(cx - thick / 2, cy - reach, thick, reach * 2);
      // 十字引线：垂直方向的短臂，长度按实际波及的格算
      if (e.byArtifact === 'crossFuse') {
        const arm = Math.max(...e.cells.map((c) => (e.shape === 'H' ? Math.abs(c.r - e.origin.r) : Math.abs(c.c - e.origin.c))));
        const len = Math.min((arm + 0.5) * S, reach);
        if (e.shape === 'H') ctx.fillRect(cx - thick / 2, cy - len, thick, len * 2);
        else ctx.fillRect(cx - len, cy - thick / 2, len * 2, thick);
      }
      return;
    }
    case 'rows3':
      for (const r of rowsOf()) ctx.fillRect(cx - reach, (r + 0.5) * S - thick / 2, reach * 2, thick);
      return;
    case 'cols3':
      for (const c of colsOf()) ctx.fillRect((c + 0.5) * S - thick / 2, cy - reach, thick, reach * 2);
      return;
    case 'cross':
      ctx.fillRect(cx - reach, cy - thick / 2, reach * 2, thick);
      ctx.fillRect(cx - thick / 2, cy - reach, thick, reach * 2);
      return;
    case 'card': {
      // 道具“锤子”：被砸的格上一个黑方块迅速收缩
      const k = S * 0.9 * (1 - easeOut(p));
      for (const c of e.cells) ctx.fillRect((c.c + 0.5) * S - k / 2, (c.r + 0.5) * S - k / 2, k, k);
      return;
    }
    case 'CB':
    case 'board':
    case 'lightning': {
      // 细线从来源连到每个目标，目标处落一个黑方块
      ctx.lineWidth = Math.max(1.5, S * 0.05) * (1 - p);
      ctx.beginPath();
      for (const c of e.cells) {
        ctx.moveTo(cx, cy);
        ctx.lineTo((c.c + 0.5) * S, (c.r + 0.5) * S);
      }
      ctx.stroke();
      const k = S * 0.3 * (1 - p);
      for (const c of e.cells) ctx.fillRect((c.c + 0.5) * S - k / 2, (c.r + 0.5) * S - k / 2, k, k);
      return;
    }
    default: {
      // 3×3、5×5 等范围：黑色圆环扩散、变细
      const span = e.shape === 'square5' ? 2.2 : e.byArtifact === 'bigBore' ? 1.7 : 1.2;
      ctx.lineWidth = S * 0.18 * (1 - p);
      ctx.beginPath();
      ctx.arc(cx, cy, S * (0.6 + p * span), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
/** 回弹缓动：冲过头一点再落回 1 */
const backOut = (t: number) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);

