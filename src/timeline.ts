import { addMedia, addTitle, addTrack, addTransition, clearRange, deleteClips, maxDuration, splitAt, withLinked } from './edit';
import { allKeyTimes, shiftKeys } from './keys';
import { speedOf } from './looks';
import { importFiles } from './media';
import { MEDIA_MIME } from './mediapool';
import { store } from './state';
import type { Clip, Track } from './types';
import { previousOf } from './transitions';
import { button, clamp, h, icons, toast } from './util';

const compact = window.matchMedia('(max-width: 700px)');
const headW = (): number => (compact.matches ? 84 : 150);
const RULER_H = 28;
const SNAP_PX = 8;
const MIN_PPS = 2;
const MAX_PPS = 400;

interface Origin {
  start: number;
  duration: number;
  offset: number;
  trackId: string;
  keys: Clip['keys'];
}

interface Drag {
  mode: 'move' | 'trim-l' | 'trim-r';
  primary: string;
  x: number;
  y: number;
  moved: boolean;
  origin: Map<string, Origin>;
}

const zoomToSlider = (pps: number): number => (Math.log(pps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS)) * 100;
const sliderToZoom = (v: number): number => MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, v / 100);

export class Timeline {
  readonly root = h('div', { class: 'panel timeline' });
  private readonly scroll = h('div', { class: 'tl-scroll' });
  private readonly inner = h('div', { class: 'tl-inner' });
  private readonly ruler = h('canvas', { class: 'tl-ruler' });
  private readonly playhead = h('div', { class: 'tl-playhead' });
  private readonly zoom = h('input', { type: 'range', min: '0', max: '100', step: '0.1', class: 'zoom', title: 'Zoom (Ctrl + scroll)' });
  private readonly toolBtns: Record<string, HTMLButtonElement> = {};
  private readonly snapBtn: HTMLButtonElement;
  private readonly clipEls = new Map<string, HTMLElement>();
  private readonly laneEls = new Map<string, HTMLElement>();
  private drag: Drag | null = null;
  private scrubbing = false;
  onToggleMixer: (() => void) | null = null;
  private readonly mixerBtn: HTMLButtonElement;

  constructor() {
    this.toolBtns.select = button(icons.cursor, 'Selection tool (A)', () => store.setTool('select'), 'icon-btn');
    this.toolBtns.razor = button(icons.blade, 'Blade tool (B)', () => store.setTool('razor'), 'icon-btn');
    this.snapBtn = button(icons.magnet, 'Snapping (N)', () => {
      store.ui.snapping = !store.ui.snapping;
      this.syncTools();
    }, 'icon-btn');
    this.zoom.addEventListener('input', () => this.setZoom(sliderToZoom(Number(this.zoom.value))));
    this.mixerBtn = button(`${icons.speaker}<span>Mixer</span>`, 'Show the audio mixer', () => this.onToggleMixer?.(), 'btn small');
    const bar = h(
      'div',
      { class: 'tl-toolbar' },
      this.toolBtns.select,
      this.toolBtns.razor,
      h('span', { class: 'sep' }),
      button(icons.split, 'Split at playhead (Ctrl+B)', () => splitAt(store.ui.playhead), 'icon-btn'),
      button(icons.trash, 'Delete selected (Del)', () => deleteClips(store.ui.selected), 'icon-btn'),
      button(`${icons.text}<span>Title</span>`, 'Add a title at the playhead', () => addTitle(store.ui.playhead), 'btn small'),
      button('<span class="trans-icon"></span><span>Transition</span>', 'Add a cross dissolve to the selected clips (Ctrl+T)', () => this.transition(), 'btn small'),
      h('span', { class: 'sep' }),
      this.snapBtn,
      h('span', { class: 'grow' }),
      button(`${icons.plus}<span>Video track</span>`, 'Add a video track', () => addTrack('video'), 'btn small'),
      button(`${icons.plus}<span>Audio track</span>`, 'Add an audio track', () => addTrack('audio'), 'btn small'),
      this.mixerBtn,
      h('span', { class: 'sep' }),
      this.zoom,
    );
    this.scroll.append(this.inner);
    this.root.append(bar, this.scroll);

    this.scroll.addEventListener('scroll', () => this.drawRuler());
    this.scroll.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    this.scroll.addEventListener('pointerdown', e => this.onPointerDown(e));
    this.scroll.addEventListener('pointermove', e => this.onPointerMove(e));
    this.scroll.addEventListener('pointerup', () => this.onPointerUp());
    this.scroll.addEventListener('pointercancel', () => this.onPointerUp());
    let pinch: { dist: number; pps: number } | null = null;
    const spread = (e: TouchEvent): number => Math.abs(e.touches[0].clientX - e.touches[1].clientX) + Math.abs(e.touches[0].clientY - e.touches[1].clientY) * 0.25;
    this.scroll.addEventListener('touchstart', e => {
      if (e.touches.length === 2) pinch = { dist: Math.max(10, spread(e)), pps: store.ui.pps };
    }, { passive: true });
    this.scroll.addEventListener('touchmove', e => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const mid = (e.touches[0].clientX + e.touches[1].clientX) / 2 - this.scroll.getBoundingClientRect().left - headW();
      this.setZoom(pinch.pps * (spread(e) / pinch.dist), Math.max(0, mid));
    }, { passive: false });
    this.scroll.addEventListener('touchend', e => {
      if (e.touches.length < 2) pinch = null;
    });
    compact.addEventListener('change', () => this.render());
    this.scroll.addEventListener('dragover', e => this.onDragOver(e));
    this.scroll.addEventListener('drop', e => void this.onDrop(e));
    new ResizeObserver(() => this.render()).observe(this.scroll);

    store.on(c => {
      if (c === 'playhead') {
        this.placePlayhead();
        this.follow();
      } else if (c === 'ui') {
        this.syncTools();
      } else if (!this.drag) {
        this.render();
      }
    });
    this.syncTools();
    this.render();
  }

  setMixerOpen(open: boolean): void {
    this.mixerBtn.classList.toggle('active', open);
  }

  transition(): void {
    if (!store.ui.selected.length) {
      toast('Select a clip first, then add a transition.');
      return;
    }
    const n = addTransition(store.ui.selected);
    toast(n ? 'Cross dissolve added. Change its type in the Inspector.' : 'The selected clips already have a transition.');
  }

  setZoom(pps: number, anchorX?: number): void {
    const next = clamp(pps, MIN_PPS, MAX_PPS);
    const view = this.scroll.clientWidth - headW();
    const ax = anchorX ?? view / 2;
    const t = (this.scroll.scrollLeft + ax) / store.ui.pps;
    store.ui.pps = next;
    this.render();
    this.scroll.scrollLeft = Math.max(0, t * next - ax);
    this.drawRuler();
  }

  private syncTools(): void {
    this.toolBtns.select.classList.toggle('on', store.ui.tool === 'select');
    this.toolBtns.razor.classList.toggle('on', store.ui.tool === 'razor');
    this.snapBtn.classList.toggle('on', store.ui.snapping);
    this.root.classList.toggle('razor', store.ui.tool === 'razor');
  }

  render(): void {
    const pps = store.ui.pps;
    const view = Math.max(0, this.scroll.clientWidth - headW());
    const width = Math.max((store.duration() + 30) * pps, view + 200);
    this.zoom.value = String(zoomToSlider(pps));
    this.inner.style.width = `${headW() + width}px`;
    this.clipEls.clear();
    this.laneEls.clear();
    const rulerRow = h('div', { class: 'tl-row ruler-row' }, h('div', { class: 'tl-corner' }), h('div', { class: 'tl-lane ruler-lane' }, this.ruler));
    const rows = store.project.tracks.map(t => this.row(t));
    this.inner.replaceChildren(rulerRow, ...rows, this.playhead);
    this.placePlayhead();
    this.drawRuler();
  }

  private row(track: Track): HTMLElement {
    const toggle = (icon: string, title: string, on: boolean, flip: () => void): HTMLButtonElement => {
      const b = button(icon, title, () => {
        flip();
        store.emit('project');
      }, `mini-btn${on ? ' on' : ''}`);
      return b;
    };
    const head = h(
      'div',
      { class: `tl-head ${track.kind}` },
      h('span', { class: 'tl-name' }, track.name),
      track.kind === 'video'
        ? toggle(icons.eye, track.hidden ? 'Show track' : 'Hide track', !track.hidden, () => (track.hidden = !track.hidden))
        : toggle(icons.speaker, track.muted ? 'Unmute track' : 'Mute track', !track.muted, () => (track.muted = !track.muted)),
      toggle(icons.lock, track.locked ? 'Unlock track' : 'Lock track', track.locked, () => (track.locked = !track.locked)),
    );
    const lane = h('div', { class: `tl-lane ${track.kind}${track.locked ? ' locked' : ''}`, 'data-track': track.id });
    this.laneEls.set(track.id, lane);
    for (const c of store.project.clips) {
      if (c.trackId !== track.id) continue;
      lane.append(this.clipEl(c));
      if (c.transIn) lane.append(this.transEl(c));
    }
    return h('div', { class: `tl-row${track.hidden || track.muted ? ' dimmed' : ''}` }, head, lane);
  }

  private clipEl(c: Clip): HTMLElement {
    const rt = c.mediaId ? store.runtime.get(c.mediaId) : undefined;
    const speed = speedOf(c);
    const base = c.kind === 'text' ? c.text?.content.split('\n')[0] || 'Title' : c.name;
    const label = speed !== 1 ? `${base} · ${speed}×` : base;
    const el = h('div', { class: `clip ${c.kind}`, 'data-clip': c.id, title: label }, h('div', { class: 'trim trim-l' }), h('span', { class: 'clip-name' }, label), h('div', { class: 'trim trim-r' }));
    if (store.ui.selected.includes(c.id)) el.classList.add('sel');
    if (c.mediaId && !rt) el.classList.add('offline');
    if (rt) {
      const img = c.kind === 'audio' ? rt.peaks : rt.thumb;
      if (img) el.style.backgroundImage = `url(${img})`;
    }
    if (c.fadeIn > 0 || c.fadeOut > 0) el.append(h('div', { class: 'fades' }));
    for (const t of allKeyTimes(c)) {
      const tick = h('i', { class: 'kt' });
      tick.style.left = `${(t / c.duration) * 100}%`;
      el.append(tick);
    }
    this.position(el, c);
    this.clipEls.set(c.id, el);
    return el;
  }

  private transEl(c: Clip): HTMLElement {
    const tr = c.transIn!;
    const lead = previousOf(c) ? tr.duration / 2 : 0;
    const el = h('div', { class: 'trans', 'data-clip': c.id, title: `${tr.kind} · ${tr.duration.toFixed(2)}s (select the clip to edit)` });
    el.style.left = `${(c.start - lead) * store.ui.pps}px`;
    el.style.width = `${Math.max(6, tr.duration * store.ui.pps)}px`;
    return el;
  }

  private position(el: HTMLElement, c: Clip): void {
    const pps = store.ui.pps;
    el.style.left = `${c.start * pps}px`;
    el.style.width = `${Math.max(2, c.duration * pps)}px`;
    if (c.kind === 'audio') {
      const m = store.media(c.mediaId);
      const speed = speedOf(c);
      el.style.backgroundSize = `${((m?.duration ?? c.duration) * pps) / speed}px 100%`;
      el.style.backgroundPosition = `${(-c.offset * pps) / speed}px 0`;
    }
    const fades = el.querySelector<HTMLElement>('.fades');
    if (fades) {
      const fi = (c.fadeIn / c.duration) * 100;
      const fo = 100 - (c.fadeOut / c.duration) * 100;
      fades.style.background = `linear-gradient(to right, rgba(0,0,0,.45) 0%, transparent ${fi}%, transparent ${fo}%, rgba(0,0,0,.45) 100%)`;
    }
  }

  private placePlayhead(): void {
    this.playhead.style.left = `${headW() + store.ui.playhead * store.ui.pps}px`;
  }

  private follow(): void {
    if (!store.ui.playing) return;
    const x = store.ui.playhead * store.ui.pps;
    const view = this.scroll.clientWidth - headW();
    if (x > this.scroll.scrollLeft + view * 0.9 || x < this.scroll.scrollLeft) this.scroll.scrollLeft = Math.max(0, x - view * 0.1);
  }

  private drawRuler(): void {
    const w = Math.max(0, this.scroll.clientWidth - headW());
    const dpr = window.devicePixelRatio || 1;
    this.ruler.width = Math.round(w * dpr);
    this.ruler.height = RULER_H * dpr;
    this.ruler.style.width = `${w}px`;
    this.ruler.style.height = `${RULER_H}px`;
    const ctx = this.ruler.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#1b1b1e';
    ctx.fillRect(0, 0, w, RULER_H);
    const pps = store.ui.pps;
    const t0 = this.scroll.scrollLeft / pps;
    const major = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800].find(s => s * pps >= 90) ?? 3600;
    const minor = major / 5;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    const first = Math.floor(t0 / minor);
    const last = Math.ceil((t0 + w / pps) / minor);
    for (let i = first; i <= last; i++) {
      const t = i * minor;
      const x = Math.round((t - t0) * pps) + 0.5;
      const isMajor = i % 5 === 0;
      ctx.strokeStyle = isMajor ? '#77777f' : '#45454c';
      ctx.beginPath();
      ctx.moveTo(x, RULER_H);
      ctx.lineTo(x, isMajor ? RULER_H - 12 : RULER_H - 6);
      ctx.stroke();
      if (isMajor) {
        ctx.fillStyle = '#a5a5ad';
        const s = Math.round(t);
        ctx.fillText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}${major < 1 && t % 1 ? '.5' : ''}`, x + 3, 4);
      }
    }
  }

  private timeAt(clientX: number): number {
    return Math.max(0, (clientX - this.inner.getBoundingClientRect().left - headW()) / store.ui.pps);
  }

  private trackAt(clientY: number): Track | undefined {
    for (const [id, lane] of this.laneEls) {
      const r = lane.getBoundingClientRect();
      if (clientY >= r.top && clientY < r.bottom) return store.track(id);
    }
    return undefined;
  }

  private onWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const anchor = e.clientX - this.scroll.getBoundingClientRect().left - headW();
    this.setZoom(store.ui.pps * Math.exp(-e.deltaY * 0.002), Math.max(0, anchor));
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.ruler-row')) {
      this.scrubbing = true;
      this.scroll.setPointerCapture(e.pointerId);
      store.setPlayhead(this.timeAt(e.clientX));
      return;
    }
    const transEl = target.closest<HTMLElement>('.trans');
    if (transEl) {
      store.select(withLinked([transEl.dataset.clip ?? '']));
      return;
    }
    const clipEl = target.closest<HTMLElement>('.clip');
    if (!clipEl) {
      if (target.closest('.tl-lane')) store.select([]);
      return;
    }
    const clip = store.clip(clipEl.dataset.clip ?? '');
    if (!clip || store.track(clip.trackId)?.locked) return;
    if (store.ui.tool === 'razor') {
      splitAt(this.timeAt(e.clientX), [clip.id]);
      return;
    }
    const mode = target.classList.contains('trim-l') ? 'trim-l' : target.classList.contains('trim-r') ? 'trim-r' : 'move';
    let ids: string[];
    if (mode !== 'move') ids = withLinked([clip.id]);
    else if (e.shiftKey) ids = withLinked([...store.ui.selected, clip.id]);
    else ids = store.ui.selected.includes(clip.id) ? withLinked(store.ui.selected) : withLinked([clip.id]);
    store.select(mode === 'move' ? ids : withLinked([clip.id]));
    const origin = new Map<string, Origin>();
    for (const id of ids) {
      const c = store.clip(id);
      if (c) origin.set(id, { start: c.start, duration: c.duration, offset: c.offset, trackId: c.trackId, keys: c.keys && structuredClone(c.keys) });
    }
    this.drag = { mode, primary: clip.id, x: e.clientX, y: e.clientY, moved: false, origin };
    this.scroll.setPointerCapture(e.pointerId);
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.scrubbing) {
      store.setPlayhead(this.timeAt(e.clientX));
      return;
    }
    const d = this.drag;
    if (!d) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x) < 3 && Math.abs(e.clientY - d.y) < 3) return;
      d.moved = true;
      store.checkpoint();
    }
    const dt = (e.clientX - d.x) / store.ui.pps;
    if (d.mode === 'move') this.moveBy(d, dt, this.trackAt(e.clientY));
    else this.trimBy(d, dt);
    for (const id of d.origin.keys()) {
      const c = store.clip(id);
      const el = this.clipEls.get(id);
      const lane = c && this.laneEls.get(c.trackId);
      if (!c || !el || !lane) continue;
      if (el.parentElement !== lane) lane.append(el);
      this.position(el, c);
    }
    store.emit('project');
  }

  private moveBy(d: Drag, dt: number, over?: Track): void {
    const origins = [...d.origin.values()];
    const minStart = Math.min(...origins.map(o => o.start));
    let delta = Math.max(dt, -minStart);
    if (store.ui.snapping) {
      const edges = origins.flatMap(o => [o.start + delta, o.start + o.duration + delta]);
      delta = Math.max(delta + this.snap(edges, d.origin), -minStart);
    }
    for (const [id, o] of d.origin) {
      const c = store.clip(id);
      if (!c) continue;
      c.start = o.start + delta;
      if (id === d.primary && over && !over.locked && over.kind === store.track(o.trackId)?.kind) c.trackId = over.id;
    }
  }

  private trimBy(d: Drag, dt: number): void {
    const p = d.origin.get(d.primary);
    const primary = store.clip(d.primary);
    if (!p || !primary) return;
    const frame = store.frame();
    if (d.mode === 'trim-r') {
      let end = p.start + p.duration + dt;
      if (store.ui.snapping) end += this.snap([end], d.origin);
      for (const [id, o] of d.origin) {
        const c = store.clip(id);
        if (c) c.duration = clamp(end - o.start, frame, maxDuration({ ...c, offset: o.offset }));
      }
      return;
    }
    let start = p.start + dt;
    if (store.ui.snapping) start += this.snap([start], d.origin);
    const media = store.media(primary.mediaId);
    const earliest = media && media.kind !== 'image' ? p.start - p.offset / speedOf(primary) : 0;
    start = clamp(start, Math.max(0, earliest), p.start + p.duration - frame);
    const delta = start - p.start;
    for (const [id, o] of d.origin) {
      const c = store.clip(id);
      if (!c) continue;
      c.start = o.start + delta;
      c.offset = Math.max(0, o.offset + delta * speedOf(c));
      c.duration = o.duration - delta;
      c.keys = o.keys && structuredClone(o.keys);
      shiftKeys(c, -delta);
    }
  }

  private snap(points: number[], exclude: Map<string, Origin>): number {
    const targets = [0, store.ui.playhead];
    for (const c of store.project.clips) if (!exclude.has(c.id)) targets.push(c.start, c.start + c.duration);
    const limit = SNAP_PX / store.ui.pps;
    let best = 0;
    let bestAbs = Infinity;
    for (const p of points) {
      for (const t of targets) {
        const diff = t - p;
        if (Math.abs(diff) <= limit && Math.abs(diff) < bestAbs) {
          best = diff;
          bestAbs = Math.abs(diff);
        }
      }
    }
    return best;
  }

  private onPointerUp(): void {
    if (this.scrubbing) {
      this.scrubbing = false;
      return;
    }
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.moved) {
      const keep = new Set(d.origin.keys());
      for (const id of d.origin.keys()) {
        const c = store.clip(id);
        if (c) clearRange(c.trackId, c.start, c.start + c.duration, keep);
      }
    }
    store.emit('project');
  }

  private onDragOver(e: DragEvent): void {
    const types = e.dataTransfer?.types ?? [];
    if (!types.includes(MEDIA_MIME) && !types.includes('Files')) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  private async onDrop(e: DragEvent): Promise<void> {
    const dt = e.dataTransfer;
    if (!dt) return;
    e.preventDefault();
    e.stopPropagation();
    const lane = (e.target as HTMLElement).closest<HTMLElement>('.tl-lane');
    const trackId = lane?.dataset.track;
    let at = this.timeAt(e.clientX);
    const mediaId = dt.getData(MEDIA_MIME);
    if (mediaId) {
      addMedia(mediaId, trackId, at);
      return;
    }
    if (!dt.files.length) return;
    for (const id of await importFiles([...dt.files])) {
      const clip = addMedia(id, trackId, at);
      if (clip) at = clip.start + clip.duration;
    }
  }
}
