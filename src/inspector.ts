import { ensureSegmenter, segmenterStatus } from './ai';
import { jobs, trackObject } from './cutout';
import type { Engine } from './engine';
import { linked, setSpeed } from './edit';
import { allKeyTimes, hasKeys, keyAt, localTime, removeKey, setKey, valueAt } from './keys';
import { ANIMS, BLEND_MODES, LOOKS, MOTIONS, STYLES, aiOf, animOf, cropOf, cutoutOf, defaultAnim, defaultCrop, defaultCutout, defaultFx, fxOf, speedOf } from './looks';
import { store } from './state';
import { exportSrt, generateSubtitles, hasSubtitles } from './subtitles';
import { TRANSITIONS } from './transitions';
import type { AiMode, Animation, BlendMode, Clip, Crop, CutoutMode, Effects, KeyProp, TransitionKind } from './types';
import { button, h, toast } from './util';
import type { Viewer } from './viewer';

interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  reset: number;
  get: (c: Clip) => number;
  set: (c: Clip, v: number) => void;
  key?: KeyProp;
}

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];
const CUTOUT_MODES: { id: CutoutMode; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'keep', label: 'Keep only the object' },
  { id: 'erase', label: 'Erase the object' },
];
const AI_MODES: { id: AiMode; label: string }[] = [
  { id: 'none', label: 'Off' },
  { id: 'remove', label: 'Remove background' },
  { id: 'defocus', label: 'Defocus background' },
  { id: 'mono', label: 'Black & white background' },
];

export class Inspector {
  readonly root = h('div', { class: 'panel inspector' });
  private readonly body = h('div', { class: 'insp-body' });
  private editing = false;
  private busy = '';
  private progress: HTMLElement | null = null;

  constructor(
    private readonly engine: Engine,
    private readonly viewer: Viewer,
  ) {
    this.root.append(h('div', { class: 'panel-head' }, 'Inspector'), this.body);
    store.on(c => {
      if (c === 'selection' || (c === 'project' && !this.root.contains(document.activeElement))) this.render();
      if (c === 'playhead' && !store.ui.playing && !this.editing && this.selectedHasKeys()) this.render();
    });
    this.render();
  }

  private selectedHasKeys(): boolean {
    const c = store.clip(store.ui.selected[0] ?? '');
    return !!c?.keys && Object.keys(c.keys).length > 0;
  }

  private begin(): void {
    if (this.editing) return;
    store.checkpoint();
    this.editing = true;
  }

  private end = (): void => {
    this.editing = false;
  };

  private change(clipId: string, fn: (c: Clip) => void, once = false): void {
    this.begin();
    const c = store.clip(clipId);
    if (!c) return;
    fn(c);
    store.emit('project');
    if (once) {
      this.end();
      this.render();
    }
  }

  render(): void {
    const clip = store.clip(store.ui.selected[0] ?? '');
    if (!clip) {
      this.body.replaceChildren(h('div', { class: 'empty' }, h('strong', {}, 'Nothing selected'), h('span', {}, 'Select a clip on the timeline to adjust it.')));
      return;
    }
    const scroll = this.body.scrollTop;
    const visual = clip.kind !== 'audio';
    const sections: HTMLElement[] = [h('div', { class: 'insp-title' }, h('span', { class: `dot ${clip.kind}` }), clip.kind === 'text' ? 'Title' : clip.name)];
    if (clip.kind === 'text' && clip.text) sections.push(this.titleSection(clip));
    if (visual) {
      sections.push(
        this.section('Transform', [
          this.keyNav(clip),
          this.slider(clip, { label: 'Zoom', min: 0.1, max: 4, step: 0.01, reset: 1, get: c => c.scale, set: (c, v) => (c.scale = v), key: 'scale' }),
          this.slider(clip, { label: 'Position X', min: -1.5, max: 1.5, step: 0.005, reset: 0, get: c => c.x, set: (c, v) => (c.x = v), key: 'x' }),
          this.slider(clip, { label: 'Position Y', min: -1.5, max: 1.5, step: 0.005, reset: 0, get: c => c.y, set: (c, v) => (c.y = v), key: 'y' }),
          this.slider(clip, { label: 'Rotation °', min: -180, max: 180, step: 1, reset: 0, get: c => c.rotation ?? 0, set: (c, v) => (c.rotation = v), key: 'rotation' }),
          this.slider(clip, { label: 'Opacity', min: 0, max: 1, step: 0.01, reset: 1, get: c => c.opacity, set: (c, v) => (c.opacity = v), key: 'opacity' }),
          this.flipRow(clip),
          this.fitRow(clip),
        ]),
        this.section('Composite', [this.select('Blend mode', BLEND_MODES, clip.blend ?? 'normal', v => this.change(clip.id, c => (c.blend = v as BlendMode), true))]),
        this.transitionSection(clip),
        this.section('Crop', [
          ...(['l', 't', 'r', 'b'] as (keyof Crop)[]).map(k =>
            this.slider(clip, {
              label: { l: 'Left', r: 'Right', t: 'Top', b: 'Bottom' }[k],
              min: 0,
              max: 0.45,
              step: 0.005,
              reset: 0,
              get: c => cropOf(c)[k],
              set: (c, v) => (c.crop = { ...cropOf(c), [k]: v }),
            }),
          ),
          this.resetRow('Reset crop', () => this.change(clip.id, c => (c.crop = defaultCrop()), true)),
        ]),
        this.effectsSection(clip),
        this.styleSection(clip),
        this.animationSection(clip),
      );
      if (clip.kind === 'video' || clip.kind === 'image') sections.push(this.cutoutSection(clip), this.aiSection(clip));
    } else {
      sections.push(this.section('Audio', [this.slider(clip, { label: 'Volume', min: 0, max: 1, step: 0.01, reset: 1, get: c => c.volume, set: (c, v) => (c.volume = v) })]));
    }
    if (clip.kind === 'video' || clip.kind === 'audio') {
      sections.push(this.speedSection(clip));
      if (clip.kind === 'audio' || store.media(clip.mediaId)?.hasAudio) sections.push(this.subtitleSection(clip));
    }
    const maxFade = Math.min(5, clip.duration / 2);
    sections.push(
      this.section('Fades', [
        this.slider(clip, { label: 'Fade in (s)', min: 0, max: maxFade, step: 0.05, reset: 0, get: c => c.fadeIn, set: (c, v) => (c.fadeIn = v) }),
        this.slider(clip, { label: 'Fade out (s)', min: 0, max: maxFade, step: 0.05, reset: 0, get: c => c.fadeOut, set: (c, v) => (c.fadeOut = v) }),
      ]),
    );
    this.body.replaceChildren(...sections);
    this.body.scrollTop = scroll;
  }

  private section(title: string, rows: HTMLElement[]): HTMLElement {
    return h('section', { class: 'insp-section' }, h('h4', {}, title), ...rows);
  }

  private resetRow(label: string, fn: () => void): HTMLElement {
    return h('div', { class: 'row-end' }, button(label, label, fn, 'link-btn'));
  }

  private slider(clip: Clip, spec: SliderSpec): HTMLElement {
    const local = localTime(clip, store.ui.playhead);
    const keyed = !!spec.key && hasKeys(clip, spec.key);
    const value = keyed && spec.key ? valueAt(clip, spec.key, local) : spec.get(clip);
    const range = h('input', { type: 'range', min: String(spec.min), max: String(spec.max), step: String(spec.step), value: String(value) });
    const num = h('input', { type: 'number', min: String(spec.min), max: String(spec.max), step: String(spec.step), value: value.toFixed(2) });
    const apply = (v: number): void => {
      if (!Number.isFinite(v)) return;
      const next = Math.min(spec.max, Math.max(spec.min, v));
      this.change(clip.id, c => {
        if (spec.key && hasKeys(c, spec.key)) setKey(c, spec.key, localTime(c, store.ui.playhead), next);
        else spec.set(c, next);
      });
      range.value = String(next);
      num.value = next.toFixed(2);
    };
    range.addEventListener('input', () => apply(Number(range.value)));
    num.addEventListener('input', () => apply(Number(num.value)));
    range.addEventListener('change', this.end);
    num.addEventListener('change', this.end);
    range.addEventListener('dblclick', () => {
      apply(spec.reset);
      this.end();
    });
    const row = h('label', { class: `field${spec.key ? ' keyed' : ''}`, title: 'Double-click the slider to reset' }, h('span', {}, spec.label), range, num);
    if (spec.key) row.append(this.diamond(clip, spec.key, local, keyed));
    return row;
  }

  private diamond(clip: Clip, prop: KeyProp, local: number, keyed: boolean): HTMLButtonElement {
    const on = !!keyAt(clip, prop, local);
    const title = on ? 'Remove the keyframe here' : keyed ? 'Add a keyframe here' : 'Start animating: add a keyframe here';
    return button('', title, () => {
      this.change(clip.id, c => {
        const t = localTime(c, store.ui.playhead);
        if (keyAt(c, prop, t)) removeKey(c, prop, t);
        else setKey(c, prop, t, valueAt(c, prop, t));
      }, true);
    }, `kf${keyed ? ' has' : ''}${on ? ' on' : ''}`);
  }

  private keyNav(clip: Clip): HTMLElement {
    const times = allKeyTimes(clip);
    const local = store.ui.playhead - clip.start;
    const jump = (dir: 1 | -1): void => {
      const target = dir > 0 ? times.find(t => t > local + 1e-3) : [...times].reverse().find(t => t < local - 1e-3);
      if (target !== undefined) store.setPlayhead(clip.start + target);
    };
    const row = h('div', { class: 'btn-row keynav' }, h('span', { class: 'hint grow' }, times.length ? `${times.length} keyframe${times.length > 1 ? 's' : ''}` : 'Use ◆ to animate a value over time'));
    if (times.length) {
      row.append(
        button('◀', 'Previous keyframe', () => jump(-1), 'btn small'),
        button('▶', 'Next keyframe', () => jump(1), 'btn small'),
        button('Clear', 'Remove every keyframe on this clip', () => this.change(clip.id, c => (c.keys = undefined), true), 'btn small'),
      );
    }
    return row;
  }

  private select<T extends string>(label: string, options: { id: T; label: string }[], value: T, onChange: (v: T) => void): HTMLElement {
    const sel = h('select', { class: 'select small' });
    options.forEach(o => sel.append(h('option', { value: o.id }, o.label)));
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value as T));
    return h('label', { class: 'field wide' }, h('span', {}, label), sel);
  }

  private flipRow(clip: Clip): HTMLElement {
    const toggle = (label: string, on: boolean, flip: (c: Clip) => void): HTMLButtonElement =>
      button(label, label, () => this.change(clip.id, flip, true), `btn small${on ? ' active' : ''}`);
    return h('div', { class: 'btn-row' }, toggle('Flip horizontal', !!clip.flipH, c => (c.flipH = !c.flipH)), toggle('Flip vertical', !!clip.flipV, c => (c.flipV = !c.flipV)));
  }

  private fitRow(clip: Clip): HTMLElement {
    const m = store.media(clip.mediaId);
    if (!m?.width || !m.height) return h('div');
    const frame = store.project.width / store.project.height;
    const aspect = m.width / m.height;
    const fill = aspect > frame ? aspect / frame : frame / aspect;
    const set = (scale: number): void => this.change(clip.id, c => Object.assign(c, { scale, x: 0, y: 0 }), true);
    return h(
      'div',
      { class: 'btn-row' },
      button('Fit', 'Show the whole picture inside the canvas', () => set(1), `btn small${Math.abs(clip.scale - 1) < 1e-3 ? ' active' : ''}`),
      button('Fill', 'Zoom so the picture covers the whole canvas', () => set(fill), `btn small${fill > 1.001 && Math.abs(clip.scale - fill) < 1e-3 ? ' active' : ''}`),
    );
  }

  private styleSection(clip: Clip): HTMLElement {
    const fx = fxOf(clip);
    const grid = h('div', { class: 'look-grid' });
    for (const st of STYLES) {
      grid.append(button(st.label, `Apply the ${st.label} style`, () => this.change(clip.id, c => (c.fx = { ...fxOf(c), style: st.id }), true), `look-chip style-chip${(fx.style ?? 'none') === st.id ? ' on' : ''}`));
    }
    const rows: HTMLElement[] = [grid];
    if (fx.style && fx.style !== 'none') {
      rows.push(this.slider(clip, { label: 'Style amount', min: 0, max: 1, step: 0.01, reset: 1, get: c => fxOf(c).styleAmt ?? 1, set: (c, v) => (c.fx = { ...fxOf(c), styleAmt: v }) }));
    }
    rows.push(h('p', { class: 'hint' }, 'Turns your footage into artwork. Runs on your graphics card, offline, in real time.'));
    return this.section('AI Styles', rows);
  }

  private cutoutSection(clip: Clip): HTMLElement {
    const cut = cutoutOf(clip);
    const job = jobs.get(clip.id);
    const setCut = (patch: Partial<typeof cut>, once = true): void => this.change(clip.id, c => (c.cutout = { ...cutoutOf(c), ...patch }), once);
    const rows: HTMLElement[] = [this.select('Cutout', CUTOUT_MODES, cut.mode, v => setCut({ mode: v }))];
    this.progress = h('p', { class: 'hint' });
    if (job) {
      this.progress.textContent = job.progress ? `Tracking the object… ${Math.round(job.progress * 100)}%` : 'Loading the object model…';
      rows.push(h('div', { class: 'btn-row' }, button('Cancel', 'Stop tracking', () => job.abort.abort(), 'btn small')));
    } else {
      const btns = h('div', { class: 'btn-row' }, button(cut.maskId ? 'Pick again' : 'Pick object', 'Click the object in the viewer', () => this.startPick(clip, false), 'btn small primary'));
      if (cut.maskId) {
        btns.append(
          button('Add object', 'Click another object to cut out together', () => this.startPick(clip, true), 'btn small'),
          button('Clear', 'Remove the cutout', () => setCut(defaultCutout()), 'btn small'),
        );
      }
      rows.push(btns);
      this.progress.textContent = cut.maskId
        ? `${cut.points.length} object${cut.points.length > 1 ? 's' : ''} tracked through the clip.`
        : 'Click Pick object, then click any object in the viewer. It is followed through the whole clip. The first use downloads a small AI model.';
    }
    if (cut.maskId) {
      rows.push(
        this.slider(clip, { label: 'Edge softness', min: 0, max: 1, step: 0.01, reset: 0.2, get: c => cutoutOf(c).feather, set: (c, v) => (c.cutout = { ...cutoutOf(c), feather: v }) }),
        this.slider(clip, { label: 'Shrink / grow', min: -1, max: 1, step: 0.01, reset: 0, get: c => cutoutOf(c).expand, set: (c, v) => (c.cutout = { ...cutoutOf(c), expand: v }) }),
        this.checkRow('Show mask', cut.show, v => setCut({ show: v })),
      );
      if (cut.mode === 'erase' && clip.kind === 'video') rows.push(this.checkRow('Fill from other frames (steady camera)', cut.plate, v => setCut({ plate: v })));
    }
    rows.push(this.progress);
    return this.section('AI – Object Cutout', rows);
  }

  private checkRow(label: string, on: boolean, onChange: (v: boolean) => void): HTMLElement {
    const box = h('input', { type: 'checkbox' });
    box.checked = on;
    box.addEventListener('change', () => onChange(box.checked));
    return h('label', { class: 'inline check-row' }, box, ` ${label}`);
  }

  private startPick(clip: Clip, add: boolean): void {
    const t = store.ui.playhead;
    if (t < clip.start || t >= clip.start + clip.duration) store.setPlayhead(clip.start + Math.min(0.5, clip.duration / 2));
    const layer = h('div', { class: 'pick-overlay' }, h('div', { class: 'pick-hint' }, 'Click the object you want to cut out · Esc to cancel'));
    const done = (): void => {
      this.viewer.setOverlay(null);
      window.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      done();
    };
    window.addEventListener('keydown', onKey, true);
    layer.addEventListener('pointerdown', e => {
      const r = this.viewer.contentRect();
      const live = store.clip(clip.id);
      const point = live ? this.engine.clipUv(live, store.ui.playhead, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height) : null;
      done();
      if (!live || !point) {
        toast('Click on the picture of the selected clip.');
        return;
      }
      const at = live.kind === 'image' ? 0 : live.offset + (store.ui.playhead - live.start) * speedOf(live);
      const points = add ? [...cutoutOf(live).points, point] : [point];
      const onProgress = (): void => {
        const job = jobs.get(clip.id);
        if (job && this.progress?.isConnected) this.progress.textContent = job.progress ? `Tracking the object… ${Math.round(job.progress * 100)}%` : 'Loading the object model…';
      };
      this.render();
      trackObject(clip.id, points, at, onProgress)
        .then(n => toast(n > 1 ? `Object tracked through ${n} frames` : 'Object cut out'))
        .catch(e => {
          if ((e as DOMException).name !== 'AbortError') toast(`Cutout failed: ${(e as Error).message}`);
        })
        .finally(() => this.render());
      queueMicrotask(() => this.render());
    });
    this.viewer.setOverlay(layer);
  }

  private transitionSection(clip: Clip): HTMLElement {
    const options = [{ id: 'none', label: 'None' }, ...TRANSITIONS] as { id: TransitionKind | 'none'; label: string }[];
    const setKind = (kind: TransitionKind | 'none'): void =>
      this.change(clip.id, c => {
        for (const l of linked(c)) l.transIn = kind === 'none' ? undefined : { kind: l.kind === 'audio' ? 'dissolve' : kind, duration: l.transIn?.duration ?? 1 };
      }, true);
    const rows = [this.select('Into this clip', options, clip.transIn?.kind ?? 'none', setKind)];
    if (clip.transIn) {
      rows.push(
        this.slider(clip, {
          label: 'Duration (s)',
          min: 0.1,
          max: Math.max(0.2, Math.min(4, clip.duration)),
          step: 0.05,
          reset: 1,
          get: c => c.transIn?.duration ?? 1,
          set: (c, v) => linked(c).forEach(l => l.transIn && (l.transIn = { ...l.transIn, duration: v })),
        }),
      );
    }
    rows.push(h('p', { class: 'hint' }, 'Plays across the cut from the clip before it, or from black when nothing is before it. Shortcut: Ctrl+T.'));
    return this.section('Transition', rows);
  }

  private effectsSection(clip: Clip): HTMLElement {
    const fx = fxOf(clip);
    const setFx = (patch: Partial<Effects>, once = false): void => this.change(clip.id, c => (c.fx = { ...fxOf(c), ...patch }), once);
    const looks = h('div', { class: 'look-grid' });
    for (const look of LOOKS) looks.append(button(look.label, `Apply the ${look.label} look`, () => setFx({ look: look.id }, true), `look-chip look-${look.id}${fx.look === look.id ? ' on' : ''}`));
    const fxSlider = (label: string, key: keyof Effects, min: number, max: number, reset = 0): HTMLElement =>
      this.slider(clip, { label, min, max, step: 0.01, reset, get: c => Number(fxOf(c)[key] ?? reset), set: (c, v) => (c.fx = { ...fxOf(c), [key]: v }) });
    return this.section('Filters & Effects', [
      looks,
      fxSlider('Look amount', 'amount', 0, 1, 1),
      fxSlider('Vignette', 'vignette', 0, 1),
      fxSlider('Film grain', 'grain', 0, 1),
      fxSlider('Blur', 'blur', 0, 1),
      fxSlider('Sharpen', 'sharpen', 0, 1),
      fxSlider('Noise reduction', 'denoise', 0, 1),
      fxSlider('Lens correction', 'lens', -1, 1),
      fxSlider('Lens flare', 'flare', 0, 1.5),
      ...((fx.flare ?? 0) > 0 ? [fxSlider('Flare X', 'flareX', 0, 1, 0.25), fxSlider('Flare Y', 'flareY', 0, 1, 0.25)] : []),
      this.resetRow('Reset effects', () => setFx(defaultFx(), true)),
    ]);
  }

  private animationSection(clip: Clip): HTMLElement {
    const a = animOf(clip);
    const setAnim = (patch: Partial<Animation>, once = false): void => this.change(clip.id, c => (c.anim = { ...animOf(c), ...patch }), once);
    const maxDur = Math.max(0.1, Math.min(5, clip.duration / 2));
    return this.section('Animation presets', [
      this.select('In', ANIMS, a.in, v => setAnim({ in: v }, true)),
      this.slider(clip, { label: 'In time (s)', min: 0.1, max: maxDur, step: 0.05, reset: 0.6, get: c => animOf(c).inDur, set: (c, v) => (c.anim = { ...animOf(c), inDur: v }) }),
      this.select('Out', ANIMS, a.out, v => setAnim({ out: v }, true)),
      this.slider(clip, { label: 'Out time (s)', min: 0.1, max: maxDur, step: 0.05, reset: 0.6, get: c => animOf(c).outDur, set: (c, v) => (c.anim = { ...animOf(c), outDur: v }) }),
      this.select('Motion', MOTIONS, a.motion, v => setAnim({ motion: v }, true)),
      this.resetRow('Remove animation', () => this.change(clip.id, c => (c.anim = defaultAnim()), true)),
    ]);
  }

  private aiSection(clip: Clip): HTMLElement {
    const ai = aiOf(clip);
    const status = segmenterStatus();
    const note =
      status.state === 'loading'
        ? 'Downloading the AI model…'
        : status.state === 'error'
          ? `AI model unavailable: ${status.error}`
          : status.state === 'ready'
            ? 'AI model ready. Works best on people.'
            : 'Finds people automatically. Downloads a small AI model (about 250 KB) the first time; needs internet once.';
    return this.section('AI – Magic Mask', [
      this.select('Background', AI_MODES, ai.mode, v => {
        this.change(clip.id, c => (c.ai = { ...aiOf(c), mode: v }), true);
        if (v !== 'none') ensureSegmenter(() => {
          store.emit('media');
          store.emit('selection');
        });
      }),
      this.slider(clip, { label: 'Defocus amount', min: 0, max: 1, step: 0.01, reset: 0.7, get: c => aiOf(c).amount, set: (c, v) => (c.ai = { ...aiOf(c), amount: v }) }),
      h('p', { class: `hint${status.state === 'error' ? ' error' : ''}` }, note),
    ]);
  }

  private subtitleSection(clip: Clip): HTMLElement {
    const lang = h('select', { class: 'select small' });
    lang.append(h('option', { value: 'en' }, 'English (faster)'), h('option', { value: 'multi' }, 'Any language'));
    const run = button(this.busy || 'Generate subtitles', 'Transcribe speech into subtitle clips', () => {
      if (this.busy) return;
      this.busy = 'Starting…';
      run.disabled = true;
      run.textContent = this.busy;
      generateSubtitles(clip.id, lang.value === 'multi', s => {
        this.busy = s;
        run.textContent = s;
      })
        .then(n => toast(n ? `Added ${n} subtitle${n === 1 ? '' : 's'} on the Subtitles track` : 'No speech was found in this clip'))
        .catch(e => toast(`Subtitles failed: ${(e as Error).message}`))
        .finally(() => {
          this.busy = '';
          this.render();
        });
    }, 'btn small primary');
    run.disabled = !!this.busy;
    return this.section('AI – Auto Subtitles', [
      h('label', { class: 'field wide' }, h('span', {}, 'Language'), lang),
      h('div', { class: 'btn-row' }, run, ...(hasSubtitles() ? [button('Export .srt', 'Download the subtitles as an .srt file', exportSrt, 'btn small')] : [])),
      h('p', { class: 'hint' }, 'Runs the Whisper speech model in your browser. The first run downloads about 40–75 MB; your audio is never uploaded.'),
    ]);
  }

  private speedSection(clip: Clip): HTMLElement {
    const current = speedOf(clip);
    const row = h('div', { class: 'btn-row' });
    for (const s of SPEEDS) row.append(button(`${s}×`, `Play at ${s}× speed`, () => this.change(clip.id, c => setSpeed(c.id, s), true), `btn small${current === s ? ' active' : ''}`));
    return this.section('Speed', [row, h('p', { class: 'hint' }, 'Changing speed keeps the same footage and adjusts the clip length.')]);
  }

  private titleSection(clip: Clip): HTMLElement {
    const text = clip.text!;
    const edit = (fn: (c: Clip) => void): void => this.change(clip.id, c => c.text && fn(c));
    const content = h('textarea', { rows: '3' });
    content.value = text.content;
    content.addEventListener('input', () => edit(c => (c.text!.content = content.value)));
    content.addEventListener('change', this.end);
    const size = h('input', { type: 'range', min: '16', max: '320', step: '1', value: String(text.size) });
    size.addEventListener('input', () => edit(c => (c.text!.size = Number(size.value))));
    size.addEventListener('change', this.end);
    const color = h('input', { type: 'color', value: text.color });
    color.addEventListener('input', () => edit(c => (c.text!.color = color.value)));
    color.addEventListener('change', this.end);
    const check = (label: string, on: boolean, set: (c: Clip, v: boolean) => void): HTMLElement => {
      const box = h('input', { type: 'checkbox' });
      box.checked = on;
      box.addEventListener('change', () => {
        edit(c => set(c, box.checked));
        this.end();
      });
      return h('span', { class: 'inline' }, box, ` ${label}`);
    };
    return this.section('Title', [
      h('label', { class: 'field stack' }, h('span', {}, 'Text'), content),
      h('label', { class: 'field' }, h('span', {}, 'Size'), size),
      h('label', { class: 'field' }, h('span', {}, 'Color'), color, check('Bold', text.bold, (c, v) => (c.text!.bold = v))),
      h('div', { class: 'btn-row' }, check('Background box', !!text.box, (c, v) => (c.text!.box = v))),
    ]);
  }
}
