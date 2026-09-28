// 战斗舞台（PixiJS）：绘制场景与棋盘，按引擎事件日志播放动画，并把玩家输入转成交换／点燃请求。
// 舞台只负责呈现，不做任何规则计算；动画结束后以引擎给出的棋盘为准重新同步。
import gsap from 'gsap';
import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import {
  posKey,
  type ActionLog,
  type Board,
  type Color,
  type EnemyTurnLog,
  type Explosion,
  type InstalledInsert,
  type Pos,
  type ResolutionEvent,
  type Tile,
} from '../../engine';
import { INSERT_GLYPH, INSERT_HEX } from '../insertStyle';

export const STAGE_W = 1600;
export const STAGE_H = 900;
const CELL = 80;
const FRAME = { x: 36, y: 120, size: 720 };
/** 棋盘底图内框约占整图的 1115/1254 */
const BOARD = { x: FRAME.x + (FRAME.size - 640) / 2, y: FRAME.y + (FRAME.size - 640) / 2, size: 640 };
/** 爆炸从锚点向外每扩散一格的延迟（秒） */
const RIPPLE_STEP = 0.035;

const COLOR_HEX: Record<Color, number> = { attack: 0xe6edf5, shield: 0x5aa8ff, poison: 0x5cff6a, catalyst: 0xff5ce1 };
const BOMB_HEX = 0xff8a2a;
type TextureKey = 'attack' | 'shield' | 'poison' | 'catalyst' | 'line' | 'area' | 'color' | 'alchemist' | 'mole' | 'bg' | 'frame';
const TEXTURE_URLS: Record<TextureKey, string> = {
  attack: '/game/tile-attack.webp',
  shield: '/game/tile-shield.webp',
  poison: '/game/tile-poison.webp',
  catalyst: '/game/tile-catalyst.webp',
  line: '/game/bomb-line.webp',
  area: '/game/bomb-area.webp',
  color: '/game/bomb-color.webp',
  alchemist: '/game/alchemist.webp',
  mole: '/game/mole.webp',
  bg: '/game/bg-entrance.webp',
  frame: '/game/board-frame.webp',
};

export interface StageHandlers {
  onSwap(from: Pos, to: Pos): void;
  onIgnite(at: Pos): void;
  /** 调试：放炸弹模式下点击格子 */
  onPlace?(at: Pos): void;
}

const center = (p: Pos) => ({ x: BOARD.x + p.c * CELL + CELL / 2, y: BOARD.y + p.r * CELL + CELL / 2 });
const chebyshev = (a: Pos, b: Pos) => Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));

export class Stage {
  private readonly tex = {} as Record<TextureKey, Texture>;
  private particleTex!: Texture;
  private readonly root = new Container();
  private readonly insertLayer = new Container();
  private readonly insertGlow = new Container();
  private readonly tileLayer = new Container();
  private readonly fxLayer = new Container();
  private readonly uiLayer = new Container();
  private readonly selection = new Graphics();
  private readonly cursor = new Graphics();
  private readonly hint: Text;
  private alchemist!: Sprite;
  private mole!: Sprite;
  private moleBaseScale = 1;
  private moleIdle: gsap.core.Tween | null = null;
  private enemyNote!: Text;

  private readonly sprites = new Map<number, Container>();
  private grid: (number | null)[][] = [];
  private board: Board = [];
  private inserts: InstalledInsert[] = [];
  private selected: Pos | null = null;
  private cursorPos: Pos = { r: 3, c: 3 };
  private drag: { cell: Pos; x: number; y: number } | null = null;

  busy = false;
  placeMode = false;

  private constructor(
    private readonly app: Application,
    private readonly handlers: StageHandlers,
  ) {
    this.hint = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 18, fill: 0xffe9b0, fontWeight: '600', stroke: { color: 0x000000, width: 4 } },
    });
  }

  static async create(host: HTMLElement, resolution: number, handlers: StageHandlers): Promise<Stage> {
    const app = new Application();
    await app.init({ width: STAGE_W, height: STAGE_H, resolution, autoDensity: true, antialias: true, background: 0x07080c });
    host.appendChild(app.canvas);
    const stage = new Stage(app, handlers);
    await stage.load();
    stage.build();
    return stage;
  }

  setResolution(resolution: number): void {
    this.app.renderer.resize(STAGE_W, STAGE_H, resolution);
  }

  destroy(): void {
    gsap.globalTimeline.getChildren().forEach((t) => t.kill());
    this.app.destroy(true, { children: true });
  }

  /** 切换敌人外观。新敌人美术到位前，用着色与缩放后的鼹鼠作占位 */
  setEnemy(id: string): void {
    const look: Record<string, { tint: number; scale: number; note: string }> = {
      'crystal-mole': { tint: 0xffffff, scale: 1, note: '' },
      'cave-bats': { tint: 0x8fb0ff, scale: 0.85, note: '（洞蝠群占位图）' },
      'rock-crab': { tint: 0xc49cff, scale: 1.2, note: '（吞光岩蟹占位图）' },
    };
    const l = look[id] ?? { tint: 0xcccccc, scale: 1, note: '（占位图）' };
    this.moleIdle?.kill();
    gsap.killTweensOf(this.mole);
    this.mole.tint = l.tint;
    this.mole.position.set(1390, 720);
    this.mole.rotation = 0;
    this.mole.scale.set(this.moleBaseScale * l.scale);
    this.moleIdle = gsap.to(this.mole.scale, { y: this.mole.scale.y * 1.02, duration: 1.3, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    this.enemyNote.text = l.note;
  }

  setSpeed(scale: number): void {
    gsap.globalTimeline.timeScale(scale);
  }

  private async load(): Promise<void> {
    await Promise.all(
      (Object.keys(TEXTURE_URLS) as TextureKey[]).map(async (k) => {
        this.tex[k] = await Assets.load<Texture>(TEXTURE_URLS[k]);
      }),
    );
    const dot = new Graphics().circle(0, 0, 10).fill(0xffffff);
    this.particleTex = this.app.renderer.generateTexture(dot);
  }

  // ---------- 构建场景 ----------

  private build(): void {
    const { app } = this;
    app.stage.addChild(this.root);

    const bg = new Sprite(this.tex.bg);
    bg.width = STAGE_W;
    bg.height = STAGE_H;
    this.root.addChild(bg);
    // 左侧压暗，突出棋盘
    const shade = new Graphics().rect(0, 0, 820, STAGE_H).fill({ color: 0x000000, alpha: 0.35 });
    this.root.addChild(shade);

    // 角色
    this.alchemist = new Sprite(this.tex.alchemist);
    this.alchemist.anchor.set(0.5, 1);
    this.alchemist.scale.set(440 / this.tex.alchemist.height);
    this.alchemist.position.set(1010, 720);
    this.mole = new Sprite(this.tex.mole);
    this.mole.anchor.set(0.5, 1);
    this.mole.scale.set(480 / this.tex.mole.width);
    this.mole.position.set(1390, 720);
    this.root.addChild(this.alchemist, this.mole);
    gsap.to(this.alchemist.scale, { y: this.alchemist.scale.y * 1.015, duration: 1.6, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    this.moleBaseScale = this.mole.scale.x;
    this.enemyNote = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontSize: 16, fill: 0xd8d0c0, stroke: { color: 0x000000, width: 4 } } });
    this.enemyNote.anchor.set(0.5, 0);
    this.enemyNote.position.set(1390, 728);
    this.root.addChild(this.enemyNote);
    this.setEnemy('crystal-mole');

    // 棋盘底图与格线
    const frame = new Sprite(this.tex.frame);
    frame.position.set(FRAME.x, FRAME.y);
    frame.width = frame.height = FRAME.size;
    this.root.addChild(frame);
    const lines = new Graphics();
    for (let i = 1; i < 8; i++) {
      lines.moveTo(BOARD.x + i * CELL, BOARD.y).lineTo(BOARD.x + i * CELL, BOARD.y + BOARD.size);
      lines.moveTo(BOARD.x, BOARD.y + i * CELL).lineTo(BOARD.x + BOARD.size, BOARD.y + i * CELL);
    }
    lines.stroke({ width: 1, color: 0x8fb3d9, alpha: 0.12 });
    this.root.addChild(lines);

    // 层级：嵌片 → 嵌片高亮 → 方块（遮罩到棋盘内）→ 特效 → 选择与提示
    const mask = new Graphics().rect(BOARD.x, BOARD.y, BOARD.size, BOARD.size).fill(0xffffff);
    this.tileLayer.mask = mask;
    this.insertGlow.blendMode = 'add';
    this.fxLayer.blendMode = 'add';
    this.root.addChild(this.insertLayer, this.insertGlow, mask, this.tileLayer, this.fxLayer, this.uiLayer);
    this.uiLayer.addChild(this.selection, this.cursor, this.hint);
    this.cursor.visible = false;

    // 输入
    this.tileLayer.eventMode = 'static';
    this.tileLayer.hitArea = new Rectangle(BOARD.x, BOARD.y, BOARD.size, BOARD.size);
    this.tileLayer.cursor = 'pointer';
    this.tileLayer.on('pointerdown', (e) => {
      const p = this.root.toLocal(e.global);
      const cell = this.cellAt(p.x, p.y);
      if (cell) this.drag = { cell, x: p.x, y: p.y };
    });
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.on('globalpointermove', (e) => {
      if (!this.drag || this.busy) return;
      const p = this.root.toLocal(e.global);
      const dx = p.x - this.drag.x;
      const dy = p.y - this.drag.y;
      if (Math.hypot(dx, dy) < 28) return;
      const from = this.drag.cell;
      const to = Math.abs(dx) > Math.abs(dy) ? { r: from.r, c: from.c + Math.sign(dx) } : { r: from.r + Math.sign(dy), c: from.c };
      this.drag = null;
      this.clearSelection();
      if (to.r >= 0 && to.r < 8 && to.c >= 0 && to.c < 8) this.handlers.onSwap(from, to);
    });
    app.stage.on('pointerup', () => {
      if (this.drag) this.click(this.drag.cell);
      this.drag = null;
    });
    app.stage.on('pointerupoutside', () => (this.drag = null));
  }

  private cellAt(x: number, y: number): Pos | null {
    const c = Math.floor((x - BOARD.x) / CELL);
    const r = Math.floor((y - BOARD.y) / CELL);
    return r >= 0 && r < 8 && c >= 0 && c < 8 ? { r, c } : null;
  }

  // ---------- 选择与键盘 ----------

  private click(cell: Pos): void {
    if (this.busy) return;
    if (this.placeMode) {
      this.handlers.onPlace?.(cell);
      return;
    }
    const sel = this.selected;
    if (!sel) return this.select(cell);
    if (sel.r === cell.r && sel.c === cell.c) {
      const tile = this.board[cell.r]?.[cell.c];
      this.clearSelection();
      if (tile?.kind === 'bomb') this.handlers.onIgnite(cell);
      return;
    }
    if (Math.abs(sel.r - cell.r) + Math.abs(sel.c - cell.c) === 1) {
      this.clearSelection();
      this.handlers.onSwap(sel, cell);
      return;
    }
    this.select(cell);
  }

  private select(cell: Pos): void {
    this.selected = cell;
    const { x, y } = center(cell);
    this.selection.clear().roundRect(x - CELL / 2 + 3, y - CELL / 2 + 3, CELL - 6, CELL - 6, 10).stroke({ width: 3, color: 0xffe08a });
    const tile = this.board[cell.r]?.[cell.c];
    this.hint.text = tile?.kind === 'bomb' ? '再点一次：点燃（1 AP）' : '';
    this.hint.position.set(Math.min(x - 70, BOARD.x + BOARD.size - 200), y - CELL / 2 - 30);
  }

  clearSelection(): void {
    this.selected = null;
    this.selection.clear();
    this.hint.text = '';
  }

  /** 键盘：方向键移动光标，Enter／空格等同于点击光标所在格 */
  handleKey(key: string): boolean {
    const d: Record<string, Pos> = { ArrowUp: { r: -1, c: 0 }, ArrowDown: { r: 1, c: 0 }, ArrowLeft: { r: 0, c: -1 }, ArrowRight: { r: 0, c: 1 } };
    if (d[key]) {
      this.cursorPos = { r: Math.max(0, Math.min(7, this.cursorPos.r + d[key]!.r)), c: Math.max(0, Math.min(7, this.cursorPos.c + d[key]!.c)) };
    } else if (key === 'Enter' || key === ' ') {
      this.click(this.cursorPos);
    } else if (key === 'Escape') {
      this.clearSelection();
    } else {
      return false;
    }
    const { x, y } = center(this.cursorPos);
    this.cursor.visible = true;
    this.cursor.clear().roundRect(x - CELL / 2 + 1, y - CELL / 2 + 1, CELL - 2, CELL - 2, 12).stroke({ width: 2, color: 0xffffff, alpha: 0.8 });
    return true;
  }

  // ---------- 同步 ----------

  /** 以引擎棋盘为准，重建所有方块精灵 */
  sync(board: Board): void {
    this.board = board;
    const keep = new Set<number>();
    this.grid = board.map((row, r) =>
      row.map((tile, c) => {
        if (!tile) return null;
        keep.add(tile.id);
        let s = this.sprites.get(tile.id);
        if (!s) {
          s = this.makeTile(tile);
          this.sprites.set(tile.id, s);
          this.tileLayer.addChild(s);
        }
        gsap.killTweensOf(s);
        gsap.killTweensOf(s.scale);
        const { x, y } = center({ r, c });
        s.position.set(x, y);
        s.alpha = 1;
        s.scale.set(1);
        return tile.id;
      }),
    );
    for (const [id, s] of this.sprites) {
      if (!keep.has(id)) {
        this.destroyTile(s);
        this.sprites.delete(id);
      }
    }
  }

  /** 销毁方块前先停掉它和子元素（炸弹光晕）上的循环动画 */
  private destroyTile(s: Container): void {
    gsap.killTweensOf(s);
    gsap.killTweensOf(s.scale);
    for (const ch of s.children) gsap.killTweensOf(ch);
    s.destroy({ children: true });
  }

  private makeTile(tile: Tile): Container {
    const box = new Container();
    let texture: Texture;
    let size = CELL * 0.76;
    let rotation = 0;
    if (tile.kind === 'normal') {
      texture = this.tex[tile.color];
    } else {
      size = CELL * 0.86;
      texture = tile.bomb === 'CB' ? this.tex.color : tile.bomb === 'A' ? this.tex.area : this.tex.line;
      if (tile.bomb === 'V') rotation = Math.PI / 2;
      // 炸弹底部的呼吸光晕，区分于普通方块
      const halo = new Sprite(this.particleTex);
      halo.anchor.set(0.5);
      halo.tint = BOMB_HEX;
      halo.alpha = 0.35;
      halo.scale.set(3.2);
      halo.blendMode = 'add';
      gsap.to(halo, { alpha: 0.15, duration: 0.9, yoyo: true, repeat: -1, ease: 'sine.inOut' });
      box.addChild(halo);
    }
    const sp = new Sprite(texture);
    sp.anchor.set(0.5);
    sp.width = sp.height = size;
    sp.rotation = rotation;
    box.addChild(sp);
    return box;
  }

  /** 嵌片覆盖层：每格浅底纹 + 外围连续轮廓 + 角落效果标志，没有核心格 */
  drawInserts(inserts: InstalledInsert[], suppressedId: string | null): void {
    this.inserts = inserts;
    this.insertLayer.removeChildren().forEach((c) => c.destroy());
    for (const ins of inserts) {
      const suppressed = ins.id === suppressedId;
      const color = suppressed ? 0x777777 : INSERT_HEX[ins.type];
      const own = new Set(ins.cells.map(posKey));
      const g = new Graphics();
      for (const p of ins.cells) {
        const x = BOARD.x + p.c * CELL;
        const y = BOARD.y + p.r * CELL;
        g.rect(x + 1, y + 1, CELL - 2, CELL - 2).fill({ color, alpha: 0.16 });
      }
      for (const p of ins.cells) {
        const x = BOARD.x + p.c * CELL;
        const y = BOARD.y + p.r * CELL;
        if (!own.has(posKey({ r: p.r - 1, c: p.c }))) g.moveTo(x, y).lineTo(x + CELL, y);
        if (!own.has(posKey({ r: p.r + 1, c: p.c }))) g.moveTo(x, y + CELL).lineTo(x + CELL, y + CELL);
        if (!own.has(posKey({ r: p.r, c: p.c - 1 }))) g.moveTo(x, y).lineTo(x, y + CELL);
        if (!own.has(posKey({ r: p.r, c: p.c + 1 }))) g.moveTo(x + CELL, y).lineTo(x + CELL, y + CELL);
      }
      g.stroke({ width: 2.5, color, alpha: suppressed ? 0.6 : 0.95 });
      this.insertLayer.addChild(g);
      for (const p of ins.cells) {
        const label = new Text({
          text: suppressed ? '封' : INSERT_GLYPH[ins.type],
          style: { fontFamily: 'system-ui, sans-serif', fontSize: 13, fill: color, fontWeight: '700' },
        });
        label.alpha = 0.9;
        label.position.set(BOARD.x + p.c * CELL + 5, BOARD.y + p.r * CELL + 3);
        this.insertLayer.addChild(label);
      }
    }
  }

  // ---------- 播放结算事件 ----------

  async play(events: ResolutionEvent[]): Promise<void> {
    for (const ev of events) {
      switch (ev.type) {
        case 'swap':
          await this.playSwap(ev.from, ev.to);
          break;
        case 'ignite': {
          const s = this.spriteAt(ev.at);
          if (s) await gsap.to(s.scale, { x: 1.3, y: 1.3, duration: 0.1, yoyo: true, repeat: 1 });
          break;
        }
        case 'matches':
          await this.playMatches(ev);
          break;
        case 'wave':
          await this.playWave(ev);
          break;
        case 'gravity':
          await this.playGravity(ev);
          break;
        case 'noMatch':
          break;
      }
    }
  }

  private spriteAt(p: Pos): Container | undefined {
    const id = this.grid[p.r]?.[p.c];
    return id == null ? undefined : this.sprites.get(id);
  }

  private async playSwap(from: Pos, to: Pos): Promise<void> {
    const a = this.grid[from.r]![from.c]!;
    const b = this.grid[to.r]![to.c]!;
    this.grid[from.r]![from.c] = b;
    this.grid[to.r]![to.c] = a;
    const tl = gsap.timeline();
    tl.to(this.sprites.get(a)!, { ...center(to), duration: 0.16, ease: 'power2.inOut' }, 0);
    tl.to(this.sprites.get(b)!, { ...center(from), duration: 0.16, ease: 'power2.inOut' }, 0);
    await tl;
  }

  private removeTile(tl: gsap.core.Timeline, id: number, at: number, color: number, big = false): void {
    const s = this.sprites.get(id);
    if (!s) return;
    this.sprites.delete(id);
    tl.to(s.scale, { x: big ? 1.6 : 1.25, y: big ? 1.6 : 1.25, duration: 0.08, ease: 'power1.out' }, at);
    tl.to(s, { alpha: 0, duration: 0.12 }, at + 0.05);
    tl.call(() => this.burst(s.x, s.y, color, big ? 14 : 7), [], at);
    tl.call(() => this.destroyTile(s), [], at + 0.2);
  }

  private addTile(tl: gsap.core.Timeline, tile: Tile, p: Pos, at: number): void {
    const s = this.makeTile(tile);
    const { x, y } = center(p);
    s.position.set(x, y);
    s.scale.set(0);
    this.sprites.set(tile.id, s);
    this.grid[p.r]![p.c] = tile.id;
    tl.call(() => this.tileLayer.addChild(s), [], at);
    tl.to(s.scale, { x: 1, y: 1, duration: 0.22, ease: 'back.out(2.5)' }, at);
    tl.call(() => this.flashCell(p, 0xffd27a, 0.9), [], at);
  }

  private tileColor(tile: Tile): number {
    return tile.kind === 'normal' ? COLOR_HEX[tile.color] : BOMB_HEX;
  }

  private async playMatches(ev: Extract<ResolutionEvent, { type: 'matches' }>): Promise<void> {
    const tl = gsap.timeline();
    for (const c of ev.cleared) {
      this.removeTile(tl, c.id, 0, this.tileColor(c.tile));
      this.grid[c.pos.r]![c.pos.c] = null;
    }
    for (const b of ev.created) {
      const old = this.grid[b.at.r]![b.at.c];
      if (old != null) this.removeTile(tl, old, 0.06, 0xffd27a);
      this.addTile(tl, { id: b.id, kind: 'bomb', bomb: b.bomb }, b.at, 0.14);
    }
    this.glowInserts(tl, ev.insertTriggers.map((t) => t.insertId), 0);
    tl.to({}, { duration: 0.08 });
    await tl;
  }

  private async playWave(ev: Extract<ResolutionEvent, { type: 'wave' }>): Promise<void> {
    const tl = gsap.timeline();
    // 每格的延迟 = 与最近一个爆炸锚点的距离 × 扩散步长
    const delay = new Map<number, number>();
    for (const e of ev.explosions) {
      for (const p of e.cells) {
        const d = chebyshev(e.origin, p) * RIPPLE_STEP;
        const k = posKey(p);
        delay.set(k, Math.min(delay.get(k) ?? Infinity, d));
      }
    }
    const at = (p: Pos) => delay.get(posKey(p)) ?? 0;

    for (const c of ev.consumed) {
      this.removeTile(tl, c.id, 0, BOMB_HEX, true);
      this.grid[c.pos.r]![c.pos.c] = null;
    }
    for (const e of ev.explosions) this.explosionFx(tl, e);
    for (const c of ev.cleared) {
      this.removeTile(tl, c.id, at(c.pos), this.tileColor(c.tile));
      this.grid[c.pos.r]![c.pos.c] = null;
    }
    for (const cv of ev.converted) {
      const t = cv.from ? at(cv.from.pos) : 0;
      if (cv.from && this.sprites.has(cv.from.id)) this.removeTile(tl, cv.from.id, t, this.tileColor(cv.from.tile));
      this.addTile(tl, { id: cv.id, kind: 'bomb', bomb: cv.bomb }, cv.at, t + 0.05);
    }
    for (const q of ev.queued) {
      const s = this.spriteAt(q.at);
      if (s) tl.to(s, { x: s.x + 4, duration: 0.04, yoyo: true, repeat: 3 }, at(q.at));
    }
    for (const trig of ev.insertTriggers) {
      const t = Math.min(...trig.at.map(at));
      this.glowInserts(tl, [trig.insertId], Number.isFinite(t) ? t : 0);
    }
    const cleared = ev.cleared.length + ev.consumed.length;
    if (cleared > 6) tl.call(() => this.shake(Math.min(14, 3 + cleared / 4)), [], 0);
    tl.to({}, { duration: 0.1 });
    await tl;
  }

  private explosionFx(tl: gsap.core.Timeline, e: Explosion): void {
    const o = center(e.origin);
    const reach = Math.max(0, ...e.cells.map((p) => chebyshev(e.origin, p))) * RIPPLE_STEP;
    if (e.shape === 'H' || e.shape === 'V') {
      // 直线光束从锚点向两侧展开
      for (const dir of [-1, 1]) {
        const beam = new Graphics();
        const len =
          e.shape === 'H'
            ? dir > 0 ? BOARD.x + BOARD.size - o.x : o.x - BOARD.x
            : dir > 0 ? BOARD.y + BOARD.size - o.y : o.y - BOARD.y;
        if (e.shape === 'H') beam.rect(0, -13, len, 26).fill({ color: 0xffb347, alpha: 0.85 });
        else beam.rect(-13, 0, 26, len).fill({ color: 0xffb347, alpha: 0.85 });
        beam.position.set(o.x, o.y);
        if (e.shape === 'H') beam.scale.set(0, 1);
        else beam.scale.set(1, 0);
        this.fxLayer.addChild(beam);
        const prop = e.shape === 'H' ? { x: dir } : { y: dir };
        tl.to(beam.scale, { ...prop, duration: Math.max(0.12, reach), ease: 'power1.out' }, 0);
        tl.to(beam, { alpha: 0, duration: 0.25 }, Math.max(0.12, reach));
        tl.call(() => beam.destroy(), [], Math.max(0.12, reach) + 0.26);
      }
    } else if (e.shape === 'CB') {
      // 五连炸弹：从锚点向每个目标格发出电弧
      for (const p of e.cells) {
        const t = center(p);
        const bolt = new Graphics().moveTo(o.x, o.y).lineTo((o.x + t.x) / 2 + (Math.random() - 0.5) * 30, (o.y + t.y) / 2 + (Math.random() - 0.5) * 30).lineTo(t.x, t.y);
        bolt.stroke({ width: 3, color: 0xd9a8ff, alpha: 0.95 });
        bolt.alpha = 0;
        this.fxLayer.addChild(bolt);
        const d = chebyshev(e.origin, p) * RIPPLE_STEP;
        tl.to(bolt, { alpha: 1, duration: 0.04 }, d);
        tl.to(bolt, { alpha: 0, duration: 0.2 }, d + 0.08);
        tl.call(() => bolt.destroy(), [], d + 0.3);
      }
    } else {
      // 范围爆炸：锚点冲击环 + 逐格闪光
      const ring = new Graphics().circle(0, 0, CELL).stroke({ width: 10, color: 0xffc36b, alpha: 0.9 });
      ring.position.set(o.x, o.y);
      ring.scale.set(0.2);
      this.fxLayer.addChild(ring);
      const radius = e.shape === 'board' ? 6 : e.shape === 'A' ? 1.8 : 3;
      tl.to(ring.scale, { x: radius, y: radius, duration: Math.max(0.2, reach + 0.1), ease: 'power2.out' }, 0);
      tl.to(ring, { alpha: 0, duration: 0.25 }, Math.max(0.1, reach - 0.05));
      tl.call(() => ring.destroy(), [], reach + 0.4);
    }
    for (const p of e.cells) tl.call(() => this.flashCell(p, 0xffc36b, 0.55), [], chebyshev(e.origin, p) * RIPPLE_STEP);
  }

  private flashCell(p: Pos, color: number, alpha: number): void {
    const { x, y } = center(p);
    const f = new Graphics().roundRect(x - CELL / 2 + 2, y - CELL / 2 + 2, CELL - 4, CELL - 4, 10).fill({ color, alpha });
    this.fxLayer.addChild(f);
    gsap.to(f, { alpha: 0, duration: 0.3, onComplete: () => f.destroy() });
  }

  private burst(x: number, y: number, color: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const p = new Sprite(this.particleTex);
      p.anchor.set(0.5);
      p.tint = color;
      p.position.set(x, y);
      p.scale.set(0.35 + Math.random() * 0.3);
      this.fxLayer.addChild(p);
      const a = Math.random() * Math.PI * 2;
      const dist = 24 + Math.random() * 38;
      gsap.to(p, { x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist, alpha: 0, duration: 0.35 + Math.random() * 0.2, ease: 'power2.out', onComplete: () => p.destroy() });
      gsap.to(p.scale, { x: 0.05, y: 0.05, duration: 0.5 });
    }
  }

  private glowInserts(tl: gsap.core.Timeline, ids: string[], at: number): void {
    for (const id of new Set(ids)) {
      const ins = this.inserts.find((i) => i.id === id);
      if (!ins) continue;
      const g = new Graphics();
      for (const p of ins.cells) g.rect(BOARD.x + p.c * CELL, BOARD.y + p.r * CELL, CELL, CELL).fill({ color: INSERT_HEX[ins.type], alpha: 0.45 });
      g.alpha = 0;
      this.insertGlow.addChild(g);
      tl.to(g, { alpha: 1, duration: 0.06 }, at);
      tl.to(g, { alpha: 0, duration: 0.35 }, at + 0.1);
      tl.call(() => g.destroy(), [], at + 0.5);
    }
  }

  private async playGravity(ev: Extract<ResolutionEvent, { type: 'gravity' }>): Promise<void> {
    const tl = gsap.timeline();
    const fall = (rows: number) => 0.1 + Math.sqrt(rows) * 0.07;
    for (const m of ev.moves) this.grid[m.from.r]![m.from.c] = null;
    for (const m of ev.moves) {
      this.grid[m.to.r]![m.to.c] = m.id;
      const s = this.sprites.get(m.id);
      if (!s) continue;
      const rows = Math.abs(m.to.r - m.from.r);
      tl.to(s, { y: center(m.to).y, duration: fall(rows), ease: 'power2.in' }, 0);
      tl.to(s.scale, { y: 0.88, x: 1.08, duration: 0.05, yoyo: true, repeat: 1 }, fall(rows));
    }
    const dir = ev.gravity === 'down' ? -1 : 1;
    for (const sp of ev.spawns) {
      const s = this.makeTile({ id: sp.id, kind: 'normal', color: sp.color });
      const target = center(sp.to);
      s.position.set(target.x, target.y + dir * sp.entryOffset * CELL);
      this.sprites.set(sp.id, s);
      this.grid[sp.to.r]![sp.to.c] = sp.id;
      this.tileLayer.addChild(s);
      tl.to(s, { y: target.y, duration: fall(sp.entryOffset + 1), ease: 'power2.in' }, 0);
      tl.to(s.scale, { y: 0.88, x: 1.08, duration: 0.05, yoyo: true, repeat: 1 }, fall(sp.entryOffset + 1));
    }
    await tl;
  }

  private shake(strength: number): void {
    const tl = gsap.timeline();
    for (let i = 0; i < 5; i++) tl.to(this.root, { x: (Math.random() - 0.5) * strength, y: (Math.random() - 0.5) * strength, duration: 0.035 });
    tl.to(this.root, { x: 0, y: 0, duration: 0.05 });
  }

  // ---------- 战斗表现 ----------

  private floatText(x: number, y: number, text: string, color: number, size = 38): void {
    const t = new Text({ text, style: { fontFamily: 'system-ui, sans-serif', fontSize: size, fontWeight: '800', fill: color, stroke: { color: 0x000000, width: 6 } } });
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.uiLayer.addChild(t);
    gsap.fromTo(t.scale, { x: 0.4, y: 0.4 }, { x: 1, y: 1, duration: 0.25, ease: 'back.out(3)' });
    gsap.to(t, { y: y - 70, alpha: 0, duration: 1.1, delay: 0.4, ease: 'power1.in', onComplete: () => t.destroy() });
  }

  async playPlayerEffects(log: ActionLog): Promise<void> {
    if (!log.settlement) return;
    const tl = gsap.timeline();
    const dealt = log.damageToEnemyHp + log.damageToEnemyShield;
    if (dealt > 0) {
      tl.to(this.alchemist, { x: 1060, duration: 0.12, ease: 'power2.out' }, 0);
      tl.to(this.alchemist, { x: 1010, duration: 0.25, ease: 'power2.inOut' }, 0.12);
      tl.to(this.mole, { x: 1410, duration: 0.05, yoyo: true, repeat: 3 }, 0.12);
      tl.call(() => this.floatText(1390, 460, `-${dealt}`, 0xff5a5a, 48), [], 0.12);
    }
    if (log.shieldGained > 0) tl.call(() => this.floatText(1010, 300, `+${log.shieldGained} 护盾`, 0x7cc4ff), [], 0.05);
    if (log.poisonAdded > 0) tl.call(() => this.floatText(1390, 520, `+${log.poisonAdded} 毒`, 0x6dff7a, 30), [], 0.2);
    if (log.stunApplied) tl.call(() => this.floatText(1390, 400, '眩晕！', 0xd6ff5c, 44), [], 0.35);
    tl.to({}, { duration: 0.45 });
    await tl;
  }

  async playEnemyTurn(log: EnemyTurnLog): Promise<void> {
    const tl = gsap.timeline();
    const fuse = log.fuseDamageToShield + log.fuseDamageToHp;
    if (fuse > 0) {
      tl.call(() => this.floatText(1010, 360, `引信 -${fuse}`, 0xff8a2a, 34), [], 0);
      tl.to({}, { duration: 0.5 });
    }
    const t0 = fuse > 0 ? 0.5 : 0;
    if (log.counterDamage > 0) tl.call(() => this.floatText(1390, 440, `反击 -${log.counterDamage}`, 0x9fe0ff, 36), [], t0 + 0.35);
    if (log.apBonusNext > 0) tl.call(() => this.floatText(1010, 250, `下回合 +${log.apBonusNext} 行动力`, 0xffd76a, 28), [], t0 + 0.4);
    if (log.cancelledByStun) {
      tl.to(this.mole, { rotation: -0.08, duration: 0.1, yoyo: true, repeat: 3 }, t0);
      tl.call(() => this.floatText(1390, 420, '眩晕中，行动取消', 0xd6ff5c, 30), [], t0);
    } else {
      const hit = log.damageToPlayerHp + log.damageToPlayerShield;
      if (hit > 0) {
        tl.to(this.mole, { x: 1280, duration: 0.14, ease: 'power3.in' }, t0);
        tl.to(this.mole, { x: 1390, duration: 0.3, ease: 'power2.out' }, t0 + 0.14);
        tl.to(this.alchemist, { x: 990, duration: 0.05, yoyo: true, repeat: 3 }, t0 + 0.14);
        tl.call(() => this.shake(10), [], t0 + 0.14);
        if (log.damageToPlayerShield > 0) tl.call(() => this.floatText(1010, 330, `-${log.damageToPlayerShield} 护盾`, 0x7cc4ff, 32), [], t0 + 0.14);
        if (log.damageToPlayerHp > 0) tl.call(() => this.floatText(1010, 400, `-${log.damageToPlayerHp}`, 0xff5a5a, 48), [], t0 + 0.2);
      } else {
        tl.to(this.mole.scale, { x: this.mole.scale.x * 1.05, duration: 0.15, yoyo: true, repeat: 1 }, t0);
      }
    }
    tl.to({}, { duration: 0.5 });
    await tl;
  }
}
