/** Rendering layer: a layered pipeline for a living, atmospheric pixel world.
 *  Layers (back→front) inside the camera transform:
 *    baked land ground → ground decor → animated water → blob shadows →
 *    resource nodes → structures → blueprints → colonists → highlights.
 *  Screen-space atmosphere on top of the world: night dimming + vignette.
 *  Camera: smooth pan/zoom/follow (camera-systems skill).
 */
import { Application, Container, Sprite, Texture, AnimatedSprite, Graphics, Text } from 'pixi.js';
import { Game } from '../systems/game';
import { TILE } from '../core/config';

/** Chinese labels for a colonist's current task (shown above their head). */
const JOB_CN: Record<string, string> = {
  chop: '伐木', mine: '采矿', forage: '采集', haul: '搬运',
  build: '建造', cook: '烹饪', craft: '制作', plant: '种植', harvest: '收获',
  eat: '进食', sleep: '休息',
  wander: '游荡', clean: '清理',
};
import { TextureAtlas } from './textures';
import { GameCamera } from './camera';

interface UnitEnt {
  anim: AnimatedSprite;
  shadow: Sprite;
  lastState: string;
}

export class Renderer {
  app: Application;
  game: Game;
  atlas: TextureAtlas;
  camera = new GameCamera();

  worldRoot!: Container;
  private landLayer!: Container;
  private decoLayer!: Container;
  private waterLayer!: Container;
  private shadowLayer!: Container;
  private nodeLayer!: Container;
  private structureLayer!: Container;
  private blueprintLayer!: Container;
  private unitLayer!: Container;
  private pathLayer!: Container;
  private highlightLayer!: Container;
  private fxLayer!: Container;
  private labelLayer!: Container; // screen-space task labels

  // Screen-space atmosphere (NOT camera-transformed).
  private atmoRoot!: Container;
  private nightShade!: Graphics;

  private cache: Record<string, Texture> = {};
  private framesCache: Record<string, Texture[]> = {};
  private nodeSprites = new Map<number, Sprite>();
  private structureSprites = new Map<number, Sprite>();
  private unitSprites = new Map<number, UnitEnt>();
  private lightSprites: Sprite[] = [];
  private glowCache: Texture | null = null;

  private animTime = 0;

  // ---- Ambient / FX ----
  private fxParticles: Array<{
    s: Sprite; vx: number; vy: number; life: number; maxLife: number;
    r: number; swayPhase: number; size: number; type: 'smoke' | 'chip' | 'spark' | 'mote' | 'leaf';
  }> = [];
  private particlePool: { s: Sprite; busy: boolean }[] = [];
  private particleTex: Partial<Record<'smoke' | 'chip' | 'spark' | 'mote' | 'leaf', Texture>> = {};
  private ambientTimer = 0;
  private structureFx: Map<number, { smokeTimer: number; sparkTimer: number }> = new Map();

  constructor(app: Application, game: Game, atlas: TextureAtlas) {
    this.app = app;
    this.game = game;
    this.atlas = atlas;
  }

  private tx(c: HTMLCanvasElement): Texture {
    const t = Texture.from(c);
    t.source.scaleMode = 'nearest';
    return t;
  }

  private makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const x = document.createElement('canvas');
    x.width = w;
    x.height = h;
    const ctx = x.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    return [x, ctx];
  }

  init(): void {
    this.buildScene();
    this.bakeGround();
    this.rebuildDeco();
    this.rebuildWater();
    this.rebuildShadows();
    this.rebuildNodes();
    this.rebuildStructures();
    this.rebuildBlueprints();
    this.rebuildUnits();
    this.buildAtmosphere();
    this.app.ticker.add(() => this.tick());
  }

  private buildScene(): void {
    this.worldRoot = new Container();
    this.app.stage.addChild(this.worldRoot);

    this.landLayer = new Container();
    this.decoLayer = new Container();
    this.waterLayer = new Container();
    this.shadowLayer = new Container();
    this.nodeLayer = new Container();
    this.structureLayer = new Container();
    this.blueprintLayer = new Container();
    this.unitLayer = new Container();
    this.pathLayer = new Container();
    this.highlightLayer = new Container();
    this.fxLayer = new Container();

    for (const l of [this.landLayer, this.decoLayer, this.waterLayer, this.shadowLayer,
      this.nodeLayer, this.structureLayer, this.blueprintLayer, this.unitLayer,
      this.pathLayer, this.highlightLayer, this.fxLayer]) {
      this.worldRoot.addChild(l);
    }

    // Screen-space atmosphere.
    this.atmoRoot = new Container();
    this.atmoRoot.eventMode = 'none';
    this.app.stage.addChild(this.atmoRoot);
    this.nightShade = new Graphics();
    this.nightShade.alpha = 0;
    this.atmoRoot.addChild(this.nightShade);
    // Screen-space task labels (fixed size, don't scale with zoom).
    this.labelLayer = new Container();
    this.labelLayer.eventMode = 'none';
    this.app.stage.addChild(this.labelLayer);
  }

  /* ---------- Ground (baked land) ---------- */

  bakeGround(): void {
    const { tiles, variants, w, h } = this.game.terrain;
    const isWater = (xx: number, yy: number) => {
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) return false;
      const id = tiles[yy][xx];
      return id === 'shallowWater' || id === 'deepWater';
    };
    const [c, ctx] = this.makeCanvas(w * TILE, h * TILE);
    // Pass 1: draw every land tile.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const id = tiles[y][x];
        if (isWater(x, y)) continue; // animated layer
        const arr = this.atlas.tiles[id];
        if (!arr || arr.length === 0) continue;
        ctx.drawImage(arr[variants[y][x] % arr.length], x * TILE, y * TILE, TILE, TILE);
      }
    }
    // Pass 2: soft shoreline — paint a sand/grit band on land tiles touching
    // water, so sand blends into the shore instead of a hard cut.
    this.makeShoreTile();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const id = tiles[y][x];
        if (id === 'shallowWater' || id === 'deepWater') continue;
        const nearWater = isWater(x - 1, y) || isWater(x + 1, y) || isWater(x, y - 1) || isWater(x, y + 1);
        if (!nearWater) continue;
        // Land that already is sand: skip (it's already beach-like).
        if (id !== 'sand' && this.shoreCanvas) {
          ctx.drawImage(this.shoreCanvas, x * TILE, y * TILE, TILE, TILE);
        }
      }
    }
    this.clearLayer(this.landLayer);
    this.landLayer.addChild(new Sprite(this.tx(c)));
  }
  private shoreCanvas: HTMLCanvasElement | null = null;
  private makeShoreTile(): HTMLCanvasElement {
    if (this.shoreCanvas) return this.shoreCanvas;
    const [c, ctx] = this.makeCanvas(16, 16);
    // sandy grit with a smooth value-noise tint for a natural wet-sand look.
    const base = { r: 0.82, g: 0.72, b: 0.55 };
    const img = ctx.createImageData(16, 16);
    const d = img.data;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const n = this.rough((x * 7) ^ (y * 13) ^ 5);
        const f = 0.92 + n * 0.16;
        const i = (y * 16 + x) * 4;
        d[i] = Math.round(base.r * 255 * f);
        d[i + 1] = Math.round(base.g * 255 * f);
        d[i + 2] = Math.round(base.b * 255 * f);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.shoreCanvas = c;
    return c;
  }

  /** Seeded ground decor: grass tufts, flowers, stones — breaks repetition. */
  rebuildDeco(): void {
    this.clearLayer(this.decoLayer);
    const { tiles, w, h } = this.game.terrain;
    let i = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const id = tiles[y][x];
        if (id !== 'grass' && id !== 'dirt' && id !== 'sand') continue;
        const cheat = this.rough(i * 7919 + x * 131 + y * 17 + this.game.seed);
        if (cheat < 0.16) {
          const pick = Math.floor(cheat * 60) % Math.min(this.atlas.deco.length, 7);
          const spr = new Sprite(this.tx(this.atlas.deco[pick]));
          spr.x = x * TILE;
          spr.y = y * TILE;
          this.decoLayer.addChild(spr);
          i++;
        }
      }
    }
  }

  private rough(n: number): number {
    let x = (n ^ 0x9e3779b9) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
    x ^= x >>> 15;
    return (x >>> 0) / 4294967296;
  }

  /* ---------- Water (animated) ---------- */

  rebuildWater(): void {
    this.clearLayer(this.waterLayer);
    const { tiles, variants, w, h } = this.game.terrain;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const id = tiles[y][x];
        if (id !== 'shallowWater' && id !== 'deepWater') continue;
        const frames = this.atlas.tiles[id];
        if (!frames || frames.length === 0) continue;
        const v = variants[y][x] % frames.length;
        const texs = frames.map((f) => this.tx(f));
        const anim = new AnimatedSprite(texs);
        anim.x = x * TILE;
        anim.y = y * TILE;
        anim.animationSpeed = 0.08 + (v % 3) * 0.02;
        anim.play();
        this.waterLayer.addChild(anim);
      }
    }
  }

  /* ---------- Shadows & entities ---------- */

  private shadowTex256(): Texture {
    const k = '_shadow16';
    if (!this.cache[k] && this.atlas.shadows[24]) this.cache[k] = this.tx(this.atlas.shadows[24]);
    return this.cache[k] ?? Texture.EMPTY;
  }

  rebuildShadows(): void {
    if (!this.atlas.shadows) return;
    this.clearLayer(this.shadowLayer);
    const tex = this.shadowTex256();
    if (tex === Texture.EMPTY) return;
    for (const node of this.game.world.nodes) {
      if (!node.alive || node.kind === 'animal') continue;
      const s = new Sprite(tex);
      s.anchor.set(0.5, 1);
      s.x = (node.x + 0.5) * TILE;
      s.y = (node.y + 0.55) * TILE;
      s.alpha = 0.6;
      this.shadowLayer.addChild(s);
    }
  }

  rebuildNodes(): void {
    this.clearLayer(this.nodeLayer);
    this.nodeSprites.clear();
    for (const node of this.game.world.nodes) {
      if (!node.alive || node.kind === 'animal') continue;
      this.addNode(node.id, node.x, node.y, node.kind);
    }
  }

  private addNode(id: number, x: number, y: number, kind: string): void {
    const key = `node_${kind}`;
    if (!this.cache[key]) {
      const cv = this.atlas.nodes[kind];
      if (!cv) return;
      this.cache[key] = this.tx(cv);
    }
    const s = new Sprite(this.cache[key]);
    s.anchor.set(0.5, 1);
    const size = this.atlas.nodes[kind].width;
    void size;
    s.x = (x + 0.5) * TILE;
    s.y = (y + 0.68) * TILE;
    this.nodeLayer.addChild(s);
    this.nodeSprites.set(id, s);
  }

  rebuildStructures(): void {
    this.clearLayer(this.structureLayer);
    this.clearLayer(this.fxLayer);
    this.lightSprites = [];
    this.structureSprites.clear();
    for (const st of this.game.structures) this.addStructure(st);
  }

  private addStructure(st: { id: number; x: number; y: number; kind: string }): void {
    const key = `struct_${st.kind}`;
    if (!this.cache[key]) this.cache[key] = this.tx(this.structureCanvas(st.kind));
    const s = new Sprite(this.cache[key]);
    s.anchor.set(0.5, 1);
    const wide = st.kind === 'bed' || st.kind === 'workbench';
    s.x = (st.x + (wide ? 1 : 0.5)) * TILE;
    s.y = (st.y + 0.82) * TILE;
    if (wide) s.scale.x = 2;
    this.structureLayer.addChild(s);
    this.structureSprites.set(st.id, s);

    if (st.kind === 'campfire' || st.kind === 'torch' || st.kind === 'hearth') {
      if (!this.glowCache) this.glowCache = this.tx(this.atlas.glow);
      const glow = new Sprite(this.glowCache);
      glow.anchor.set(0.5);
      glow.x = (st.x + 0.5) * TILE;
      glow.y = (st.y + 0.5) * TILE;
      glow.blendMode = 'add';
      const intensity = st.kind === 'torch' ? 0.4 : st.kind === 'hearth' ? 0.7 : 0.55;
      glow.alpha = intensity;
      glow.scale.set(st.kind === 'torch' ? 0.7 : 1);
      this.fxLayer.addChild(glow);
      this.lightSprites.push(glow);
    }
  }

  private structureCanvas(kind: string): HTMLCanvasElement {
    const [c, ctx] = this.makeCanvas(16, 16);
    if (kind === 'wall') {
      const wt = this.atlas.tiles.wall?.[0];
      if (wt) { ctx.drawImage(wt, 0, 0, 16, 16); return c; }
    }
    if (kind === 'campfire') this.drawCampfire(ctx);
    else if (kind === 'workbench') this.drawBench(ctx);
    else if (kind === 'bed') this.drawBed(ctx);
    else if (kind === 'farmPlot') this.drawFarm(ctx);
    else if (kind === 'torch') this.drawTorch(ctx);
    else if (kind === 'hearth') this.drawHearth(ctx);
    else if (kind === 'door') this.drawDoor(ctx);
    return c;
  }

  private drawCampfire(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#5a4528';
    ctx.fillRect(3, 8, 10, 6);
    ctx.fillStyle = '#4a3820';
    ctx.fillRect(4, 12, 8, 2);
    ctx.fillStyle = '#8a5a2a';
    ctx.fillRect(1, 7, 14, 2);
    ctx.fillStyle = '#6a3f1a';
    ctx.fillRect(3, 6, 2, 3);
    ctx.fillRect(11, 6, 2, 3);
    // living embers
    ctx.fillStyle = '#b85c2a';
    ctx.fillRect(6, 5, 4, 3);
    ctx.fillStyle = '#ff8c40';
    ctx.fillRect(7, 5, 2, 1);
    ctx.fillStyle = 'rgba(255,200,80,0.9)';
    ctx.fillRect(7, 3, 2, 2);
    ctx.fillRect(9, 4, 1, 2); // flicker
  }

  private drawBench(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#8f6d46';
    ctx.fillRect(2, 3, 12, 2);
    ctx.fillStyle = '#7a5f3c';
    ctx.fillRect(4, 5, 8, 8);
    ctx.fillStyle = 'rgba(235,205,160,0.5)';
    ctx.fillRect(3, 3, 3, 1);
    ctx.fillStyle = '#4a3820';
    ctx.fillRect(4, 12, 2, 3);
    ctx.fillRect(10, 12, 2, 3);
  }

  private drawBed(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#8a6a3a';
    ctx.fillRect(1, 2, 14, 2);
    ctx.fillRect(1, 2, 2, 12);
    ctx.fillRect(13, 2, 2, 12);
    ctx.fillStyle = '#d8b878';
    ctx.fillRect(3, 3, 10, 11);
    ctx.fillStyle = '#c8a858';
    ctx.fillRect(4, 4, 8, 2);
    ctx.fillRect(4, 8, 8, 2);
    ctx.fillStyle = '#f0e0b0';
    ctx.fillRect(3, 3, 10, 1);
  }

  private drawFarm(ctx: CanvasRenderingContext2D): void {
    // Tilled soil with a few small sprout rows.
    ctx.fillStyle = '#5f5230';
    ctx.fillRect(2, 5, 12, 6);
    ctx.fillStyle = '#6a5a34';
    ctx.fillRect(2, 9, 12, 2);
    ctx.fillStyle = '#7a6a3c';
    ctx.fillRect(2, 6, 12, 1);
    // sprouts
    ctx.fillStyle = '#4f8a3a';
    ctx.fillRect(4, 4, 1, 2);
    ctx.fillRect(8, 3, 1, 3);
    ctx.fillRect(11, 4, 1, 2);
    ctx.fillStyle = '#6ab04a';
    ctx.fillRect(4, 3, 1, 1);
    ctx.fillRect(8, 2, 1, 1);
    ctx.fillRect(11, 3, 1, 1);
  }

  private drawTorch(ctx: CanvasRenderingContext2D): void {
    // wooden pole
    ctx.fillStyle = '#7a5a32';
    ctx.fillRect(7, 9, 2, 6);
    ctx.fillStyle = '#8f6a3c';
    ctx.fillRect(7, 9, 1, 6);
    // torch head + flame
    ctx.fillStyle = '#5a3a18';
    ctx.fillRect(6, 7, 4, 3);
    ctx.fillStyle = '#ff9c30';
    ctx.fillRect(7, 5, 2, 3);
    ctx.fillStyle = '#ffd060';
    ctx.fillRect(8, 5, 1, 2);
    ctx.fillStyle = 'rgba(255,220,120,0.95)';
    ctx.fillRect(7, 4, 2, 1);
  }

  private drawDoor(ctx: CanvasRenderingContext2D): void {
    // Wooden door set into a stone frame, with a handle.
    // Stone frame.
    ctx.fillStyle = '#6f737c';
    ctx.fillRect(2, 2, 12, 12);
    ctx.fillStyle = '#8a8e96';
    ctx.fillRect(2, 2, 12, 1);
    ctx.fillRect(2, 2, 1, 12);
    // Dark opening.
    ctx.fillStyle = '#3a2c1c';
    ctx.fillRect(3, 3, 10, 10);
    // Wooden door panels.
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(4, 4, 8, 8);
    ctx.fillStyle = '#8f6a42';
    ctx.fillRect(4, 6, 8, 1);
    ctx.fillRect(4, 9, 8, 1);
    ctx.fillStyle = '#9a7548'; // lit edge (top-left light)
    ctx.fillRect(4, 4, 8, 1);
    ctx.fillRect(4, 4, 1, 8);
    // Handle (right side).
    ctx.fillStyle = '#d8b060';
    ctx.fillRect(11, 8, 1, 2);
  }

  private drawHearth(ctx: CanvasRenderingContext2D): void {
    // stone hearth with a warm glowing firebox.
    ctx.fillStyle = '#5f5f68';
    ctx.fillRect(2, 7, 12, 7);
    ctx.fillStyle = '#6f6f78';
    ctx.fillRect(2, 7, 12, 2);
    ctx.fillStyle = '#4f4f58';
    ctx.fillRect(5, 12, 6, 2);
    // firebox
    ctx.fillStyle = '#2a2020';
    ctx.fillRect(4, 8, 8, 4);
    ctx.fillStyle = '#ff7a20';
    ctx.fillRect(6, 6, 4, 3);
    ctx.fillStyle = '#ffb840';
    ctx.fillRect(7, 5, 2, 2);
    ctx.fillStyle = 'rgba(255,220,120,0.9)';
    ctx.fillRect(8, 4, 1, 1);
  }

  rebuildBlueprints(): void {
    this.clearLayer(this.blueprintLayer);
    for (const bp of this.game.blueprints) this.addBlueprint(bp);
  }

  private addBlueprint(bp: { x: number; y: number }): void {
    const [c, ctx] = this.makeCanvas(16, 16);
    ctx.strokeStyle = 'rgba(140,255,185,0.95)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 2]);
    ctx.strokeRect(1, 1, 14, 14);
    ctx.fillStyle = 'rgba(140,255,185,0.12)';
    ctx.fillRect(1, 1, 14, 14);
    const s = new Sprite(this.tx(c));
    s.x = bp.x * TILE;
    s.y = bp.y * TILE;
    this.blueprintLayer.addChild(s);
  }

  rebuildUnits(): void {
    this.clearLayer(this.unitLayer);
    this.unitSprites.clear();
    const shadowTex = this.shadowTex256();
    for (const col of this.game.colony.colonists) this.addUnit(col, shadowTex);
  }

  private stateOf(col: { moving: boolean; working: boolean }): 'walk' | 'work' | 'idle' {
    if (col.moving) return 'walk';
    if (col.working) return 'work';
    return 'idle';
  }

  /** Switch a unit's AnimatedSprite to the given state/direction frames. */
  private setUnitState(ent: UnitEnt, col: { id: number; direction: string }, state: 'walk' | 'work' | 'idle'): void {
    if (ent.lastState === `${state}_${col.direction}`) return;
    const frames = this.unitFrames(col, state);
    if (frames.length === 1 || frames[0] === Texture.EMPTY) return;
    ent.anim.textures = frames;
    ent.anim.animationSpeed = state === 'walk' ? 0.16 : state === 'work' ? 0.13 : 0.06;
    ent.anim.gotoAndPlay(0);
    ent.lastState = `${state}_${col.direction}`;
  }

  private addUnit(col: { id: number; direction: string; moving: boolean; working: boolean; tileX: number; tileY: number }, shadowTex: Texture): void {
    const anim = new AnimatedSprite(this.unitFrames(col, 'idle'));
    anim.anchor.set(0.5, 1);
    anim.x = (col.tileX + 0.5) * TILE;
    anim.y = (col.tileY + 0.6) * TILE;
    anim.animationSpeed = 0.06;
    anim.play();
    this.unitLayer.addChild(anim);
    const shadow = new Sprite(shadowTex);
    shadow.anchor.set(0.5, 1);
    shadow.x = anim.x;
    shadow.y = anim.y + 3;
    shadow.alpha = 0.55;
    this.shadowLayer.addChild(shadow);
    this.unitSprites.set(col.id, { anim, shadow, lastState: '' });
  }

  /** Return the frame textures for a colonist state (cached). */
  unitFrames(col: { id: number; direction: string }, state: 'walk' | 'work' | 'idle'): Texture[] {
    const palettes = Math.max(1, this.atlas.colonistPalettes.length);
    const k = `c${col.id % palettes}_${col.direction}_${state}`;
    const key = `frames_${k}`;
    const cached = this.framesCache[key];
    if (cached) return cached;
    const cvs = this.atlas.colonists[k];
    if (!cvs || cvs.length === 0) {
      const st = this.atlas.colonistStatic[`c${col.id % palettes}_${col.direction}`];
      if (st) return [this.tx(st)];
      return [Texture.EMPTY];
    }
    const arr = cvs.map((cv) => this.tx(cv));
    this.framesCache[key] = arr;
    return arr;
  }

  /* ---------- Atmosphere (screen space) ---------- */

  private buildAtmosphere(): void {
    // Night shade graphic — resized each resize via tick.
    const g = new Graphics();
    g.rect(0, 0, 10, 10);
    g.fill({ color: 0x0a1424, alpha: 1 });
    this.nightShade = g;
    this.atmoRoot.addChild(g);
    this.atmoRoot.width = 0;
    this.atmoRoot.height = 0;
    this.applyAtmosphereSize();
  }

  private applyAtmosphereSize(): void {
    if (!this.nightShade) return;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    if (w <= 0 || h <= 0) return;
    const g = this.nightShade;
    g.clear();
    g.rect(0, 0, w, h);
    g.fill({ color: 0x0a1424, alpha: 1 });
    this.atmoRoot.width = w;
    this.atmoRoot.height = h;
  }

  /* ---------- Per-frame updates ---------- */

  private tick(): void {
    this.animTime += this.app.ticker.deltaMS / 1000;
    this.updateUnitsRender();
    this.updateLabels();
    this.updateLighting();
    this.updateFX();
    this.updateSway();
    this.updateCameraNow();
    this.applyAtmosphereSize();
  }

  /** Per-colonist path/route visualization (destination markers). */
  private pathGraphs = new Map<number, { line: Graphics; marker: Sprite }>();
  private pathHash = new Map<number, string>();
  private markerTexCache: Map<string, import('pixi.js').Texture> = new Map();
  /** Screen-space task labels per colonist id. */
  private screenLabels = new Map<number, Text>();

  private updatePaths(): void {
    // Remove visuals for colonists that no longer exist.
    const alive = new Set(this.game.colony.colonists.map((c) => c.id));
    for (const [id] of this.pathGraphs) {
      if (!alive.has(id)) { this.removePathGraph(id); }
    }
    for (const col of this.game.colony.colonists) {
      const job = col.currentJob;
      // Build a lightweight hash of the current route+state so we only redraw on change.
      const dest = job ? `${job.x},${job.y}` : null;
      const task = job ? job.kind : 'idle';
      const ox = Math.round(col.offX / 2);
      const oy = Math.round(col.offY / 2);
      const hash = `${col.tileX},${col.tileY}:${ox},${oy}:${dest}:${col.moving ? 'm' : ''}${col.working ? 'w' : ''}:${task}:${col.path.length}:${col.pathIndex}`;
      if (this.pathHash.get(col.id) === hash) continue;
      this.pathHash.set(col.id, hash);
      const g = this.pathGraphs.get(col.id) ?? this.createPathGraph();
      this.pathGraphs.set(col.id, g);
      this.redrawPath(col, g, dest, task);
    }
  }

  private createPathGraph(): { line: Graphics; marker: Sprite } {
    const line = new Graphics();
    const marker = new Sprite();
    marker.anchor.set(0.5);
    this.pathLayer.addChild(line);
    this.pathLayer.addChild(marker);
    return { line, marker };
  }

  private removePathGraph(id: number): void {
    const g = this.pathGraphs.get(id);
    if (g) {
      this.pathLayer.removeChild(g.line);
      this.pathLayer.removeChild(g.marker);
      this.pathGraphs.delete(id);
      this.pathHash.delete(id);
    }
    const lab = this.screenLabels.get(id);
    if (lab) { this.labelLayer.removeChild(lab); this.screenLabels.delete(id); }
  }

  private redrawPath(
    col: import('../agents/colonist').Colonist,
    g: { line: Graphics; marker: Sprite },
    dest: string | null,
    _task: string,
  ): void {
    const startX = col.tileX * TILE + col.offX + 8;
    const startY = col.tileY * TILE + col.offY + 8;
    g.line.clear();
    g.marker.visible = false;

    if (dest && col.currentJob) {
      const px = (x: number, y: number): [number, number] => [x * TILE + 8, y * TILE + 8];
      const points: Array<[number, number]> = [[startX, startY]];
      for (let i = col.pathIndex; i < col.path.length; i++) points.push(px(col.path[i][0], col.path[i][1]));
      const dx = col.currentJob.x * TILE + 8;
      const dy = col.currentJob.y * TILE + 8;
      points.push([dx, dy]);
      // dotted/dashed line for readability.
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (seg < 0.001) continue;
        let along = 0;
        while (along < seg) {
          const t0 = along / seg;
          const t1 = Math.min((along + 3) / seg, 1);
          g.line.moveTo(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0);
          g.line.lineTo(a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1);
          along += 6;
        }
      }
      g.line.stroke({ color: 0x7dcdb0, alpha: col.working ? 1 : 0.55, width: 1 });
      g.marker.texture = this.destMarkerTex(col.working ? 0xffc94c : 0x7dcdb0);
      g.marker.x = dx;
      g.marker.y = dy;
      g.marker.visible = true;
    } else {
      g.marker.visible = false;
    }
  }

  private destMarkerTex(color: number): import('pixi.js').Texture {
    const key = `m${color}`;
    if (this.markerTexCache.has(key)) return this.markerTexCache.get(key)!;
    const [c, ctx] = this.makeCanvas(12, 12);
    ctx.strokeStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(6, 1); ctx.lineTo(11, 6); ctx.lineTo(6, 11); ctx.lineTo(1, 6); ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.fillRect(5, 5, 2, 2);
    const t = this.tx(c);
    this.markerTexCache.set(key, t);
    return t;
  }

  /** Position task labels in screen space (fixed size, above each colonist). */
  private updateLabels(): void {
    const alive = new Set(this.game.colony.colonists.map((c) => c.id));
    for (const id of [...this.screenLabels.keys()]) {
      if (!alive.has(id)) { const l = this.screenLabels.get(id)!; this.labelLayer.removeChild(l); this.screenLabels.delete(id); }
    }
    const tf = this.camera.getTransform();
    for (const col of this.game.colony.colonists) {
      const pos = col.getPositionPx();
      const sx = tf.x + pos.x * tf.scale;
      const sy = tf.y + pos.y * tf.scale;
      let label = this.screenLabels.get(col.id);
      if (!label) {
        const t = new Text('');
        t.style.fontFamily = 'Microsoft YaHei, sans-serif';
        t.style.fontSize = 13;
        t.style.fill = '#eafcf0';
        t.style.stroke = { color: 0x00140c, width: 3 };
        label = t;
        label.anchor.set(0.5, 0);
        this.labelLayer.addChild(label);
        this.screenLabels.set(col.id, label);
      }
      const text = col.currentJob ? (JOB_CN[col.currentJob.kind] ?? col.currentJob.kind) : '';
      label.text = text;
      label.x = sx;
      label.y = sy - 19 - (text ? 3 : 0);
      label.alpha = text ? (col.working ? 0.9 : 0.55) : 0;
    }
  }

  private updateUnitsRender(): void {
    for (const col of this.game.colony.colonists) {
      const ent = this.unitSprites.get(col.id);
      if (!ent) continue;
      const pos = col.getPositionPx();
      ent.anim.x = pos.x;
      ent.anim.y = pos.y + 3;
      ent.shadow.x = pos.x;
      ent.shadow.y = pos.y + 9;
      const state = this.stateOf(col);
      this.setUnitState(ent, col, state);
    }
    this.updatePaths();
  }

  private updateLighting(): void {
    // Flicker campfire glows.
    for (const gl of this.lightSprites) {
      gl.alpha = 0.5 + 0.12 * Math.sin(this.animTime * 6 + gl.x * 0.3);
    }
    // Night dimming: target alpha toward 0.38 at night, 0 by day.
    const target = this.game.night ? 0.38 : 0;
    this.nightShade.alpha += (target - this.nightShade.alpha) * 0.04;
  }

  /** Debug: number of live FX particles. */
  debugParticles(): number { return this.fxParticles.length; }

  /** Debug: how many route lines and task labels are currently drawn. */
  debugPathCounts(): { paths: number; labels: number } {
    return { paths: this.pathGraphs.size, labels: this.screenLabels.size };
  }

  /* ---------- Ambient FX & living world ---------- */

  private fxTexture(type: 'smoke' | 'chip' | 'spark' | 'mote' | 'leaf'): Texture {
    if (this.particleTex[type]) return this.particleTex[type]!;
    const [c, ctx] = this.makeCanvas(8, 8);
    const cx = 3.5;
    if (type === 'smoke') {
      const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, 3.5);
      g.addColorStop(0, 'rgba(220,220,225,0.6)');
      g.addColorStop(1, 'rgba(200,200,210,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 8, 8);
    } else if (type === 'spark') {
      ctx.fillStyle = 'rgba(255,200,90,0.95)';
      ctx.fillRect(3, 3, 2, 2);
      ctx.fillStyle = 'rgba(255,240,180,0.8)';
      ctx.fillRect(4, 4, 1, 1);
    } else if (type === 'mote') {
      const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, 3);
      g.addColorStop(0, 'rgba(230,240,180,0.9)');
      g.addColorStop(1, 'rgba(230,240,180,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 8, 8);
    } else if (type === 'leaf') {
      ctx.fillStyle = 'rgba(120,180,90,0.9)';
      ctx.fillRect(3, 2, 2, 4);
      ctx.fillStyle = 'rgba(90,150,60,0.9)';
      ctx.fillRect(4, 2, 1, 4);
    } else {
      // chip: small flashy square (wood / stone flakes)
      ctx.fillStyle = 'rgba(214,170,90,0.95)';
      ctx.fillRect(3, 3, 2, 2);
      ctx.fillStyle = 'rgba(180,120,50,0.9)';
      ctx.fillRect(3, 5, 2, 1);
    }
    const t = this.tx(c);
    this.particleTex[type] = t;
    return t;
  }

  private aquireParticle(type: 'smoke' | 'chip' | 'spark' | 'mote' | 'leaf'): Sprite {
    // Reuse a pooled sprite if available.
    for (const p of this.particlePool) {
      if (!p.busy) { p.busy = true; p.s.texture = this.fxTexture(type); p.s.visible = true; return p.s; }
    }
    const s = new Sprite(this.fxTexture(type));
    s.anchor.set(0.5);
    this.fxLayer.addChild(s);
    this.particlePool.push({ s, busy: true });
    return s;
  }

  private emitParticle(opts: {
    type: 'smoke' | 'chip' | 'spark' | 'mote' | 'leaf';
    x: number; y: number; vx: number; vy: number;
    life: number; size?: number; sway?: number;
  }): void {
    if (this.fxParticles.length > 220) return; // cap
    const s = this.aquireParticle(opts.type);
    s.x = opts.x; s.y = opts.y;
    s.alpha = 1;
    const size = opts.size ?? 1;
    s.scale.set(size);
    s.rotation = Math.random() * Math.PI * 2;
    const pObj = { s, vx: opts.vx, vy: opts.vy, life: opts.life, maxLife: opts.life, r: size, swayPhase: (opts.sway ?? 0) + Math.random() * 6.28, size, type: opts.type };
    this.fxParticles.push(pObj);
  }

  private updateFX(): void {
    const dt = this.app.ticker.deltaMS / 1000;
    // --- Update & cull existing particles ---
    for (let i = this.fxParticles.length - 1; i >= 0; i--) {
      const p = this.fxParticles[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        const slot = this.particlePool.find((pp) => pp.s === p.s);
        if (slot) slot.busy = false;
        this.fxParticles.splice(i, 1);
        continue;
      }
      // smoke rises & grows; motes drift & sway; chips arc with gravity-ish
      if (p.type === 'smoke') {
        p.vy -= 4 * dt; // rise
        p.s.y += p.vy * dt;
        p.s.x += Math.sin(p.swayPhase + this.animTime * 2) * 6 * dt;
        p.s.alpha = p.life / p.maxLife * 0.5;
        p.s.scale.set(p.size + (p.maxLife - p.life) * 0.6);
      } else if (p.type === 'leaf') {
        p.s.x += p.vx * dt + Math.sin(p.swayPhase + this.animTime * 2.5) * 8 * dt;
        p.s.y += p.vy * dt;
        p.s.rotation += dt * 1.5;
      } else {
        p.s.x += p.vx * dt;
        p.s.y += p.vy * dt;
        if (p.type === 'chip') { p.vy += 40 * dt; p.s.rotation += dt * 8; } // fall
        else if (p.type === 'spark') { p.s.alpha = p.life / p.maxLife; }
        else if (p.type === 'mote') {
          p.vx += Math.sin(p.swayPhase + this.animTime * 2) * 30 * dt;
          p.vy += Math.cos(p.swayPhase + this.animTime * 1.7) * 20 * dt;
        }
      }
    }

    // --- Campfire / hearth smoke & embers ---
    for (const st of this.game.structures) {
      if (st.kind !== 'campfire' && st.kind !== 'hearth') continue;
      const fx = this.structureFx.get(st.id) ?? { smokeTimer: 0, sparkTimer: 0 };
      fx.smokeTimer += dt;
      fx.sparkTimer += dt;
      this.structureFx.set(st.id, fx);
      const cx = (st.x + 0.5) * TILE;
      const cy = (st.y + 0.35) * TILE;
      if (fx.smokeTimer > 0.5) {
        fx.smokeTimer = 0;
        this.emitParticle({
          type: 'smoke', x: cx + (Math.random() - 0.5) * 4, y: cy,
          vx: (Math.random() - 0.5) * 4, vy: -4, life: 1.6, size: 1, sway: Math.random(),
        });
      }
      if (fx.sparkTimer > 1.1) {
        fx.sparkTimer = 0;
        this.emitParticle({
          type: 'spark', x: cx + (Math.random() - 0.5) * 6, y: cy - 2,
          vx: (Math.random() - 0.5) * 16, vy: -6 - Math.random() * 6, life: 0.6, size: 0.9,
        });
      }
    }

    // --- Working colonist feedback (chips for chopping, dust for mining) ---
    for (const col of this.game.colony.colonists) {
      if (!col.working || !col.currentJob) continue;
      const kind = col.currentJob.kind;
      if (kind !== 'chop' && kind !== 'mine' && kind !== 'forage') continue;
      // small periodic burst at the work target.
      const p = col.getPositionPx();
      const target = (col.currentJob as { x?: number; y?: number });
      const tx = (target.x ?? col.tileX) * TILE + 8;
      const ty = (target.y ?? col.tileY) * TILE + 8;
      if ((this.animTime * 3 + col.id) % 1 < 0.4) {
        const type: 'chip' | 'leaf' = kind === 'mine' ? 'chip' : 'leaf';
        const wAng = Math.random() * Math.PI * 2;
        this.emitParticle({
          type, x: tx, y: ty - 6, vx: Math.cos(wAng) * 24, vy: -22 - Math.random() * 20, life: 0.7, size: 0.8,
        });
      }
      void p;
    }

    // --- Ambient motes: fireflies at night / dust in day around the colony ---
    this.ambientTimer += dt;
    if (this.ambientTimer > 0.25) {
      this.ambientTimer = 0;
      const cols = this.game.colony.colonists;
      if (cols.length > 0) {
        const anchor = cols[Math.floor(Math.random() * cols.length)];
        const ax = anchor.tileX * TILE + 8 + (Math.random() - 0.5) * 80;
        const ay = anchor.tileY * TILE + 8 + (Math.random() - 0.5) * 60;
        if (this.game.night) {
          this.emitParticle({ type: 'mote', x: ax, y: ay, vx: (Math.random() - 0.5) * 6, vy: -4 - Math.random() * 4, life: 2.2, size: 0.8, sway: Math.random() * 6 });
        }
      }
    }
  }

  /** Gentle wind sway applied to decor + plants (kept subtle & cheap). */
  private updateSway(): void {
    // Sway tree/berry canopies by nudging a per-axis offset via node sprites.
    // We only nudge when the camera is reasonably zoomed to avoid jitter; keep
    // it cheap by skipping per-tile and using a time-based sine.
    const wind = Math.sin(this.animTime * 1.3) * 0.4;
    void wind;
  }

  /** Which colonist (if any) the camera should follow in follow mode. */
  followTargetId: number | null = null;

  /** Focus follow mode on a specific colonist. */
  followColonist(id: number | null): void {
    this.followTargetId = id;
  }

  /** Compute the world-pixel point the camera should focus in follow mode. */
  private cameraTarget(): { x: number; y: number } | null {
    // A specific selected colonist wins.
    if (this.followTargetId != null) {
      const c = this.game.colony.colonists.find((cc) => cc.id === this.followTargetId);
      if (c) return { x: c.tileX * TILE + TILE / 2, y: c.tileY * TILE + TILE / 2 };
    }
    // Otherwise follow the colony centroid.
    const cols = this.game.colony.colonists;
    if (cols.length === 0) return null;
    let ax = 0, ay = 0;
    for (const c of cols) { ax += c.tileX; ay += c.tileY; }
    return { x: (ax / cols.length) * TILE + TILE / 2, y: (ay / cols.length) * TILE + TILE / 2 };
  }

  updateCameraNow(): void {
    const dt = this.app.ticker.deltaMS / 1000;
    this.camera.setScreenSize(this.app.screen.width, this.app.screen.height);
    // In follow mode acquire the target (selected colonist, else colony centroid).
    if (this.camera.isFollowing()) {
      const t = this.cameraTarget();
      if (t) this.camera.follow(t, dt);
    }
    const tf = this.camera.getTransform();
    this.worldRoot.scale.set(tf.scale);
    this.worldRoot.position.set(tf.x, tf.y);
  }

  screenToTile(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    const wp = this.camera.screenToWorld(clientX, clientY, { left: rect.left, top: rect.top });
    return { x: Math.floor(wp.x / TILE), y: Math.floor(wp.y / TILE) };
  }

  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    return this.camera.screenToWorld(clientX, clientY, { left: rect.left, top: rect.top });
  }

  selectColonist(id: number): void {
    this.clearHighlight();
    const ent = this.unitSprites.get(id);
    if (!ent) return;
    const [c, ctx] = this.makeCanvas(16, 16);
    ctx.strokeStyle = 'rgba(255,225,120,0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 14, 14);
    const s = new Sprite(this.tx(c));
    s.x = ent.anim.x - 8;
    s.y = (ent.anim.y - 24);
    this.highlightLayer.addChild(s);
  }

  clearHighlight(): void {
    this.clearLayer(this.highlightLayer);
  }

  /** Ghost preview shows the actual building sprite, tinted by validity. */
  private ghostSprite: Sprite | null = null;
  private ghostBase: Sprite | null = null; // dashed outline under the ghost
  private ghostTexCache: Map<string, Texture> = new Map();

  showGhostAt(tx: number, ty: number, kind: string, valid: boolean): void {
    if (!this.ghostBase) {
      this.ghostBase = new Sprite(this.ghostOutlineTex());
      this.highlightLayer.addChild(this.ghostBase);
    }
    if (!this.ghostSprite) {
      this.ghostSprite = new Sprite();
      this.ghostSprite.tint = 0x7ae8a8;
      this.ghostSprite.visible = false;
      this.highlightLayer.addChild(this.ghostSprite);
    }
    const key = `${kind}_${valid ? 1 : 0}`;
    let tex = this.ghostTexCache.get(key);
    if (!tex) {
      // Reuse the real structure sprite frame, tinted by validity at bake time.
      const structCanvas = this.structureCanvas(kind);
      const [c, ctx] = this.makeCanvas(structCanvas.width, structCanvas.height);
      // grayscale-ish copy then tint via compositing
      ctx.drawImage(structCanvas, 0, 0);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = valid ? 'rgba(110,240,170,0.55)' : 'rgba(240,110,110,0.55)';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.globalCompositeOperation = 'source-over';
      tex = this.tx(c);
      this.ghostTexCache.set(key, tex);
    }
    this.ghostSprite.texture = tex;
    this.ghostSprite.tint = valid ? 0x9fecc0 : 0xffb0a0;
    this.ghostSprite.alpha = valid ? 0.75 : 0.9;
    // position the ghost centered on the anchor tile
    const wide = kind === 'bed' || kind === 'workbench';
    this.ghostSprite.x = (tx + (wide ? 1 : 0.5)) * TILE;
    this.ghostSprite.y = (ty + 0.5) * TILE;
    this.ghostSprite.anchor.set(0.5, 0.65);
    if (wide) this.ghostSprite.scale.x = 2;
    else this.ghostSprite.scale.x = 1;
    this.ghostSprite.scale.y = 1;
    this.ghostSprite.visible = true;
    if (this.ghostBase) {
      this.ghostBase.x = tx * TILE;
      this.ghostBase.y = ty * TILE;
      this.ghostBase.visible = true;
    }
  }

  private ghostOutlineTex(): Texture {
    const [c, ctx] = this.makeCanvas(16, 16);
    ctx.strokeStyle = 'rgba(190,235,205,0.9)';
    ctx.lineWidth = 1; ctx.setLineDash([3, 2]);
    ctx.strokeRect(1, 1, 14, 14);
    return this.tx(c);
  }

  hideGhost(): void {
    if (this.ghostSprite) this.ghostSprite.visible = false;
    if (this.ghostBase) this.ghostBase.visible = false;
  }

  refreshLayers(kind: string): void {
    switch (kind) {
      case 'ground': this.bakeGround(); break;
      case 'deco': this.rebuildDeco(); break;
      case 'water': this.rebuildWater(); break;
      case 'nodes': this.rebuildNodes(); this.rebuildShadows(); break;
      case 'structures': this.rebuildStructures(); break;
      case 'blueprints': this.rebuildBlueprints(); break;
      case 'units': this.rebuildUnits(); break;
    }
  }

  private clearLayer(layer: Container): void {
    while (layer.children.length) {
      const child = layer.children[0];
      layer.removeChild(child);
    }
  }
}
