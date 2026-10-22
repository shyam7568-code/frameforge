import { Engine } from './engine';
import { canvasSelect } from './formats';
import { store } from './state';
import { shareFile } from './share';
import { button, downloadBlob, fileSize, h, icons, shortDuration } from './util';

const FRAME_RATES = [24, 25, 30, 50, 60];
const QUALITY: [string, number][] = [
  ['Low (4 Mb/s)', 4e6],
  ['Medium (8 Mb/s)', 8e6],
  ['High (16 Mb/s)', 16e6],
  ['Best (32 Mb/s)', 32e6],
];

const formatLabel = (mime: string): string => {
  if (mime.startsWith('video/mp4')) return mime.includes('avc1') ? 'MP4 · H.264' : 'MP4';
  if (mime.includes('vp9')) return 'WebM · VP9';
  if (mime.includes('vp8')) return 'WebM · VP8';
  return 'WebM';
};

export class DeliverPage {
  readonly root = h('div', { class: 'page page-deliver' });
  readonly viewerSlot = h('div', { class: 'slot slot-viewer' });
  private readonly name = h('input', { type: 'text', class: 'text-input' });
  private readonly format = h('select', { class: 'select' });
  private readonly resolution = canvasSelect();
  private readonly fps = h('select', { class: 'select' });
  private readonly quality = h('select', { class: 'select' });
  private readonly summary = h('div', { class: 'summary' });
  private readonly queue = h('div', { class: 'queue' });
  private readonly renderBtn: HTMLButtonElement;
  private readonly overlay = h('div', { class: 'overlay hidden' });
  private readonly bar = h('div', { class: 'progress-fill' });
  private readonly status = h('div', { class: 'progress-text' });
  private abort: AbortController | null = null;

  constructor(private readonly engine: Engine) {
    const mimes = Engine.mimeTypes();
    const labels = new Set<string>();
    for (const m of mimes) {
      const label = formatLabel(m);
      if (labels.has(label)) continue;
      labels.add(label);
      this.format.append(h('option', { value: m }, label));
    }
    FRAME_RATES.forEach(f => this.fps.append(h('option', { value: String(f) }, `${f} fps`)));
    QUALITY.forEach(([label, bps]) => this.quality.append(h('option', { value: String(bps) }, label)));
    this.quality.value = String(16e6);
    this.fps.addEventListener('change', () => {
      store.checkpoint();
      store.project.fps = Number(this.fps.value);
      store.emit('project');
    });
    this.name.addEventListener('change', () => {
      const value = this.name.value.trim();
      if (!value || value === store.project.name) return;
      store.checkpoint();
      store.project.name = value;
      store.emit('project');
    });
    this.renderBtn = button('Render', 'Render the timeline to a video file', () => void this.render(), 'btn primary big');
    if (!mimes.length) this.renderBtn.disabled = true;
    const cancel = button('Cancel', 'Cancel the render', () => this.abort?.abort(), 'btn');
    this.overlay.append(h('div', { class: 'dialog' }, h('h3', {}, 'Rendering…'), h('div', { class: 'progress' }, this.bar), this.status, h('p', { class: 'hint' }, 'Rendering runs in real time. Keep this tab visible until it finishes.'), cancel));
    const field = (label: string, input: HTMLElement): HTMLElement => h('label', { class: 'field stack' }, h('span', {}, label), input);
    const settings = h(
      'div',
      { class: 'panel render-settings' },
      h('div', { class: 'panel-head' }, 'Render Settings'),
      h(
        'div',
        { class: 'settings-body' },
        field('File name', this.name),
        field('Format', mimes.length ? this.format : h('div', { class: 'warn' }, 'This browser cannot record video. Use a recent Chrome, Edge or Firefox.')),
        field('Resolution', this.resolution),
        field('Frame rate', this.fps),
        field('Quality', this.quality),
        this.summary,
        this.renderBtn,
      ),
    );
    this.root.append(settings, this.viewerSlot, h('div', { class: 'panel render-queue' }, h('div', { class: 'panel-head' }, 'Renders'), this.queue), this.overlay);
    store.on(c => {
      if (c === 'project') this.sync();
    });
    this.sync();
    this.renderQueue([]);
  }

  private sync(): void {
    const p = store.project;
    if (document.activeElement !== this.name) this.name.value = p.name;
    this.fps.value = String(p.fps);
    const clips = p.clips.length;
    this.summary.textContent = `${clips} clip${clips === 1 ? '' : 's'} · ${shortDuration(store.duration())} long`;
    this.renderBtn.disabled = !Engine.mimeTypes().length || store.duration() <= 0;
  }

  private readonly done: { name: string; url: string; size: number; file: File }[] = [];

  private renderQueue(items: { name: string; url: string; size: number; file: File }[]): void {
    if (!items.length) {
      this.queue.replaceChildren(h('div', { class: 'empty' }, h('strong', {}, 'No renders yet'), h('span', {}, 'Finished videos appear here.')));
      return;
    }
    this.queue.replaceChildren(
      ...items.map(i => {
        const link = h('a', { href: i.url, download: i.name, class: 'btn small' }, 'Download');
        const share = button(`${icons.share}<span>Share</span>`, `Share ${i.name}`, () => void shareFile(i.file), 'btn small primary');
        return h('div', { class: 'job' }, h('div', { class: 'job-name' }, i.name, h('span', {}, fileSize(i.size))), h('div', { class: 'btn-row' }, share, link));
      }),
    );
  }

  private async render(): Promise<void> {
    const mimeType = this.format.value;
    const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    const base = (this.name.value.trim() || store.project.name || 'render').replace(/[\\/:*?"<>|]+/g, '-');
    this.abort = new AbortController();
    this.overlay.classList.remove('hidden');
    this.bar.style.width = '0%';
    this.status.textContent = 'Preparing…';
    const started = performance.now();
    try {
      const blob = await this.engine.exportVideo({
        mimeType,
        bitrate: Number(this.quality.value),
        signal: this.abort.signal,
        onProgress: p => {
          const pct = Math.min(100, p * 100);
          this.bar.style.width = `${pct}%`;
          const elapsed = (performance.now() - started) / 1000;
          const left = p > 0.02 ? (elapsed / p) * (1 - p) : 0;
          this.status.textContent = `${pct.toFixed(0)}%${left ? ` · about ${shortDuration(left)} left` : ''}`;
        },
      });
      const file = `${base}.${ext}`;
      this.done.unshift({ name: file, url: URL.createObjectURL(blob), size: blob.size, file: new File([blob], file, { type: blob.type }) });
      this.renderQueue(this.done);
      downloadBlob(blob, file);
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') alert(`Render failed: ${(e as Error).message}`);
    } finally {
      this.overlay.classList.add('hidden');
      this.abort = null;
    }
  }
}
