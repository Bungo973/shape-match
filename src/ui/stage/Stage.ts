// 战斗舞台（PixiJS）：绘制场景与棋盘，按引擎事件日志播放动画，并把玩家输入转成交换／点燃请求。
// 舞台只负责呈现，不做任何规则计算；动画结束后以引擎给出的棋盘为准重新同步。
import gsap from 'gsap';
import { Application, Assets, Container, Graphics, GraphicsContext, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import {
  DEFAULT_CONFIG,
  chainMultiplier,
  multiplierCap,
  posKey,
  type ActionLog,
  type Board,
  type Color,
  type EnemyTurnLog,
  type Explosion,
  type InsertType,
  type InstalledInsert,
  type Pos,
  type ResolutionEvent,
  type Tile,
} from '../../engine';
import { sfx } from '../audio';
import { INSERT_HEX, insertSymbolSvg } from '../insertStyle';

export const STAGE_W = 1600;
export const STAGE_H = 900;
const FRAME = { x: 36, y: 120, size: 720 };
/** 棋盘底图内框约占整图的 1115/1254 */
const BOARD = { x: FRAME.x + (FRAME.size - 640) / 2, y: FRAME.y + (FRAME.size - 640) / 2, size: 640 };
/** 棋盘行列数（原型可用 ?board= 改变）；显示区域固定，格子随之缩放 */
const ROWS = DEFAULT_CONFIG.rows;
const COLS = DEFAULT_CONFIG.cols;
const CELL = BOARD.size / Math.max(ROWS, COLS);
/** 爆炸从锚点向外每扩散一格的延迟（秒） */
const RIPPLE_STEP = 0.035;
/** 方块被清除后淡出所需的时间；该列在此之后即可下落 */
const CLEAR_FADE = 0.12;
/** 炸弹被波及到自身爆炸的引信延迟 */
const FUSE_DELAY = 0.05;
/** 倍率槽：嵌在棋盘框右侧的木边上，自下而上填充，每段 = 倍率 +1 */
const METER = { x: FRAME.x + FRAME.size - 32, y: BOARD.y + 24, w: 24, h: BOARD.size - 48 };
/** 倍率槽各段的颜色，越往上越热 */
const METER_HEX = [0xffc05a, 0xff9a3c, 0xff6b3d, 0xff4a8a, 0xd65cff];
/** 棋盘格角标符号的像素尺寸 */
const SYMBOL_SIZE = 20;

const COLOR_HEX: Record<Color, number> = { attack: 0xe6edf5, shield: 0x5aa8ff, poison: 0x5cff6a, catalyst: 0xff5ce1 };
const BOMB_HEX = 0xff8a2a;
const STONE_HEX = 0x9a9aa0;
type TextureKey = 'attack' | 'shield' | 'poison' | 'catalyst' | 'stone' | 'line' | 'area' | 'color' | 'alchemist' | 'bg' | 'bgRuins' | 'bgRelic' | 'frame';
const TEXTURE_URLS: Record<TextureKey, string> = {
  attack: '/game/tile-attack.webp',
  shield: '/game/tile-shield.webp',
  poison: '/game/tile-poison.webp',
  catalyst: '/game/tile-catalyst.webp',
  stone: '/game/tile-stone.webp',
  line: '/game/bomb-line.webp',
  area: '/game/bomb-area.webp',
  color: '/game/bomb-color.webp',
  alchemist: '/game/alchemist.webp',
  bg: '/game/bg-entrance.webp',
  bgRuins: '/game/bg-sealed-ruins.webp',
  bgRelic: '/game/bg-relic-hall.webp',
  frame: '/game/board-frame.webp',
};

/** 敌人外观：图片、显示宽度、脚底所在的 y；飞行敌人悬空并上下浮动 */
const ENEMY_LOOKS: Record<string, { width: number; bottom: number; x: number; flying?: boolean }> = {
  'crystal-mole': { width: 470, bottom: 720, x: 1375 },
  'cave-bats': { width: 400, bottom: 600, x: 1390, flying: true },
  'rock-crab': { width: 440, bottom: 735, x: 1382 },
  // 第二层 · 封印遗迹
  'stone-guardian': { width: 440, bottom: 728, x: 1380 },
  'spore-cluster': { width: 380, bottom: 728, x: 1385 },
  'rune-spider': { width: 460, bottom: 735, x: 1395 },
  // 第三层 · 悬浮遗物殿：漂浮碎石的敌人上下浮动
  'mimic-chest': { width: 400, bottom: 728, x: 1385 },
  'relic-raider': { width: 400, bottom: 728, x: 1385 },
  'relic-colossus': { width: 500, bottom: 740, x: 1350, flying: true },
};

/** 各层的战斗背景 */
const LAYER_BG: Record<1 | 2 | 3, TextureKey> = { 1: 'bg', 2: 'bgRuins', 3: 'bgRelic' };
/** 主角站位 */
const HERO = { x: 985, bottom: 720, height: 420 };

export interface StageHandlers {
  onSwap(from: Pos, to: Pos): void;
  onIgnite(at: Pos): void;
  /** 调试：放炸弹模式下点击格子 */
  onPlace?(at: Pos): void;
  /** 嵌片卡模式：鼠标所在格变化（离开棋盘时为 null） */
  onCellHover?(at: Pos | null): void;
  /** 嵌片卡模式：点击棋盘格 */
  onCellClick?(at: Pos): void;
}

/** 方块的外观签名：精灵只在签名一致时才能复用 */
const tileSig = (t: Tile) => (t.kind === 'normal' ? t.color : t.kind === 'stone' ? 'stone' : `bomb-${t.bomb}`);
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
  /** 本次结算中的连锁层数、被动清除累计与倍率档位，用于实时反馈 */
  private chain = 0;
  private passiveSoFar = 0;
  /** 本次行动已达到的整数倍率，用于升档爆点 */
  private tier = 1;
  private readonly meter = new Graphics();
  private meterText!: Text;
  /** 倍率槽当前显示的值（补间中） */
  private readonly meterValue = { v: 1 };
  /** 本次行动主动清除的方块位置与颜色：结算后化作光点飞向目标 */
  private activeHits: { x: number; y: number; color: Color }[] = [];
  private chainText!: Text;
  private enemyBaseTint = 0xffffff;
  private alchemist!: Sprite;
  private enemy!: Sprite;
  private readonly enemyTex = new Map<string, Texture>();
  private bgSprite!: Sprite;
  private readonly intentMark = new Graphics();
  private enemyIdle: gsap.core.Tween[] = [];
  private enemyNote!: Text;
  /** 当前敌人的站位 x，动画以此为基准 */
  private enemyX = 1380;

  private readonly sprites = new Map<number, Container>();
  private grid: (number | null)[][] = [];
  private board: Board = [];
  private inserts: InstalledInsert[] = [];
  private selected: Pos | null = null;
  private cursorPos: Pos = { r: 3, c: 3 };
  private drag: { cell: Pos; x: number; y: number } | null = null;

  busy = false;
  placeMode = false;
  /** 嵌片卡模式：棋盘输入改为悬停预览与点击放置，不再交换 */
  cardMode = false;
  private readonly ghost = new Graphics();
  private hoverCell: Pos | null = null;

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

  /** 切换敌人外观；缺少该敌人的图片时，用着色的鼹鼠占位并标注 */
  setEnemy(id: string): void {
    const look = ENEMY_LOOKS[id] ?? { width: 470, bottom: 720, x: 1380 };
    this.enemyX = look.x;
    const tex = this.enemyTex.get(id);
    const fallback = this.enemyTex.get('crystal-mole')!;
    this.enemyIdle.forEach((t) => t.kill());
    gsap.killTweensOf(this.enemy);
    gsap.killTweensOf(this.enemy.scale);
    this.enemy.texture = tex ?? fallback;
    this.enemyBaseTint = tex ? 0xffffff : 0xa0a8ff;
    this.enemy.tint = this.enemyBaseTint;
    this.enemy.rotation = 0;
    this.enemy.scale.set(look.width / this.enemy.texture.width);
    this.enemy.position.set(look.x, look.bottom);
    this.enemyIdle = [gsap.to(this.enemy.scale, { y: this.enemy.scale.y * 1.02, duration: 1.3, yoyo: true, repeat: -1, ease: 'sine.inOut' })];
    if (look.flying) this.enemyIdle.push(gsap.to(this.enemy, { y: look.bottom - 18, duration: 0.9, yoyo: true, repeat: -1, ease: 'sine.inOut' }));
    this.enemyNote.text = tex ? '' : '（占位图）';
    this.enemyNote.position.set(look.x, look.bottom + 8);
  }

  /** 切换到某一层的战斗背景 */
  setLayer(layer: 1 | 2 | 3): void {
    this.bgSprite.texture = this.tex[LAYER_BG[layer]];
    this.bgSprite.width = STAGE_W;
    this.bgSprite.height = STAGE_H;
  }

  /**
   * 敌人意图对棋盘的预告：石化目标行用灰色虚线框标出。
   * 只传达敌人威胁，不提供走法提示（ENEMY_DESIGN 通用规则）。
   */
  showIntentMarks(petrifyRow: number | null): void {
    const g = this.intentMark.clear();
    if (petrifyRow == null) return;
    const y = BOARD.y + petrifyRow * CELL;
    const dash = 14;
    for (let x = BOARD.x; x < BOARD.x + BOARD.size; x += dash * 2) {
      g.moveTo(x, y + 2).lineTo(Math.min(x + dash, BOARD.x + BOARD.size), y + 2);
      g.moveTo(x, y + CELL - 2).lineTo(Math.min(x + dash, BOARD.x + BOARD.size), y + CELL - 2);
    }
    g.stroke({ width: 3, color: 0xc8c8d0, alpha: 0.9 });
    g.rect(BOARD.x, y, BOARD.size, CELL).fill({ color: 0x9a9aa0, alpha: 0.12 });
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
    // 敌人图片逐个加载，缺失的不影响启动
    await Promise.all(
      Object.keys(ENEMY_LOOKS).map(async (id) => {
        try {
          this.enemyTex.set(id, await Assets.load<Texture>(`/game/enemy-${id}.webp`));
        } catch {
          // 缺图时由 setEnemy 使用占位
        }
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
    this.bgSprite = bg;
    this.root.addChild(bg);
    // 左侧压暗，突出棋盘
    const shade = new Graphics().rect(0, 0, 820, STAGE_H).fill({ color: 0x000000, alpha: 0.35 });
    this.root.addChild(shade);

    // 角色
    this.alchemist = new Sprite(this.tex.alchemist);
    this.alchemist.anchor.set(0.5, 1);
    this.alchemist.scale.set(HERO.height / this.tex.alchemist.height);
    this.alchemist.position.set(HERO.x, HERO.bottom);
    this.enemy = new Sprite(this.enemyTex.get('crystal-mole'));
    this.enemy.anchor.set(0.5, 1);
    this.root.addChild(this.alchemist, this.enemy);
    gsap.to(this.alchemist.scale, { y: this.alchemist.scale.y * 1.015, duration: 1.6, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    this.enemyNote = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontSize: 16, fill: 0xd8d0c0, stroke: { color: 0x000000, width: 4 } } });
    this.enemyNote.anchor.set(0.5, 0);
    this.root.addChild(this.enemyNote);
    this.setEnemy('crystal-mole');

    // 棋盘底图与格线
    const frame = new Sprite(this.tex.frame);
    frame.position.set(FRAME.x, FRAME.y);
    frame.width = frame.height = FRAME.size;
    this.root.addChild(frame);
    const lines = new Graphics();
    for (let i = 1; i < COLS; i++) lines.moveTo(BOARD.x + i * CELL, BOARD.y).lineTo(BOARD.x + i * CELL, BOARD.y + BOARD.size);
    for (let i = 1; i < ROWS; i++) lines.moveTo(BOARD.x, BOARD.y + i * CELL).lineTo(BOARD.x + BOARD.size, BOARD.y + i * CELL);
    lines.stroke({ width: 1, color: 0x8fb3d9, alpha: 0.12 });
    this.root.addChild(lines);

    // 层级：嵌片 → 嵌片高亮 → 方块（遮罩到棋盘内）→ 特效 → 选择与提示
    const mask = new Graphics().rect(BOARD.x, BOARD.y, BOARD.size, BOARD.size).fill(0xffffff);
    this.tileLayer.mask = mask;
    this.insertGlow.blendMode = 'add';
    this.fxLayer.blendMode = 'add';
    this.root.addChild(this.insertLayer, this.insertGlow, mask, this.tileLayer, this.fxLayer, this.uiLayer);
    this.uiLayer.addChild(this.intentMark, this.ghost, this.selection, this.cursor, this.hint);
    this.chainText = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 44, fontWeight: '900', fill: 0xffe08a, stroke: { color: 0x2a1405, width: 8 } },
    });
    this.chainText.anchor.set(0.5);
    this.chainText.position.set(BOARD.x + BOARD.size / 2, BOARD.y + 36);
    this.chainText.alpha = 0;
    this.uiLayer.addChild(this.chainText);
    this.buildMeter();
    this.cursor.visible = false;

    // 输入
    this.tileLayer.eventMode = 'static';
    this.tileLayer.hitArea = new Rectangle(BOARD.x, BOARD.y, BOARD.size, BOARD.size);
    this.tileLayer.cursor = 'pointer';
    this.tileLayer.on('pointerdown', (e) => {
      const p = this.root.toLocal(e.global);
      const cell = this.cellAt(p.x, p.y);
      if (!cell || this.cardMode) return;
      this.drag = { cell, x: p.x, y: p.y };
    });
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    // 卡牌模式：在根节点接收点击再换算格子，不受上层预览、特效图层的遮挡影响
    app.stage.on('pointerdown', (e) => {
      if (!this.cardMode || this.busy || e.button !== 0) return;
      const p = this.root.toLocal(e.global);
      const cell = this.cellAt(p.x, p.y);
      if (cell) this.handlers.onCellClick?.(cell);
    });
    // 纯显示的图层不参与点击判定
    for (const layer of [this.insertLayer, this.insertGlow, this.fxLayer, this.uiLayer]) layer.eventMode = 'none';
    app.stage.on('globalpointermove', (e) => {
      if (this.cardMode) {
        const p = this.root.toLocal(e.global);
        const cell = this.cellAt(p.x, p.y);
        if (cell?.r !== this.hoverCell?.r || cell?.c !== this.hoverCell?.c) {
          this.hoverCell = cell;
          this.handlers.onCellHover?.(cell);
        }
        return;
      }
      if (!this.drag || this.busy) return;
      const p = this.root.toLocal(e.global);
      const dx = p.x - this.drag.x;
      const dy = p.y - this.drag.y;
      if (Math.hypot(dx, dy) < CELL * 0.35) return;
      const from = this.drag.cell;
      const to = Math.abs(dx) > Math.abs(dy) ? { r: from.r, c: from.c + Math.sign(dx) } : { r: from.r + Math.sign(dy), c: from.c };
      this.drag = null;
      this.clearSelection();
      if (to.r >= 0 && to.r < ROWS && to.c >= 0 && to.c < COLS) this.handlers.onSwap(from, to);
    });
    app.stage.on('pointerup', () => {
      if (this.drag) this.click(this.drag.cell);
      this.drag = null;
    });
    app.stage.on('pointerupoutside', () => (this.drag = null));
  }

  /**
   * 嵌片卡的放置预览：只标出将被覆盖的格子（输入确认），不预览后续连锁。
   * 超出棋盘的部分不画；legal 为 false 时用红色提示不能放下。
   */
  setGhost(cells: Pos[] | null, legal: boolean, color: number): void {
    this.ghost.clear();
    if (!cells) return;
    const tint = legal ? color : 0xff5a5a;
    for (const p of cells) {
      if (p.r < 0 || p.r >= ROWS || p.c < 0 || p.c >= COLS) continue;
      const x = BOARD.x + p.c * CELL;
      const y = BOARD.y + p.r * CELL;
      this.ghost.roundRect(x + 3, y + 3, CELL - 6, CELL - 6, 8).fill({ color: tint, alpha: 0.28 }).stroke({ width: 3, color: tint, alpha: 0.95 });
    }
  }

  private cellAt(x: number, y: number): Pos | null {
    const c = Math.floor((x - BOARD.x) / CELL);
    const r = Math.floor((y - BOARD.y) / CELL);
    return r >= 0 && r < ROWS && c >= 0 && c < COLS ? { r, c } : null;
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
    this.hint.text = tile?.kind === 'bomb' ? '再点一次原地点燃，或换向相邻格在落点引爆' : '';
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
      this.cursorPos = { r: Math.max(0, Math.min(ROWS - 1, this.cursorPos.r + d[key]!.r)), c: Math.max(0, Math.min(COLS - 1, this.cursorPos.c + d[key]!.c)) };
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
        // 编号相同但种类不同（例如新战斗重新编号）时，旧图片不能复用
        if (s && s.label !== tileSig(tile)) {
          this.destroyTile(s);
          this.sprites.delete(tile.id);
          s = undefined;
        }
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

  /** 新战斗开始：清掉上一场的全部方块精灵与选择状态 */
  resetBoard(): void {
    for (const s of this.sprites.values()) this.destroyTile(s);
    this.sprites.clear();
    this.grid = [];
    this.clearSelection();
  }

  private makeTile(tile: Tile): Container {
    const box = new Container();
    box.label = tileSig(tile);
    let texture: Texture;
    let size = CELL * 0.76;
    let rotation = 0;
    if (tile.kind === 'normal') {
      texture = this.tex[tile.color];
    } else if (tile.kind === 'stone') {
      texture = this.tex.stone;
      size = CELL * 0.8;
    } else {
      size = CELL * 0.86;
      texture = tile.bomb === 'CB' ? this.tex.color : tile.bomb === 'A' ? this.tex.area : this.tex.line;
      if (tile.bomb === 'V') rotation = Math.PI / 2;
      // 炸弹底部的呼吸光晕，区分于普通方块
      const halo = new Sprite(this.particleTex);
      halo.anchor.set(0.5);
      halo.tint = BOMB_HEX;
      halo.alpha = 0.35;
      halo.scale.set((3.2 * CELL) / 80);
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

  private readonly symbolContexts = new Map<InsertType, GraphicsContext>();

  /** 同一种嵌片的符号只解析一次 SVG，所有格子共享 */
  private symbolContext(type: InsertType): GraphicsContext {
    let ctx = this.symbolContexts.get(type);
    if (!ctx) {
      ctx = new GraphicsContext().svg(insertSymbolSvg(type));
      this.symbolContexts.set(type, ctx);
    }
    return ctx;
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
      // 每个覆盖格左上角放同一个矢量符号；被压制时改为“封”字
      for (const p of ins.cells) {
        const x = BOARD.x + p.c * CELL + 4;
        const y = BOARD.y + p.r * CELL + 4;
        if (suppressed) {
          const label = new Text({ text: '封', style: { fontFamily: 'system-ui, sans-serif', fontSize: 14, fill: color, fontWeight: '700' } });
          label.position.set(x + 1, y - 1);
          this.insertLayer.addChild(label);
        } else {
          const sym = new Graphics(this.symbolContext(ins.type));
          sym.scale.set(SYMBOL_SIZE / 24);
          sym.position.set(x, y);
          sym.alpha = 0.95;
          this.insertLayer.addChild(sym);
        }
      }
    }
  }

  // ---------- 播放结算事件 ----------

  /**
   * 把事件日志排进一条总时间线。结果完全来自日志，这里只决定“何时播放”：
   * - 每一列独立下落：某列在日志中最后一次被清除后立即开始落，不等其他列；
   * - 爆炸接力按因果衔接：下一波的每个爆炸在它的来源炸弹被波及时点燃，不等上一波整体播完；
   * - 之后的匹配或爆炸要等它涉及的列落定。
   * 下落只在本列内移动，因此日志顺序与各列的先后关系都得以保持。
   */
  async play(events: ResolutionEvent[]): Promise<void> {
    this.chain = 0;
    this.passiveSoFar = 0;
    this.tier = 1;
    this.activeHits = [];
    this.tweenMeter(1, 0.15);
    const cols = this.grid[0]?.length ?? COLS;
    const master = gsap.timeline();
    /** 各列方块落定的时刻；在此之前该列不能开始新的匹配或爆炸 */
    const settled = new Array<number>(cols).fill(0);
    /** 各列最后一次清除播完的时刻；该列的下落从此开始 */
    const clearEnd = new Array<number>(cols).fill(0);
    /** 每格被清除或波及的时刻，用于让下一波爆炸在来源炸弹被波及时点燃 */
    let hitAt = new Map<number, number>();
    let cursor = 0;
    const settledOf = (ps: Pos[]) => Math.max(0, ...ps.map((p) => settled[p.c]!));
    const markCleared = (t: number, p: Pos) => {
      clearEnd[p.c] = Math.max(clearEnd[p.c]!, t + CLEAR_FADE);
      hitAt.set(posKey(p), t);
    };

    for (const ev of events) {
      switch (ev.type) {
        case 'swap': {
          const tl = this.playSwap(ev.from, ev.to);
          master.add(tl, cursor);
          cursor += tl.duration();
          settled.fill(cursor);
          clearEnd.fill(cursor);
          break;
        }
        case 'ignite': {
          const s = this.spriteAt(ev.at);
          if (s) master.to(s.scale, { x: 1.3, y: 1.3, duration: 0.1, yoyo: true, repeat: 1 }, cursor);
          cursor += 0.2;
          settled.fill(cursor);
          clearEnd.fill(cursor);
          break;
        }
        case 'matches': {
          const cells = [...ev.cleared.map((c) => c.pos), ...ev.created.map((b) => b.at)];
          const start = Math.max(cursor, settledOf(cells));
          const tl = this.playMatches(ev);
          master.add(tl, start);
          hitAt = new Map();
          for (const c of ev.cleared) markCleared(start, c.pos);
          for (const b of ev.created) hitAt.set(posKey(b.at), start + 0.14);
          cursor = start;
          break;
        }
        case 'wave': {
          // 每个爆炸的点燃时刻：来源炸弹被波及的时刻（首波由玩家动作或匹配直接点燃）
          const ignite = ev.explosions.map((e) => {
            const t = hitAt.get(posKey(e.origin));
            return Math.max(cursor, t === undefined ? cursor : t + FUSE_DELAY);
          });
          const touched = ev.explosions.flatMap((e) => e.cells);
          const start = Math.max(ignite.length ? Math.min(...ignite) : cursor, settledOf(touched));
          const offsets = ignite.map((t) => Math.max(0, t - start));
          const { tl, at } = this.playWave(ev, offsets);
          master.add(tl, start);
          hitAt = new Map();
          for (const c of [...ev.cleared, ...ev.consumed]) markCleared(start + at(c.pos), c.pos);
          for (const q of ev.queued) hitAt.set(posKey(q.at), start + at(q.at));
          for (const cv of ev.converted) if (cv.from) markCleared(start + at(cv.from.pos), cv.from.pos);
          for (const cv of ev.converted) hitAt.set(posKey(cv.at), start + (cv.from ? at(cv.from.pos) : 0) + 0.05);
          cursor = start;
          break;
        }
        case 'gravity': {
          const byCol = this.playGravity(ev);
          let first = Infinity;
          for (const [c, tl] of byCol) {
            // 不等其他列：本次下落之前、这一列的所有清除都已排好
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
          // 死局自动重排：等全部下落结束后，所有方块同时滑向新位置
          const start = Math.max(cursor, ...settled);
          master.add(this.playShuffle(ev), start);
          cursor = start + 0.6;
          break;
        }
      }
    }
    await master;
    if (this.chain > 0) gsap.to(this.chainText, { alpha: 0, duration: 0.4, delay: 0.5 });
  }

  // ---------- 实时反馈 ----------

  private showChain(): void {
    const t = this.chainText;
    gsap.killTweensOf(t);
    gsap.killTweensOf(t.scale);
    t.text = `连锁 ${this.chain}`;
    t.style.fill = [0xffe08a, 0xffc05a, 0xff9a3c, 0xff6b3d, 0xff4a8a][Math.min(4, this.chain - 1)]!;
    t.alpha = 1;
    gsap.fromTo(t.scale, { x: 1.7, y: 1.7 }, { x: 1, y: 1, duration: 0.25, ease: 'back.out(3)' });
  }

  /** 被动清除推高倍率槽；跨过整数倍率时爆点，填满时更大的爆点 */
  private addPassive(n: number): void {
    if (n <= 0) return;
    this.passiveSoFar += n;
    const m = chainMultiplier(this.passiveSoFar, DEFAULT_CONFIG);
    this.tweenMeter(m, 0.22);
    const tier = Math.floor(m);
    if (tier <= this.tier) return;
    this.tier = tier;
    const full = m >= multiplierCap(DEFAULT_CONFIG);
    sfx.multiplierUp(tier - 1);
    this.banner(full ? `满槽 ×${tier}！` : `倍率 ×${tier}！`, METER_HEX[Math.min(METER_HEX.length - 1, tier - 2)]!, full ? 92 : 76, BOARD.y + BOARD.size / 2);
    this.flashBoard(0xffd27a, full ? 0.6 : 0.35);
    this.shake(4 + tier * 3);
  }

  // ---------- 倍率槽 ----------

  private buildMeter(): void {
    this.uiLayer.addChild(this.meter);
    const cap = multiplierCap(DEFAULT_CONFIG);
    const segH = METER.h / (cap - 1);
    // 刻度数字：写在每段顶端下方，段高相同，所需清除数越往上越多
    for (let k = 2; k <= cap; k++) {
      const t = new Text({ text: `${k}`, style: { fontFamily: 'system-ui, sans-serif', fontSize: 13, fontWeight: '800', fill: 0xfff3dc, stroke: { color: 0x1a0c02, width: 3 } } });
      t.anchor.set(0.5, 0);
      t.position.set(METER.x + METER.w / 2, METER.y + METER.h - (k - 1) * segH + 3);
      t.alpha = 0.85;
      this.uiLayer.addChild(t);
    }
    this.meterText = new Text({ text: '×1.0', style: { fontFamily: 'system-ui, sans-serif', fontSize: 22, fontWeight: '900', fill: 0xffe08a, stroke: { color: 0x1a0c02, width: 5 } } });
    this.meterText.anchor.set(0.5, 1);
    this.meterText.position.set(METER.x + METER.w / 2, METER.y - 4);
    this.uiLayer.addChild(this.meterText);
    this.drawMeter();
  }

  private drawMeter(): void {
    const v = this.meterValue.v;
    const cap = multiplierCap(DEFAULT_CONFIG);
    const segH = METER.h / (cap - 1);
    const bottom = METER.y + METER.h;
    const g = this.meter.clear();
    g.roundRect(METER.x - 3, METER.y - 3, METER.w + 6, METER.h + 6, 8).fill({ color: 0x140a04, alpha: 0.9 }).stroke({ width: 2, color: 0x000000, alpha: 0.6 });
    for (let i = 0; i < cap - 1; i++) {
      const fill = Math.max(0, Math.min(1, v - 1 - i));
      if (fill <= 0) break;
      g.rect(METER.x, bottom - (i + fill) * segH, METER.w, fill * segH).fill({ color: METER_HEX[i]!, alpha: 0.95 });
    }
    for (let i = 1; i < cap - 1; i++) g.rect(METER.x, bottom - i * segH - 1, METER.w, 2).fill({ color: 0xfff3dc, alpha: 0.55 });
    this.meterText.text = `×${(Math.floor(v * 10 + 1e-6) / 10).toFixed(1)}`;
    this.meterText.style.fill = v >= 2 ? METER_HEX[Math.min(METER_HEX.length - 1, Math.floor(v) - 2)]! : 0xffe08a;
  }

  private tweenMeter(target: number, duration: number): void {
    gsap.killTweensOf(this.meterValue);
    gsap.to(this.meterValue, { v: target, duration, ease: 'power2.out', onUpdate: () => this.drawMeter() });
  }

  private recordActive(entries: { pos: Pos; tile: Tile }[]): void {
    for (const e of entries) {
      if (e.tile.kind !== 'normal') continue;
      const { x, y } = center(e.pos);
      this.activeHits.push({ x, y, color: e.tile.color });
    }
  }

  /** 棋盘中央的大字：倍率升档、每步评价 */
  private banner(text: string, color: number, size: number, y: number, hold = 0.55): void {
    const t = new Text({ text, style: { fontFamily: 'system-ui, sans-serif', fontSize: size, fontWeight: '900', fill: color, stroke: { color: 0x1a0c02, width: 10 } } });
    t.anchor.set(0.5);
    t.position.set(BOARD.x + BOARD.size / 2, y);
    this.uiLayer.addChild(t);
    gsap.fromTo(t.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(3)' });
    gsap.to(t, { alpha: 0, y: y - 30, duration: 0.35, delay: hold, onComplete: () => t.destroy() });
  }

  private flashBoard(color: number, alpha: number): void {
    const f = new Graphics().rect(BOARD.x, BOARD.y, BOARD.size, BOARD.size).fill({ color, alpha });
    f.blendMode = 'add';
    this.fxLayer.addChild(f);
    gsap.to(f, { alpha: 0, duration: 0.35, onComplete: () => f.destroy() });
  }

  /** 画面停顿：打击感的关键，短暂冻结所有补间 */
  private hitStop(ms: number): void {
    gsap.globalTimeline.pause();
    window.setTimeout(() => gsap.globalTimeline.resume(), ms);
  }

  /** 每步评价与组合技名称，由界面在结算后调用 */
  showRating(rating: { level: number; text: string; combo?: string }): void {
    const colors = [0x8fd0ff, 0xffd76a, 0xff7ce8];
    const sizes = [58, 70, 84];
    const i = Math.max(0, Math.min(2, rating.level - 1));
    sfx.rating(rating.level);
    if (rating.combo) this.banner(rating.combo, 0xffffff, 40, BOARD.y + BOARD.size / 2 - 90, 0.7);
    this.banner(rating.text, colors[i]!, sizes[i]!, BOARD.y + BOARD.size / 2 - 20, 0.7);
  }

  private spriteAt(p: Pos): Container | undefined {
    const id = this.grid[p.r]?.[p.c];
    return id == null ? undefined : this.sprites.get(id);
  }

  private playSwap(from: Pos, to: Pos): gsap.core.Timeline {
    const a = this.grid[from.r]![from.c]!;
    const b = this.grid[to.r]![to.c]!;
    this.grid[from.r]![from.c] = b;
    this.grid[to.r]![to.c] = a;
    const tl = gsap.timeline();
    tl.call(() => sfx.swap(), [], 0);
    tl.to(this.sprites.get(a)!, { ...center(to), duration: 0.16, ease: 'power2.inOut' }, 0);
    tl.to(this.sprites.get(b)!, { ...center(from), duration: 0.16, ease: 'power2.inOut' }, 0);
    return tl;
  }

  /** 不能消除的交换：两枚方块互换半程后弹回，棋盘不变 */
  async playRejectedSwap(from: Pos, to: Pos): Promise<void> {
    const a = this.sprites.get(this.grid[from.r]?.[from.c] ?? -1);
    const b = this.sprites.get(this.grid[to.r]?.[to.c] ?? -1);
    if (!a || !b) return;
    const pa = center(from);
    const pb = center(to);
    const mid = (p: { x: number; y: number }, q: { x: number; y: number }) => ({ x: p.x + (q.x - p.x) * 0.45, y: p.y + (q.y - p.y) * 0.45 });
    const tl = gsap.timeline();
    tl.call(() => sfx.swap(), [], 0);
    tl.to(a, { ...mid(pa, pb), duration: 0.1, ease: 'power2.out' }, 0);
    tl.to(b, { ...mid(pb, pa), duration: 0.1, ease: 'power2.out' }, 0);
    tl.to(a, { ...pa, duration: 0.14, ease: 'back.out(3)' }, 0.1);
    tl.to(b, { ...pb, duration: 0.14, ease: 'back.out(3)' }, 0.1);
    await tl;
  }

  private playShuffle(ev: Extract<ResolutionEvent, { type: 'shuffle' }>): gsap.core.Timeline {
    const tl = gsap.timeline();
    tl.call(() => this.floatText(BOARD.x + BOARD.size / 2, BOARD.y + BOARD.size / 2, '无步可走，重新洗牌', 0xffe08a, 34), [], 0);
    for (const m of ev.moves) this.grid[m.from.r]![m.from.c] = null;
    for (const m of ev.moves) {
      this.grid[m.to.r]![m.to.c] = m.id;
      const s = this.sprites.get(m.id);
      if (s) tl.to(s, { ...center(m.to), duration: 0.45, ease: 'power2.inOut' }, 0.1);
    }
    return tl;
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
    return tile.kind === 'normal' ? COLOR_HEX[tile.color] : tile.kind === 'stone' ? STONE_HEX : BOMB_HEX;
  }

  private playMatches(ev: Extract<ResolutionEvent, { type: 'matches' }>): gsap.core.Timeline {
    const tl = gsap.timeline();
    if (ev.phase === 'passive') {
      tl.call(() => {
        this.chain++;
        this.showChain();
        sfx.pop(this.chain, ev.cleared.length);
      }, [], 0);
    } else {
      this.recordActive(ev.cleared);
      tl.call(() => sfx.pop(this.chain, ev.cleared.length), [], 0);
    }
    if (ev.created.length > 0) tl.call(() => sfx.bombCreate(), [], 0.14);
    // 亲手做出的特殊匹配：在产弹格旁标出基数翻倍
    for (const g of ev.groups) {
      if (g.bonus > 0 && g.bombCell) {
        const { x, y } = center(g.bombCell);
        tl.call(() => this.floatText(x, y - 30, `基数 +${g.bonus}`, 0xffe08a, 22), [], 0.18);
      }
    }
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
    if (ev.phase === 'passive') tl.call(() => this.addPassive(ev.cleared.length), [], CLEAR_FADE);
    return tl;
  }

  /** offsets：每个爆炸相对本波开始的点燃时刻，让接力的爆炸各自在来源炸弹被波及时点燃 */
  private playWave(ev: Extract<ResolutionEvent, { type: 'wave' }>, offsets: number[]): { tl: gsap.core.Timeline; at: (p: Pos) => number } {
    const tl = gsap.timeline();
    // 每格的延迟 = 所属爆炸的点燃时刻 + 与其锚点的距离 × 扩散步长，取最早者
    const delay = new Map<number, number>();
    ev.explosions.forEach((e, i) => {
      const o = offsets[i] ?? 0;
      delay.set(posKey(e.origin), Math.min(delay.get(posKey(e.origin)) ?? Infinity, o));
      for (const p of e.cells) {
        const k = posKey(p);
        delay.set(k, Math.min(delay.get(k) ?? Infinity, o + chebyshev(e.origin, p) * RIPPLE_STEP));
      }
    });
    const at = (p: Pos) => delay.get(posKey(p)) ?? 0;

    const combo = ev.explosions.some((e) => e.shape === 'cross' || e.shape === 'rows3' || e.shape === 'cols3' || e.shape === 'square5' || e.shape === 'board');
    const first = offsets.length ? Math.min(...offsets) : 0;
    tl.call(() => {
      sfx.explosion(delay.size + (combo ? 20 : 0));
      if (combo) {
        this.flashBoard(0xffffff, ev.explosions.some((e) => e.shape === 'board' || e.shape === 'square5') ? 0.6 : 0.4);
        this.hitStop(90);
      }
    }, [], first);
    if (ev.phase === 'active') this.recordActive([...ev.cleared, ...ev.converted.flatMap((c) => (c.from ? [c.from] : []))]);
    for (const c of ev.consumed) {
      this.removeTile(tl, c.id, at(c.pos), BOMB_HEX, true);
      this.grid[c.pos.r]![c.pos.c] = null;
    }
    ev.explosions.forEach((e, i) => this.explosionFx(tl, e, offsets[i] ?? 0));
    for (const c of ev.cleared) {
      this.removeTile(tl, c.id, at(c.pos), this.tileColor(c.tile));
      this.grid[c.pos.r]![c.pos.c] = null;
    }
    for (const cv of ev.converted) {
      const t = cv.from ? at(cv.from.pos) : first;
      if (cv.from && this.sprites.has(cv.from.id)) this.removeTile(tl, cv.from.id, t, this.tileColor(cv.from.tile));
      this.addTile(tl, { id: cv.id, kind: 'bomb', bomb: cv.bomb }, cv.at, t + 0.05);
    }
    for (const q of ev.queued) {
      const s = this.spriteAt(q.at);
      if (s) tl.to(s, { x: s.x + 4, duration: 0.04, yoyo: true, repeat: 3 }, at(q.at));
    }
    for (const trig of ev.insertTriggers) {
      const t = Math.min(...trig.at.map(at));
      this.glowInserts(tl, [trig.insertId], Number.isFinite(t) ? t : first);
    }
    const cleared = ev.cleared.length + ev.consumed.length;
    if (cleared > 6) tl.call(() => this.shake(Math.min(14, 3 + cleared / 4)), [], first);
    if (ev.phase === 'passive') {
      const n = cleared + ev.converted.filter((c) => c.from).length;
      tl.call(() => this.addPassive(n), [], Math.max(first, ...[...delay.values()]) + CLEAR_FADE);
    }
    return { tl, at };
  }

  /** 爆炸特效排在自己的子时间线上，整体放到点燃时刻 offset */
  private explosionFx(outer: gsap.core.Timeline, e: Explosion, offset = 0): void {
    const tl = gsap.timeline();
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
    } else if (e.shape === 'lightning') {
      // 雷鸣引线：从锚点劈向每个落点的折线闪电，比五连的电弧更亮、更粗
      for (const p of e.cells) {
        const t = center(p);
        const bolt = new Graphics().moveTo(o.x, o.y);
        const steps = 4;
        for (let i = 1; i < steps; i++) {
          const k = i / steps;
          bolt.lineTo(o.x + (t.x - o.x) * k + (Math.random() - 0.5) * 36, o.y + (t.y - o.y) * k + (Math.random() - 0.5) * 36);
        }
        bolt.lineTo(t.x, t.y).stroke({ width: 5, color: 0xfff6b0, alpha: 1 });
        bolt.alpha = 0;
        this.fxLayer.addChild(bolt);
        // 与方块碎裂的时刻一致（playWave 按锚点距离 × 扩散步长清除）
        const d = chebyshev(e.origin, p) * RIPPLE_STEP;
        tl.to(bolt, { alpha: 1, duration: 0.03 }, Math.max(0, d - 0.03));
        tl.to(bolt, { alpha: 0, duration: 0.22 }, d + 0.1);
        tl.call(() => bolt.destroy(), [], d + 0.35);
        tl.call(() => this.flashCell(p, 0xfff6b0, 0.8), [], d);
      }
      outer.add(tl, offset);
      return;
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
    outer.add(tl, offset);
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

  /** 下落只在本列内移动，因此按列拆成独立的子时间线，由 play() 各自排期 */
  private playGravity(ev: Extract<ResolutionEvent, { type: 'gravity' }>): Map<number, gsap.core.Timeline> {
    const byCol = new Map<number, gsap.core.Timeline>();
    const col = (c: number) => {
      let tl = byCol.get(c);
      if (!tl) byCol.set(c, (tl = gsap.timeline()));
      return tl;
    };
    const fall = (rows: number) => 0.08 + Math.sqrt(rows) * 0.06;
    for (const m of ev.moves) this.grid[m.from.r]![m.from.c] = null;
    for (const m of ev.moves) {
      this.grid[m.to.r]![m.to.c] = m.id;
      const s = this.sprites.get(m.id);
      if (!s) continue;
      const tl = col(m.to.c);
      const rows = Math.abs(m.to.r - m.from.r);
      tl.to(s, { y: center(m.to).y, duration: fall(rows), ease: 'power2.in' }, 0);
      tl.to(s.scale, { y: 0.88, x: 1.08, duration: 0.05, yoyo: true, repeat: 1 }, fall(rows));
    }
    const dir = ev.gravity === 'down' ? -1 : 1;
    for (const sp of ev.spawns) {
      const s = this.makeTile({ id: sp.id, kind: 'normal', color: sp.color });
      const target = center(sp.to);
      // 棋盘外的等待位置被遮罩挡住，可以提前放好
      s.position.set(target.x, target.y + dir * sp.entryOffset * CELL);
      this.sprites.set(sp.id, s);
      this.grid[sp.to.r]![sp.to.c] = sp.id;
      this.tileLayer.addChild(s);
      const tl = col(sp.to.c);
      tl.to(s, { y: target.y, duration: fall(sp.entryOffset + 1), ease: 'power2.in' }, 0);
      tl.to(s.scale, { y: 0.88, x: 1.08, duration: 0.05, yoyo: true, repeat: 1 }, fall(sp.entryOffset + 1));
    }
    return byCol;
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

  /** 从棋盘上的主动清除位置发出光点，飞向目标后触发 onArrive */
  private orbs(tl: gsap.core.Timeline, from: { x: number; y: number }[], color: number, to: { x: number; y: number }, start: number): number {
    const picks = from.length > 10 ? from.filter((_, i) => i % Math.ceil(from.length / 10) === 0) : from;
    let last = start;
    picks.forEach((p, i) => {
      const orb = new Sprite(this.particleTex);
      orb.anchor.set(0.5);
      orb.tint = color;
      orb.blendMode = 'add';
      orb.scale.set(0.9);
      orb.position.set(p.x, p.y);
      orb.alpha = 0;
      this.fxLayer.addChild(orb);
      const t = start + i * 0.03;
      // 先向上弹起，再加速冲向目标，形成弧线
      const mid = { x: (p.x + to.x) / 2, y: Math.min(p.y, to.y) - 120 - Math.random() * 60 };
      tl.set(orb, { alpha: 1 }, t);
      tl.to(orb, { x: mid.x, y: mid.y, duration: 0.18, ease: 'power1.out' }, t);
      tl.to(orb, { x: to.x + (Math.random() - 0.5) * 30, y: to.y + (Math.random() - 0.5) * 30, duration: 0.2, ease: 'power2.in' }, t + 0.18);
      tl.to(orb.scale, { x: 0.3, y: 0.3, duration: 0.2 }, t + 0.18);
      tl.call(() => orb.destroy(), [], t + 0.4);
      last = Math.max(last, t + 0.38);
    });
    return last;
  }

  async playPlayerEffects(log: ActionLog): Promise<void> {
    if (!log.settlement) return;
    // 倍率槽落到最终倍率（含神器修正与侵蚀），与结算面板一致
    this.tweenMeter(log.settlement.multiplier, 0.2);
    const tl = gsap.timeline();
    const fx = log.settlement.finalEffects;
    const enemyAt = { x: this.enemyX, y: this.enemy.y - this.enemy.height * 0.5 };
    const heroAt = { x: HERO.x, y: HERO.bottom - HERO.height * 0.55 };
    const hitsOf = (c: Color) => this.activeHits.filter((h) => h.color === c);
    const dealt = log.damageToEnemyHp + log.damageToEnemyShield;

    // 攻击：光点飞向敌人，命中时停顿、闪红、后仰、大数字
    if (dealt > 0) {
      tl.to(this.alchemist, { x: HERO.x + 50, duration: 0.12, ease: 'power2.out' }, 0);
      tl.to(this.alchemist, { x: HERO.x, duration: 0.25, ease: 'power2.inOut' }, 0.12);
      const src = hitsOf('attack').length ? hitsOf('attack') : [heroAt];
      const arrive = this.orbs(tl, src, COLOR_HEX.attack, enemyAt, 0.05);
      const big = dealt >= 30;
      tl.call(
        () => {
          sfx.hitEnemy(big);
          this.hitStop(big ? 110 : 60);
          this.enemy.tint = 0xff7070;
          gsap.delayedCall(0.12, () => (this.enemy.tint = this.enemyBaseTint));
          this.shake(Math.min(18, 4 + dealt / 5));
          this.floatText(this.enemyX, 440, `-${dealt}`, 0xff5a5a, Math.min(96, 44 + dealt / 2));
        },
        [],
        arrive,
      );
      tl.to(this.enemy, { x: this.enemyX + 26, duration: 0.06, ease: 'power2.out' }, arrive);
      tl.to(this.enemy, { x: this.enemyX, duration: 0.3, ease: 'elastic.out(1, 0.4)' }, arrive + 0.06);
    }
    // 护盾：光点飞回主角
    if (log.shieldGained > 0 || fx.shield > 0) {
      const src = hitsOf('shield').length ? hitsOf('shield') : [heroAt];
      const arrive = this.orbs(tl, src, COLOR_HEX.shield, heroAt, 0.1);
      tl.call(() => {
        sfx.shield();
        this.floatText(HERO.x, 300, log.shieldGained > 0 ? `+${log.shieldGained} 护盾` : '护盾已满', 0x7cc4ff);
      }, [], arrive);
    }
    // 毒气：光点飞向敌人
    if (log.poisonAdded > 0 || log.stunApplied) {
      const src = hitsOf('poison').length ? hitsOf('poison') : [heroAt];
      const arrive = this.orbs(tl, src, COLOR_HEX.poison, enemyAt, 0.15);
      tl.call(() => {
        sfx.absorb();
        if (log.poisonAdded > 0) this.floatText(this.enemyX, 520, `+${log.poisonAdded} 毒`, 0x6dff7a, 30);
        if (log.stunApplied) {
          sfx.stun();
          this.floatText(this.enemyX, 380, '眩晕！', 0xd6ff5c, 52);
        }
      }, [], arrive);
    }
    tl.to({}, { duration: 0.35 });
    await tl;
  }

  async playEnemyTurn(log: EnemyTurnLog): Promise<void> {
    const tl = gsap.timeline();
    const fuse = log.fuseDamageToShield + log.fuseDamageToHp;
    if (fuse > 0) {
      tl.call(() => this.floatText(HERO.x, 360, `引信 -${fuse}`, 0xff8a2a, 34), [], 0);
      tl.to({}, { duration: 0.5 });
    }
    const t0 = fuse > 0 ? 0.5 : 0;
    if (log.counterDamage > 0) tl.call(() => this.floatText(this.enemyX, 440, `反击 -${log.counterDamage}`, 0x9fe0ff, 36), [], t0 + 0.35);
    if (log.apBonusNext > 0) tl.call(() => this.floatText(HERO.x, 250, `下回合 +${log.apBonusNext} 行动力`, 0xffd76a, 28), [], t0 + 0.4);
    if (log.cancelledByStun) {
      tl.to(this.enemy, { rotation: -0.08, duration: 0.1, yoyo: true, repeat: 3 }, t0);
      tl.call(() => {
        sfx.stun();
        this.floatText(this.enemyX, 420, '眩晕中，行动取消', 0xd6ff5c, 30);
      }, [], t0);
    } else {
      const hit = log.damageToPlayerHp + log.damageToPlayerShield;
      if (hit > 0) {
        tl.to(this.enemy, { x: this.enemyX - 110, duration: 0.14, ease: 'power3.in' }, t0);
        tl.to(this.enemy, { x: this.enemyX, duration: 0.3, ease: 'power2.out' }, t0 + 0.14);
        tl.to(this.alchemist, { x: HERO.x - 20, duration: 0.05, yoyo: true, repeat: 3 }, t0 + 0.14);
        tl.call(() => {
          this.shake(10);
          sfx.playerHit();
        }, [], t0 + 0.14);
        if (log.damageToPlayerShield > 0) tl.call(() => this.floatText(HERO.x, 330, `-${log.damageToPlayerShield} 护盾`, 0x7cc4ff, 32), [], t0 + 0.14);
        if (log.damageToPlayerHp > 0) tl.call(() => this.floatText(HERO.x, 400, `-${log.damageToPlayerHp}`, 0xff5a5a, 48), [], t0 + 0.2);
      } else {
        tl.to(this.enemy.scale, { x: this.enemy.scale.x * 1.05, duration: 0.15, yoyo: true, repeat: 1 }, t0);
      }
      // 石化：被选中的方块闪成灰色、变成石块（石块本身由随后的棋盘同步画出）
      if (log.petrified.length > 0) {
        const at = t0 + 0.3;
        tl.call(() => {
          sfx.shield();
          for (const p of log.petrified) {
            this.flashCell(p, STONE_HEX, 0.95);
            const s = this.spriteAt(p);
            if (s) gsap.to(s, { alpha: 0.2, duration: 0.25 });
          }
          const mid = log.petrified[Math.floor(log.petrified.length / 2)]!;
          this.floatText(center(mid).x, center(mid).y - 40, '石化！', 0xd8d8e0, 34);
        }, [], at);
        tl.to({}, { duration: 0.35 }, at);
      }
    }
    this.showIntentMarks(null);
    tl.to({}, { duration: 0.5 });
    await tl;
  }
}
