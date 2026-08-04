/** 顶点级像素风中文游戏界面（殖民模拟）。
 *  布局遵循经典殖民地策略游戏惯例：
 *    顶部左侧 —— 资源栏 / 顶部中央 —— 时钟与速度 / 顶部右侧 —— 系统按钮
 *    底部 —— 建造工具栏 / 右侧 —— 面板（优先级 / 角色详情）
 *  全部文案中文化，采用像素等宽字体与硬边框面板。
 */
import { Game, LogKind } from '../systems/game';
import { Renderer } from '../render/renderer';
import { BLUEPRINTS, BuildingKind } from '../economy/buildings';
import { WORK_TYPES } from '../data/work-types';
import { SoundController } from '../audio/sound';
import type { BusName } from '../audio/audio';

const L: Record<string, string> = {
  // generic
  wood: '木材', steel: '钢铁', rawFood: '食物', cooked: '餐食', colonist: '居民',
  day: '第', clockNight: '🌙 夜间', clockDay: '☀️ 昼间',
  build: '建造',
  prioritiesTitle: '· 工作优先级 ·', prioritiesSub: '调整各项工作的优先度，0 = 居民不理会',
  prioritize: '优先级', colonistTab: '居民',
  selectPlaceholder: '点击一名居民对其进行检视。',
  mood: '心情', hunger: '饥饿', rest: '体力',
  currentJob: '当前工作', idle: '空闲',
  deselection: '取消选择', recenter: '居中', save: '保存',
  paused: '暂停', resume: '继续',
  pauseSpeed: '⏸', speed1: '▶', speed2: '⏩', speed3: '⏭',
};

const JOB_LABEL: Record<string, string> = {
  chop: '砍伐树木', mine: '采集采矿', forage: '采集浆果', haul: '搬运物资',
  build: '施工建造', cook: '烹饪做饭', craft: '制作工具', plant: '种植作物',
  harvest: '收获作物', eat: '进食', sleep: '休息睡眠',
  wander: '四处游荡', clean: '清理',
};

/** Icon per log kind. */
const LOG_ICON: Record<string, string> = {
  build: '🔨', craft: '🛠', harvest: '🪓', haul: '📦', plant: '🌱',
  cook: '🍲', eat: '🍽', sleep: '💤', danger: '⚠️', info: 'ℹ️',
};

const BUILD_NAME: Record<string, string> = {
  campfire: '篝火', workbench: '工作台', bed: '床铺', wall: '墙壁', door: '门',
  farmPlot: '农田', torch: '火把', hearth: '火炉',
};

/** Chinese names for the resource ids used in a building's cost. */
const RES_CN: Record<string, string> = {
  wood: '木', steel: '钢', rawFood: '食',
};

/** Format a building's cost for the button, e.g. "木×25". */
function fmtCost(cost: Record<string, number>): string {
  return Object.entries(cost)
    .map(([item, n]) => `${RES_CN[item] ?? item}×${n}`)
    .join(' ');
}

export class GameUI {
  game: Game;
  renderer: Renderer;
  sound: SoundController;

  private root!: HTMLElement;
  private volumePop: HTMLElement | null = null;
  private counters!: Record<string, HTMLElement>;
  private clockEl!: HTMLElement;
  private priorityRow!: HTMLElement;
  private inspectorPanel!: HTMLElement;
  private toastEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private speedButtons: HTMLButtonElement[] = [];

  private currentBuildKind: BuildingKind | null = null;
  private buildBtn: HTMLButtonElement | null = null;
  private cameraModeBtn: HTMLButtonElement | null = null;
  private timer: number | undefined;
  private selectedId: number | null = null;
  private showInspector = false;
  private logFeed: HTMLElement | null = null;
  private logEntries: Array<{ el: HTMLElement; born: number }> = [];
  private logCollapsed = false;

  constructor(game: Game, renderer: Renderer, sound: SoundController) {
    this.game = game;
    this.renderer = renderer;
    this.sound = sound;
    this.root = document.createElement('div');
    this.root.id = 'game-ui';
    document.body.appendChild(this.root);
    this.buildHUD();
  }

  private h(tag: string, cls: string, text = ''): HTMLElement {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  private b(text: string, cls: string, onClick: () => void): HTMLButtonElement {
    const el = document.createElement('button');
    el.className = cls;
    el.textContent = text;
    el.addEventListener('click', () => {
      // Subtle UI feedback on every button; error sounds handled separately.
      const lock = el.classList.contains('locked');
      this.sound.uiClick();
      if (lock) this.sound.uiError();
      onClick();
    });
    return el;
  }

  /* ============ HUD 骨架 ============ */

  private buildHUD(): void {
    // ---- 顶部栏 ----
    const top = this.h('div', 'topbar');
    this.root.appendChild(top);

    // 资源区
    const res = this.h('div', 'topbar-left');
    this.counters = {};
    const defs: Array<[string, string, string]> = [
      ['wood', '🪵', L.wood],
      ['steel', '⚙️', L.steel],
      ['rawFood', '🌾', L.rawFood],
      ['cooked', '🍲', L.cooked],
      ['colonist', '👥', L.colonist],
    ];
    for (const [key, ico, name] of defs) {
      res.appendChild(this.resourceChip(key, ico, name));
    }
    top.appendChild(res);

    // 中部：时钟 + 速度
    const mid = this.h('div', 'topbar-mid');
    this.clockEl = this.h('span', 'clock', '第 1 天 ☀️');
    mid.appendChild(this.clockEl);
    const speed = this.h('div', 'speed');
    const speeds: Array<[string, number]> = [
      [L.pauseSpeed, 0], [L.speed1, 1], [L.speed2, 2], [L.speed3, 3],
    ];
    for (const [label, mult] of speeds) {
      const bb = this.b(label, 'speed-btn' + (mult === 1 ? ' active' : ''), () => this.setSpeed(mult, bb));
      this.speedButtons.push(bb);
      speed.appendChild(bb);
    }
    mid.appendChild(speed);
    top.appendChild(mid);

    // 顶部右侧
    const right = this.h('div', 'topbar-right');
    this.cameraModeBtn = this.b('⊕ 跟随', 'cmd-btn', () => this.dispatch('camera'));
    right.appendChild(this.cameraModeBtn);
    right.appendChild(this.b('◉ 居中', 'cmd-btn', () => this.recenter()));
    right.appendChild(this.b('✦ 新世界', 'cmd-btn', () => this.dispatch('newgame')));
    right.appendChild(this.b('✏ 声音', 'cmd-btn', () => this.toggleVolumePop()));
    right.appendChild(this.b('⏾ 保存', 'cmd-btn', () => this.saveGame()));
    top.appendChild(right);

    // ---- 音量弹层（挂在根节点，点击声音按钮开合） ----
    this.volumePop = this.buildVolumePop();
    this.root.appendChild(this.volumePop);

    // ---- 底部建造栏 ----
    this.buildToolbarAppend();

    // ---- 右侧面板 ----
    const dock = this.h('div', 'dock');
    this.root.appendChild(dock);
    const tabs = this.h('div', 'dock-tabs');
    const tPrior = this.b('优先级', 'dock-tab active', () => this.switchPanel('priorities'));
    const tCol = this.b('居民', 'dock-tab', () => this.switchPanel('inspector'));
    tabs.appendChild(tPrior);
    tabs.appendChild(tCol);
    dock.appendChild(tabs);
    this.priorityRow = this.h('div', 'dock-body');
    dock.appendChild(this.priorityRow);
    this.inspectorPanel = this.h('div', 'dock-body inspector hidden');
    dock.appendChild(this.inspectorPanel);
    this.populatePriorities();

    // ---- 日志面板（左下，可折叠） ----
    const logWrap = this.h('div', 'log-panel');
    const logHead = this.h('div', 'log-head');
    logHead.appendChild(this.h('span', 'log-title', '📜 事件日志'));
    logHead.appendChild(this.b('▾', 'log-toggle', () => this.toggleLog()));
    logWrap.appendChild(logHead);
    this.logFeed = this.h('div', 'log-feed');
    logWrap.appendChild(this.logFeed);
    this.root.appendChild(logWrap);

    // ---- 提示 + toast ----
    this.hintEl = this.h('div', 'hint', '拖动平移 · 滚轮缩放 · 单击选中居民 · 右键命令 · 空格暂停 · C切换相机');
    this.root.appendChild(this.hintEl);
    this.toastEl = this.h('div', 'toast');
    this.root.appendChild(this.toastEl);

    this.refresh();
  }

  private toggleLog(): void {
    this.logCollapsed = !this.logCollapsed;
    if (this.logFeed) this.logFeed.classList.toggle('collapsed', this.logCollapsed);
    const btn = this.root.querySelector('.log-toggle');
    if (btn) btn.textContent = this.logCollapsed ? '▸' : '▾';
  }

  private resourceChip(key: string, ico: string, name: string): HTMLElement {
    const chip = this.h('div', 'res-chip');
    chip.appendChild(this.h('span', 'res-ico', ico));
    const val = this.h('span', 'res-val', '0');
    this.counters[key] = val;
    chip.appendChild(val);
    chip.appendChild(this.h('span', 'res-label', name));
    return chip;
  }

  /* ============ 建造栏 ============ */

  private buildToolbarAppend(): void {
    const bar = this.h('div', 'buildbar');
    bar.appendChild(this.h('span', 'buildbar-title', L.build));
    for (const kind of Object.keys(BLUEPRINTS) as BuildingKind[]) {
      const def = BLUEPRINTS[kind];
      const locked = !!def.requiresTech && !this.game.colony.hasTech(def.requiresTech);
      const bb = this.b('', 'build-btn' + (locked ? ' locked' : ''), () => this.pickBuild(kind, bb));
      // Two-line button: name on top, cost below (coloured by affordability).
      const name = this.h('span', 'build-name', BUILD_NAME[kind] ?? kind);
      const costStr = fmtCost(def.cost ?? {});
      const cost = this.h('span', 'build-cost', costStr);
      const canAfford = this.canAffordCost(def.cost ?? {});
      cost.classList.toggle('lack', !canAfford);
      bb.appendChild(name);
      bb.appendChild(cost);
      if (locked) bb.title = '需要科技：' + (def.requiresTech ?? '');
      bar.appendChild(bb);
    }
    bar.appendChild(this.b('✕', 'build-btn', () => this.pickBuild(null, null)));
    this.root.appendChild(bar);
  }

  /** True if the colony stockpile currently covers a cost dict. */
  private canAffordCost(cost: Record<string, number>): boolean {
    for (const [item, n] of Object.entries(cost)) {
      if (this.game.stockpileCount(item) < n) return false;
    }
    return true;
  }

  /* ============ 优先级面板 ============ */

  private populatePriorities(): void {
    this.priorityRow.innerHTML = '';
    this.priorityRow.appendChild(this.h('div', 'panel-title', L.prioritiesTitle));
    this.priorityRow.appendChild(this.h('div', 'panel-sub', L.prioritiesSub));
    for (const wt of WORK_TYPES) {
      const row = this.h('div', 'work-row');
      const lbl = this.h('span', 'work-label', wt.cn);
      lbl.style.color = '#' + wt.color.toString(16).padStart(6, '0');
      row.appendChild(lbl);
      const ctl = this.h('div', 'work-ctl');
      ctl.appendChild(this.b('−', 'step-btn', () => this.adjust(wt.id, -1)));
      ctl.appendChild(this.h('span', 'work-val', String(this.game.colony.priorities[wt.id] ?? 0)));
      ctl.appendChild(this.b('+', 'step-btn', () => this.adjust(wt.id, 1)));
      row.appendChild(ctl);
      this.priorityRow.appendChild(row);
    }
  }

  private adjust(wt: string, delta: number): void {
    let p = this.game.colony.priorities[wt] ?? 0;
    p = Math.max(0, Math.min(4, p + delta));
    this.game.colony.priorities[wt] = p;
    this.game.colony.enabled[wt] = p > 0;
    this.game.refreshJobsNow();
    this.populatePriorities();
  }

  /* ============ 中英映射/工具 ============ */

  jobName(kind: string): string {
    return JOB_LABEL[kind] ?? kind;
  }

  jobOf(): string {
    const c = this.selectedColonist();
    if (!c) return '—';
    return c.currentJob ? JOB_LABEL[c.currentJob.kind] ?? '工作中' : L.idle;
  }

  /* ============ 面板切换 ============ */

  private switchPanel(which: 'priorities' | 'inspector'): void {
    const tabs = this.root.querySelectorAll('.dock-tab');
    tabs.forEach((t: Element) => t.classList.toggle('active', t.textContent === (which === 'priorities' ? '优先级' : '居民')));
    const prior = this.root.querySelector('.dock-body');
    const insp = this.inspectorPanel;
    if (prior && insp) {
      prior.classList.toggle('hidden', which !== 'priorities');
      insp.classList.toggle('hidden', which !== 'inspector');
    }
    this.showInspector = which === 'inspector';
    this.refresh();
  }

  /* ============ 公开接口（供 Input/main 调用）============ */

  currentBuild(): BuildingKind | null {
    return this.currentBuildKind;
  }
  selectedColonistId(): number | null {
    return this.selectedId;
  }
  selectedColonist() {
    if (this.selectedId == null) return null;
    return this.game.colony.colonists.find((c) => c.id === this.selectedId) ?? null;
  }
  onColonistSelected(id: number): void {
    this.selectedId = id;
    this.showInspector = true;
    this.root.querySelectorAll('.dock-tab').forEach((t: Element) => t.classList.toggle('active', t.textContent === '居民'));
    const prior = this.root.querySelector('.dock-body');
    if (prior) prior.classList.add('hidden');
    this.inspectorPanel.classList.remove('hidden');
    this.renderer.selectColonist(id);
    this.populateInspector();
  }
  clearSelection(): void {
    this.selectedId = null;
    this.renderer.clearHighlight();
  }
  recenter(): void {
    this.renderer.camera.snapTo(this.colonyCentroid());
    this.renderer.updateCameraNow();
  }
  saveGame(): void {
    window.dispatchEvent(new CustomEvent('colony-save'));
  }

  private dispatch(kind: 'camera' | 'newgame'): void {
    window.dispatchEvent(new CustomEvent('colony-' + kind));
  }

  /** Update the camera-mode button label to reflect the active mode. */
  setCameraMode(mode: 'follow' | 'free'): void {
    if (this.cameraModeBtn) {
      this.cameraModeBtn.textContent = mode === 'follow' ? '⊕ 跟随' : '✥ 自由';
    }
  }
  colonyCentroid(): { x: number; y: number } {
    const cols = this.game.colony.colonists;
    if (cols.length === 0) return { x: 0, y: 0 };
    let ax = 0, ay = 0;
    for (const c of cols) { ax += c.tileX; ay += c.tileY; }
    return { x: (ax / cols.length) * 16 + 8, y: (ay / cols.length) * 16 + 8 };
  }

  /* ============ 刷新 ============ */

  refresh(): void {
    const g = this.game;
    this.set('wood', g.stockpileCount('wood'));
    this.set('steel', g.stockpileCount('steel'));
    this.set('rawFood', g.stockpileCount('rawFood'));
    this.set('cooked', g.stockpileCount('cookedMeal'));
    this.set('colonist', g.colony.colonists.length);
    const day = Math.floor(g.time / g.daySeconds) + 1;
    const hh = String(g.hour).padStart(2, '0');
    this.clockEl.textContent = `${L.day} ${day} 天 · ${hh}:00 ${g.night ? L.clockNight : L.clockDay}`;
    if (this.showInspector) this.populateInspector();
  }
  private set(key: string, value: number): void {
    const el = this.counters[key];
    if (el) el.textContent = String(value);
  }
  refreshResources(): void {
    this.refresh();
  }

  private populateInspector(): void {
    this.inspectorPanel.innerHTML = '';
    this.inspectorPanel.appendChild(this.h('div', 'panel-title', L.colonistTab));
    const c = this.selectedColonist();
    if (!c) {
      this.inspectorPanel.appendChild(this.h('div', 'placeholder', L.selectPlaceholder));
      return;
    }
    const head = this.h('div', 'inspector-head');
    head.appendChild(this.h('div', 'portrait', '♦'));
    head.appendChild(this.h('div', 'inspector-name', c.name));
    this.inspectorPanel.appendChild(head);
    this.inspectorPanel.appendChild(this.bar(L.mood, c.needs.mood.value, 0xf2c04c));
    this.inspectorPanel.appendChild(this.bar(L.hunger, c.needs.hunger.value, 0xe08040));
    this.inspectorPanel.appendChild(this.bar(L.rest, c.needs.rest.value, 0x6090d0));
    const job = this.h('div', 'job-line', `${L.currentJob}：${this.jobOf()}`);
    this.inspectorPanel.appendChild(job);
  }

  private bar(label: string, value: number, color: number): HTMLElement {
    const row = this.h('div', 'need-row');
    row.appendChild(this.h('span', 'need-label', label));
    const track = this.h('div', 'need-track');
    const fill = this.h('div', 'need-fill');
    fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    fill.style.background = `#${color.toString(16).padStart(6, '0')}`;
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(this.h('span', 'need-num', String(Math.round(value))));
    return row;
  }

  setSpeed(mult: number, btn: HTMLButtonElement): void {
    for (const b of this.speedButtons) b.classList.remove('active');
    btn.classList.add('active');
    window.dispatchEvent(new CustomEvent('colony-speed', { detail: mult }));
  }

  /* ============ 音量设置（bus → dB 映射，见 audio 技能） ============ */

  private buildVolumePop(): HTMLElement {
    const pop = this.h('div', 'volume-pop hidden');
    const head = this.h('div', 'volume-pop-head');
    head.appendChild(this.h('span', 'panel-title', '· 声音设置 ·'));
    const close = this.b('✕', 'vol-close', () => this.toggleVolumePop());
    head.appendChild(close);
    pop.appendChild(head);
    const rows: Array<[string, BusName]> = [
      ['主音量', 'Master'],
      ['音效', 'SFX'],
      ['界面', 'UI'],
      ['音乐/环境', 'Ambience'],
    ];
    for (const [label, bus] of rows) {
      const row = this.h('div', 'need-row');
      row.appendChild(this.h('span', 'need-label', label));
      const input = this.h('input', '') as HTMLInputElement;
      input.type = 'range';
      input.min = '0';
      input.max = '1';
      input.step = '0.05';
      // Show the live engine value so sliders never drift from what's audible.
      const cfg = this.sound.engine.config;
      const key = (bus === 'Master' ? 'master' : bus === 'Music' ? 'music' : bus === 'SFX' ? 'sfx' : bus === 'UI' ? 'ui' : 'ambience') as keyof typeof cfg;
      let v = cfg[key];
      input.value = String(v);
      input.addEventListener('input', () => {
        this.sound.setVolume(bus, parseFloat(input.value));
      });
      const val = this.h('span', 'need-num', Math.round(v * 100) + '%');
      input.addEventListener('input', () => {
        val.textContent = Math.round(parseFloat(input.value) * 100) + '%';
      });
      row.appendChild(input);
      row.appendChild(val);
      pop.appendChild(row);
    }
    return pop;
  }

  private toggleVolumePop(): void {
    this.sound.uiClick();
    if (!this.volumePop) return;
    this.volumePop.classList.toggle('hidden');
  }

  showToast(msg: string, ms = 3000): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  /** Append a gameplay event to the bottom-left log feed. */
  addLog(kind: LogKind, message: string): void {
    if (!this.logFeed) return;
    // Throttle duplicates: drop if the previous entry says nearly the same.
    const last = this.logEntries[this.logEntries.length - 1];
    if (last && last.el.dataset.msg === message) return;
    const row = this.h('div', 'log-row');
    row.dataset.msg = message;
    const icon = this.h('span', 'log-ico', LOG_ICON[kind] ?? 'ℹ️');
    const d = Math.max(0, Math.floor(this.game.time) % 10000);
    const stamp = this.h('span', 'log-time', this.timeStamp());
    const text = this.h('span', 'log-txt', message);
    row.appendChild(icon);
    row.appendChild(stamp);
    row.appendChild(text);
    this.logFeed.prepend(row); // newest first
    this.logEntries.push({ el: row, born: performance.now() });
    // Cap the feed at ~40 entries; drop the oldest (tail).
    while (this.logEntries.length > 40) {
      const old = this.logEntries.shift();
      if (old) old.el.remove();
    }
    void d;
  }

  private timeStamp(): string {
    const ss = Math.floor(this.game.time);
    const mm = Math.floor(ss / 60);
    const s = ss % 60;
    return `${String(mm).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  cancelBuild(): void {
    this.pickBuild(null, null);
    this.renderer.hideGhost();
  }

  private pickBuild(kind: BuildingKind | null, btn: HTMLButtonElement | null): void {
    this.currentBuildKind = kind;
    if (this.buildBtn) this.buildBtn.classList.remove('active');
    this.buildBtn = btn;
    if (btn) btn.classList.add('active');
    this.hintEl.textContent = kind ? '建造模式：点击地面放置 · 右键取消' : '拖动平移 · 滚轮缩放 · 单击选中居民 · 右键命令 · 空格暂停';
  }
}
