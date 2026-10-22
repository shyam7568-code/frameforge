import type { App } from './app';
import { composeDoc, flatten } from './compose';
import { ctx2d, makeCanvas, newLayer, walk } from './doc';
import { imageLayer, readPsd, recordFrames, videoType, writeApng, writeGif, writePdf, writePsd } from './formats';
import { btn, closePopover, download, el, ic, menuList, pick, popover, segmented, shareOrDownload, slider, toggle } from './kit';
import { get, keys, packDoc, prefix, put } from './store';
import type { ToolBars } from './tools';
import type { View } from './view';
import type { Model3D } from './model3d';
import { writeGlb, writeObjZip, writeUsdz } from './mesh';
import { toast } from '../util';

let clipboard: HTMLCanvasElement | null = null;

export function setClipboard(c: HTMLCanvasElement | null): void {
  clipboard = c;
}

const safe = (s: string): string => s.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'artwork';

async function blobOf(c: HTMLCanvasElement, type: string, q?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not encode'))), type, q));
}

export async function insertFile(app: App, file: File): Promise<void> {
  const name = file.name.replace(/\.[^.]+$/, '');
  if (/\.psd$/i.test(file.name)) {
    const psd = await readPsd(file);
    const s = Math.min(1, app.doc.width / psd.width, app.doc.height / psd.height);
    for (const l of psd.layers) {
      walk([l], x => {
        if (x.kind === 'group') return;
        const c = makeCanvas(app.doc.width, app.doc.height);
        ctx2d(c).drawImage(x.canvas, (app.doc.width - psd.width * s) / 2, (app.doc.height - psd.height * s) / 2, psd.width * s, psd.height * s);
        x.canvas = c;
      });
      app.insertLayer(l);
    }
    if (psd.warning) toast(psd.warning);
    return;
  }
  const bmp = await createImageBitmap(file);
  app.insertLayer(imageLayer(app.doc, bmp, name, true));
  bmp.close();
  app.setTool('transform');
}

function canvasSizeDialog(app: App): void {
  const d = app.doc;
  const root = el('div', 'pform');
  const w = el('input', 'pinput');
  const hgt = el('input', 'pinput');
  w.type = hgt.type = 'number';
  w.value = String(d.width);
  hgt.value = String(d.height);
  let ax = 0.5;
  let ay = 0.5;
  let resample = false;
  let lock = true;
  const ratio = d.width / d.height;
  w.addEventListener('input', () => lock && (hgt.value = String(Math.round(Number(w.value) / ratio))));
  hgt.addEventListener('input', () => lock && (w.value = String(Math.round(Number(hgt.value) * ratio))));
  const anchors = el('div', 'panchor');
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++) {
      const b = btn('', 'Anchor', () => {
        ax = x / 2;
        ay = y / 2;
        anchors.querySelectorAll('button').forEach(q => q.classList.remove('on'));
        b.classList.add('on');
      }, `pbtn${x === 1 && y === 1 ? ' on' : ''}`);
      anchors.append(b);
    }
  const mem = el('p', 'phint');
  const est = (): void => {
    const bytes = Number(w.value) * Number(hgt.value) * 4;
    const budget = ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4) * 1024 ** 3 * 0.35;
    mem.textContent = `About ${Math.max(1, Math.floor(budget / Math.max(1, bytes)))} layers fit comfortably on this device at this size.`;
  };
  w.addEventListener('input', est);
  hgt.addEventListener('input', est);
  est();
  root.append(
    el('div', 'prow2', el('label', '', 'Width', w), el('label', '', 'Height', hgt)),
    toggle('Keep proportions', lock, v => (lock = v)),
    toggle('Resample (scale the artwork)', resample, v => {
      resample = v;
      anchors.classList.toggle('dim', v);
    }),
    el('div', 'plabel small', 'Anchor (when not resampling)'),
    anchors,
    mem,
    btn(`${ic.check}<span>Apply</span>`, 'Apply', () => {
      closePopover(true);
      app.resizeCanvas(Number(w.value), Number(hgt.value), ax, ay, resample);
    }, 'pbtn primary'),
  );
  popover(null, root, { title: 'Crop & resize canvas', sheet: true });
}

function canvasInfo(app: App): void {
  const d = app.doc;
  let layers = 0;
  walk(d.layers, l => l.kind !== 'group' && layers++);
  const mins = Math.round((d.seconds + (Date.now() - d.updated) / 1000) / 60);
  const rows: [string, string][] = [
    ['Name', d.name],
    ['Dimensions', `${d.width} × ${d.height} px`],
    ['Print size', `${((d.width / d.dpi) * 2.54).toFixed(1)} × ${((d.height / d.dpi) * 2.54).toFixed(1)} cm at ${d.dpi} DPI`],
    ['Layers', String(layers)],
    ['Strokes', String(d.strokes)],
    ['Time spent', mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`],
    ['Created', new Date(d.created).toLocaleString()],
  ];
  popover(null, el('div', 'pinfo', ...rows.map(([k, v]) => el('div', 'pkv', el('span', '', k), el('strong', '', v)))), { title: 'Canvas information', sheet: true });
}

function crcTable(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}

async function zip(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const T = crcTable();
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer());
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = T[(crc ^ data[i]) & 255] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const name = new TextEncoder().encode(f.name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(local.buffer, name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    const entry = new Uint8Array(46 + name.length);
    entry.set(new Uint8Array(cd.buffer), 0);
    entry.set(name, 46);
    central.push(entry);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

export function frameImages(app: App, maxSide: number): { frames: ImageData[]; delays: number[]; w: number; h: number } {
  const d = app.doc;
  const a = d.anim;
  const s = Math.min(1, maxSide / Math.max(d.width, d.height));
  const w = Math.round(d.width * s);
  const hgt = Math.round(d.height * s);
  const frames = app.frames();
  const out: ImageData[] = [];
  const delays: number[] = [];
  const full = makeCanvas(d.width, d.height);
  const small = makeCanvas(w, hgt);
  const sg = ctx2d(small);
  const wasPlaying = app.playing;
  app.playing = true;
  frames.forEach((f, i) => {
    const prev = a.current;
    a.current = i;
    composeDoc(ctx2d(full), d, { x: 0, y: 0, w: d.width, h: d.height }, app.composeOptions(), 0, 0, true);
    a.current = prev;
    sg.clearRect(0, 0, w, hgt);
    sg.imageSmoothingQuality = 'high';
    sg.drawImage(full, 0, 0, w, hgt);
    const img = sg.getImageData(0, 0, w, hgt);
    const hold = 1 + (f.hold ?? 0);
    out.push(img);
    delays.push((1000 / a.fps) * hold);
  });
  if (a.mode === 'pingpong' && out.length > 2) {
    for (let i = out.length - 2; i > 0; i--) {
      out.push(out[i]);
      delays.push(delays[i]);
    }
  }
  app.playing = wasPlaying;
  return { frames: out, delays, w, h: hgt };
}

async function exportAnimation(app: App, kind: 'gif' | 'apng' | 'video'): Promise<void> {
  if (app.frames().length < 2) {
    toast('Turn on Animation Assist and add at least two frames (layers) first.');
    return;
  }
  toast('Rendering the animation…');
  await new Promise(r => setTimeout(r, 30));
  const base = safe(app.doc.name);
  const loop = app.doc.anim.mode !== 'once';
  if (kind === 'gif') {
    const { frames, delays } = frameImages(app, 1080);
    await shareOrDownload(writeGif(frames, delays, loop, !app.doc.bgVisible), `${base}.gif`);
  } else if (kind === 'apng') {
    const { frames, delays } = frameImages(app, 1600);
    await shareOrDownload(await writeApng(frames, delays, loop), `${base}.png`);
  } else {
    if (!videoType()) {
      toast('This browser cannot record video. Try GIF instead.');
      return;
    }
    const { frames, delays, w, h } = frameImages(app, 1920);
    const fps = 30;
    const seq: number[] = [];
    frames.forEach((_, i) => {
      const n = Math.max(1, Math.round((delays[i] / 1000) * fps));
      for (let k = 0; k < n; k++) seq.push(i);
    });
    const loops = Math.max(1, Math.ceil((fps * 4) / seq.length));
    const all = Array.from({ length: loops }, () => seq).flat();
    const tmp = makeCanvas(w, h);
    const blob = await recordFrames((i, g) => {
      ctx2d(tmp).putImageData(frames[all[Math.min(i, all.length - 1)]], 0, 0);
      g.fillStyle = '#fff';
      g.fillRect(0, 0, w, h);
      g.drawImage(tmp, 0, 0);
    }, all.length, fps, w % 2 ? w - 1 : w, h % 2 ? h - 1 : h);
    await shareOrDownload(blob, `${base}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
  }
}

async function sendToFrameforge(app: App): Promise<void> {
  const blob = await blobOf(app.flattened(true), 'image/png');
  await put('inbox', `${Date.now()}`, { name: `${safe(app.doc.name)}.png`, blob });
  toast('Sent. Open Frameforge and it appears in the Media Pool.');
}

async function exportFormat(app: App, kind: string): Promise<void> {
  const d = app.doc;
  const base = safe(d.name);
  try {
    switch (kind) {
      case 'png':
        await shareOrDownload(await blobOf(app.flattened(d.bgVisible), 'image/png'), `${base}.png`);
        break;
      case 'jpg':
        await shareOrDownload(await blobOf(app.flattened(true), 'image/jpeg', 0.93), `${base}.jpg`);
        break;
      case 'psd':
        toast('Building the PSD…');
        await new Promise(r => setTimeout(r, 30));
        await shareOrDownload(writePsd(d, app.flattened(true)), `${base}.psd`);
        break;
      case 'pdf':
        await shareOrDownload(await writePdf(app.flattened(true), d.dpi), `${base}.pdf`);
        break;
      case 'ffpaint':
        await shareOrDownload(await packDoc(d), `${base}.ffpaint`);
        break;
      case 'layers': {
        const files: { name: string; blob: Blob }[] = [];
        let i = 1;
        for (const l of [...d.layers].reverse()) {
          const c = l.kind === 'group' ? flatten({ ...d, bgVisible: false, layers: [{ ...l, blend: 'normal', opacity: 1 }] }, false) : l.canvas;
          files.push({ name: `${String(i++).padStart(2, '0')} ${safe(l.name)}.png`, blob: await blobOf(c, 'image/png') });
        }
        await shareOrDownload(await zip(files), `${base} layers.zip`);
        break;
      }
      case 'gif':
      case 'apng':
      case 'video':
        await exportAnimation(app, kind);
        break;
      case 'frameforge':
        await sendToFrameforge(app);
        break;
    }
  } catch (e) {
    toast(`Export failed: ${(e as Error).message}`);
  }
}

async function timelapsePlayer(app: App): Promise<void> {
  const ids = await keys('timelapse', prefix(`${app.doc.id}:`));
  if (!ids.length) {
    toast('Nothing recorded yet. Time-lapse records every stroke automatically.');
    return;
  }
  const root = el('div', 'plapse');
  const c = makeCanvas(app.doc.width, app.doc.height);
  const first = await get<Blob>('timelapse', ids[0]);
  if (first) {
    const b = await createImageBitmap(first);
    c.width = b.width;
    c.height = b.height;
  }
  const g = ctx2d(c);
  const pos = el('input', '');
  pos.type = 'range';
  pos.min = '0';
  pos.max = String(ids.length - 1);
  pos.value = '0';
  let playing = true;
  let i = 0;
  const show = async (k: number): Promise<void> => {
    const blob = await get<Blob>('timelapse', ids[k]);
    if (!blob) return;
    const bmp = await createImageBitmap(blob);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
  };
  const tick = async (): Promise<void> => {
    if (!root.isConnected) return;
    if (playing) {
      await show(i);
      pos.value = String(i);
      i = (i + 1) % ids.length;
    }
    setTimeout(() => void tick(), 1000 / 30);
  };
  pos.addEventListener('input', () => {
    playing = false;
    i = Number(pos.value);
    void show(i);
  });
  const playBtn = btn(ic.pause, 'Play / pause', () => {
    playing = !playing;
    playBtn.innerHTML = playing ? ic.pause : ic.play;
  }, 'pbtn icon');
  const exp = async (seconds: number | null): Promise<void> => {
    if (!videoType()) {
      toast('This browser cannot record video.');
      return;
    }
    playing = false;
    const fps = 30;
    const count = seconds ? Math.min(ids.length, seconds * fps) : ids.length;
    const pickIdx = (k: number): number => (seconds ? Math.round((k / Math.max(1, count - 1)) * (ids.length - 1)) : k);
    const bitmaps: ImageBitmap[] = [];
    toast('Preparing the time-lapse…');
    for (let k = 0; k < count; k++) {
      const b = await get<Blob>('timelapse', ids[pickIdx(k)]);
      if (b) bitmaps.push(await createImageBitmap(b));
    }
    const w = c.width % 2 ? c.width - 1 : c.width;
    const hh = c.height % 2 ? c.height - 1 : c.height;
    const hold = fps;
    const blob = await recordFrames((k, gg) => {
      const bm = bitmaps[Math.min(k, bitmaps.length - 1)];
      gg.drawImage(bm, 0, 0, w, hh);
    }, bitmaps.length + hold, fps, w, hh, p => (status.textContent = `Recording ${Math.round(p * 100)}%`));
    status.textContent = '';
    bitmaps.forEach(b => b.close());
    await shareOrDownload(blob, `${safe(app.doc.name)} time-lapse.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
  };
  const status = el('span', 'phint');
  root.append(c, el('div', 'pbar-row', playBtn, pos), el('div', 'prow-btns', btn('Export full length', 'Export every recorded stroke', () => void exp(null), 'pbtn small'), btn('Export 30 seconds', 'Export a 30-second summary', () => void exp(30), 'pbtn small'), status));
  popover(null, root, { title: `Time-lapse · ${ids.length} frames`, sheet: true });
  void tick();
}

export class ReferenceWindow {
  readonly el = el('div', 'pref hidden');
  private readonly canvas = makeCanvas(320, 240);
  private image: ImageBitmap | null = null;
  private mode: 'canvas' | 'image' = 'canvas';

  constructor(private readonly app: App) {
    const head = el('div', 'pref-head');
    const seg = segmented(
      [
        { id: 'canvas', label: 'Canvas' },
        { id: 'image', label: 'Image' },
      ],
      'canvas',
      async v => {
        this.mode = v;
        if (v === 'image' && !this.image) {
          const f = await pick('image/*');
          if (f) this.image = await createImageBitmap(f);
        }
        this.draw();
      },
      'small',
    );
    head.append(seg, btn(ic.close, 'Close reference', () => this.toggle(false), 'pbtn icon small'));
    this.el.append(head, this.canvas, el('div', 'pref-resize'));
    let drag: { x: number; y: number; l: number; t: number; w: number; h: number; mode: 'move' | 'size' } | null = null;
    this.el.addEventListener('pointerdown', e => {
      const t = e.target as HTMLElement;
      if (t.closest('button')) return;
      const r = this.el.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, l: r.left, t: r.top, w: r.width, h: r.height, mode: t.classList.contains('pref-resize') ? 'size' : 'move' };
      this.el.setPointerCapture(e.pointerId);
    });
    this.el.addEventListener('pointermove', e => {
      if (!drag) return;
      if (drag.mode === 'move') {
        this.el.style.left = `${drag.l + e.clientX - drag.x}px`;
        this.el.style.top = `${drag.t + e.clientY - drag.y}px`;
      } else {
        this.el.style.width = `${Math.max(160, drag.w + e.clientX - drag.x)}px`;
        this.draw();
      }
    });
    this.el.addEventListener('pointerup', () => (drag = null));
    let pending = 0;
    app.on(w => {
      if (w === 'render' && !this.el.classList.contains('hidden') && this.mode === 'canvas') {
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(() => this.draw());
      }
    });
  }

  toggle(on?: boolean): void {
    const show = on ?? this.el.classList.contains('hidden');
    this.el.classList.toggle('hidden', !show);
    if (show) this.draw();
  }

  draw(): void {
    const src = this.mode === 'image' && this.image ? this.image : this.app.composite;
    const w = Math.max(160, this.el.clientWidth || 280);
    const h = Math.round((w * src.height) / src.width);
    this.canvas.width = w * (window.devicePixelRatio || 1);
    this.canvas.height = h * (window.devicePixelRatio || 1);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const g = ctx2d(this.canvas);
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, this.canvas.width, this.canvas.height);
  }
}

export function actionsMenu(app: App, anchor: HTMLElement, view: View, bars: ToolBars, reference: ReferenceWindow, openGallery: () => void, model3d: Model3D): void {
  const root = el('div', 'pactions');
  const body = el('div', '');
  const tab = { v: (localStorage.getItem('frameforge-paint:actions') as string) || 'add' };
  const go = (fn: () => void | Promise<void>) => (): void => {
    closePopover(true);
    void fn();
  };
  const render = (): void => {
    const d = app.doc;
    let items: Parameters<typeof menuList>[0] = [];
    if (tab.v === 'add') {
      items = [
        { label: 'Insert a file', hint: 'image or PSD', icon: ic.import, action: go(async () => {
          const f = await pick('image/*,.psd');
          if (f) await insertFile(app, f).catch(e => toast(`Could not insert: ${(e as Error).message}`));
        }) },
        { label: 'Take a photo', icon: ic.camera, action: go(async () => {
          const f = await pick('image/*', true);
          if (f) await insertFile(app, f);
        }) },
        { label: 'New 3D painting', hint: 'sphere, cube… or import a model', icon: ic.cube, action: go(() => app.emit('new3d')) },
        { label: 'Add text', icon: ic.text, action: go(() => {
          app.addText('Text');
          bars.textEditor();
        }) },
        'sep',
        { label: 'Cut', action: go(() => setClipboard(app.copy(true))) },
        { label: 'Copy', action: go(() => {
          setClipboard(app.copy(false));
          toast('Copied');
        }) },
        { label: 'Copy canvas', action: go(() => {
          setClipboard(app.flattened(false));
          toast('Canvas copied');
        }) },
        { label: 'Paste', action: go(async () => {
          if (clipboard) app.paste(clipboard);
          else await pasteSystem(app);
        }) },
      ];
    } else if (tab.v === 'canvas') {
      items = [
        { label: 'Crop & resize', action: go(() => canvasSizeDialog(app)) },
        { label: 'Animation assist', on: d.anim.on, action: go(() => {
          d.anim.on = !d.anim.on;
          app.recompose();
          app.emit('anim');
          app.emit('render');
          app.scheduleSave();
        }) },
        { label: 'Drawing guide', on: d.guides.type !== 'none', action: go(() => bars.guideEditor()) },
        { label: 'Reference window', on: !reference.el.classList.contains('hidden'), action: go(() => reference.toggle()) },
        'sep',
        { label: 'Flip canvas horizontally', action: go(() => app.flipCanvas(true)) },
        { label: 'Flip canvas vertically', action: go(() => app.flipCanvas(false)) },
        { label: 'Rotate canvas 90°', action: go(() => app.rotateCanvas()) },
        { label: 'Mirror view (not the art)', on: view.flipX, action: go(() => view.flipView()) },
        { label: 'Fit to screen', action: go(() => view.fit()) },
        { label: 'Actual pixels', action: go(() => view.actualSize()) },
        'sep',
        { label: 'Canvas information', action: go(() => canvasInfo(app)) },
        { label: 'Rename artwork', action: go(() => {
          const n = prompt('Artwork name', d.name);
          if (n?.trim()) {
            d.name = n.trim();
            app.scheduleSave();
            app.emit('doc-name');
          }
        }) },
      ];
    } else if (tab.v === 'share') {
      items = [
        { header: 'Image' },
        { label: 'Frameforge Paint', hint: '.ffpaint, keeps everything', action: go(() => exportFormat(app, 'ffpaint')) },
        { label: 'PSD', hint: 'layers for Photoshop & others', action: go(() => exportFormat(app, 'psd')) },
        { label: 'PNG', action: go(() => exportFormat(app, 'png')) },
        { label: 'JPEG', action: go(() => exportFormat(app, 'jpg')) },
        { label: 'PDF', action: go(() => exportFormat(app, 'pdf')) },
        { header: 'Layers & animation' },
        { label: 'PNG files', hint: 'each layer, zipped', action: go(() => exportFormat(app, 'layers')) },
        { label: 'Animated GIF', action: go(() => exportFormat(app, 'gif')) },
        { label: 'Animated PNG', action: go(() => exportFormat(app, 'apng')) },
        { label: 'Animated video', hint: videoType().includes('mp4') ? 'MP4' : 'WebM', action: go(() => exportFormat(app, 'video')) },
        ...(d.mesh
          ? ([
              { header: '3D model' },
              { label: 'GLB', hint: 'glTF binary, works almost everywhere', action: go(() => export3d(app, model3d, 'glb')) },
              { label: 'USDZ', hint: 'opens in iPhone & iPad AR', action: go(() => export3d(app, model3d, 'usdz')) },
              { label: 'OBJ', hint: 'with material and texture, zipped', action: go(() => export3d(app, model3d, 'obj')) },
              { label: '3D snapshot', hint: 'PNG of the current view', action: go(() => export3d(app, model3d, 'snapshot')) },
              { label: 'Turntable video', hint: 'the model spinning', action: go(() => export3d(app, model3d, 'turntable')) },
            ] as Parameters<typeof menuList>[0])
          : []),
        { header: 'Apps' },
        { label: 'Send to Frameforge', hint: 'video editor', action: go(() => exportFormat(app, 'frameforge')) },
      ];
    } else if (tab.v === 'video') {
      items = [
        { label: 'Time-lapse replay', icon: ic.film, action: go(() => timelapsePlayer(app)) },
        { label: 'Export time-lapse', hint: 'full or 30 s', action: go(() => timelapsePlayer(app)) },
      ];
    } else if (tab.v === 'prefs') {
      const p = app.prefs;
      const box = el(
        'div',
        'pprefs',
        toggle('Light interface', p.light, v => ((p.light = v), app.savePrefs())),
        toggle('Right-hand sidebar', p.rightHanded, v => ((p.rightHanded = v), app.savePrefs())),
        toggle('Brush cursor', p.cursor, v => ((p.cursor = v), app.savePrefs())),
        toggle('Dynamic brush scaling', p.dynamicSize, v => ((p.dynamicSize = v), app.savePrefs())),
        toggle('Paint with finger', p.touchPaint, v => ((p.touchPaint = v), app.savePrefs())),
        toggle('Simulate pressure for finger & mouse', p.simulatePressure, v => ((p.simulatePressure = v), app.savePrefs())),
        toggle('Finger gestures (undo, redo, full screen)', p.fingerGestures, v => ((p.fingerGestures = v), app.savePrefs())),
        slider('Pressure response', 0.4, 2.5, 0.05, p.pressureGamma, v => ((p.pressureGamma = v), app.savePrefs()), v => (v < 0.95 ? 'Soft' : v > 1.05 ? 'Firm' : 'Linear') + ` ${v.toFixed(2)}`),
        slider('Extra smoothing', 0, 1, 0.01, p.smoothing, v => ((p.smoothing = v), app.savePrefs()), v => `${Math.round(v * 100)}%`),
        slider('Touch & hold delay', 150, 1200, 50, p.holdDelay, v => ((p.holdDelay = v), app.savePrefs()), v => `${(v / 1000).toFixed(2)} s`),
      );
      body.replaceChildren(box);
      return;
    } else {
      body.replaceChildren(
        el(
          'div',
          'phelp',
          ...[
            ['Two-finger tap', 'Undo (hold to undo repeatedly)'],
            ['Three-finger tap', 'Redo'],
            ['Four-finger tap', 'Hide or show the interface'],
            ['Pinch / twist', 'Zoom and rotate the canvas; quick pinch in to fit'],
            ['Touch & hold', 'Eyedropper (pick a color)'],
            ['Draw & hold', 'Snap the stroke to a perfect shape; keep holding to adjust'],
            ['Drag the color dot', 'Fill an area (ColorDrop)'],
            ['B / S / E', 'Brush, smudge, eraser'],
            ['[ and ]', 'Brush size down / up'],
            ['Shift + [ / ]', 'Opacity down / up'],
            ['Ctrl/⌘ Z, Shift+Ctrl/⌘ Z', 'Undo, redo'],
            ['Space + drag, wheel', 'Pan; Ctrl/⌘ + wheel zooms, Alt + wheel rotates'],
            ['Alt + click', 'Eyedropper'],
            ['0 / 1', 'Fit / actual pixels'],
            ['L, C, V', 'Layers, colors, transform'],
            ['Ctrl/⌘ A, D, J, E', 'Select all, deselect, duplicate layer, merge down'],
          ].map(([k, v]) => el('div', 'pkv', el('strong', '', k), el('span', '', v))),
          el('p', 'phint', 'Frameforge Paint is an original painting app that runs in your browser. Your artwork is stored on this device.'),
        ),
      );
      return;
    }
    body.replaceChildren(menuList(items));
  };
  const tabs = segmented(
    [
      { id: 'add', label: 'Add' },
      { id: 'canvas', label: 'Canvas' },
      { id: 'share', label: 'Share' },
      { id: 'video', label: 'Video' },
      { id: 'prefs', label: 'Prefs' },
      { id: 'help', label: 'Help' },
    ],
    tab.v,
    v => {
      tab.v = v;
      localStorage.setItem('frameforge-paint:actions', v);
      render();
    },
  );
  root.append(tabs, body, el('div', 'prow-btns', btn(`${ic.gallery}<span>Gallery</span>`, 'Back to the gallery', go(openGallery), 'pbtn small')));
  render();
  popover(anchor, root, { width: 330, title: 'Actions' });
}

async function export3d(app: App, model3d: Model3D, kind: 'glb' | 'usdz' | 'obj' | 'snapshot' | 'turntable'): Promise<void> {
  const mesh = app.doc.mesh;
  if (!mesh) return;
  const base = safe(app.doc.name);
  try {
    const tex = app.flattened(true);
    if (kind === 'glb') await shareOrDownload(await writeGlb(mesh, tex), `${base}.glb`);
    else if (kind === 'usdz') await shareOrDownload(await writeUsdz(mesh, tex), `${base}.usdz`);
    else if (kind === 'obj') await shareOrDownload(await writeObjZip(mesh, tex, base.replace(/\s+/g, '_')), `${base} OBJ.zip`);
    else if (kind === 'snapshot') {
      const c = model3d.snapshot(2048, 2048);
      await shareOrDownload(await blobOf(c, 'image/png'), `${base} 3D.png`);
    } else {
      if (!videoType()) {
        toast('This browser cannot record video.');
        return;
      }
      toast('Recording the turntable…');
      const frames = 150;
      const blob = await recordFrames((i, g) => {
        g.drawImage(model3d.turntable(1080, 1080, i, frames), 0, 0, 1080, 1080);
      }, frames, 30, 1080, 1080);
      model3d.endTurntable();
      await shareOrDownload(blob, `${base} turntable.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
    }
  } catch (e) {
    toast(`3D export failed: ${(e as Error).message}`);
  }
}

async function pasteSystem(app: App): Promise<void> {
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      const type = it.types.find(t => t.startsWith('image/'));
      if (!type) continue;
      const bmp = await createImageBitmap(await it.getType(type));
      const l = newLayer(app.doc, 'Pasted');
      const s = Math.min(1, app.doc.width / bmp.width, app.doc.height / bmp.height);
      ctx2d(l.canvas).drawImage(bmp, (app.doc.width - bmp.width * s) / 2, (app.doc.height - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
      app.insertLayer(l);
      return;
    }
    toast('The clipboard has no image.');
  } catch {
    toast('Nothing to paste. Copy something first.');
  }
}

export { download, exportFormat };
