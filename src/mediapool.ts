import { appendMedia, removeMedia } from './edit';
import { importFiles } from './media';
import { deleteBlob } from './persist';
import { store } from './state';
import type { MediaMeta } from './types';
import { button, fileSize, h, icons, pickFiles, shortDuration } from './util';

export const MEDIA_MIME = 'text/x-frameforge-media';
export const ACCEPT = 'video/*,audio/*,image/*';

export class MediaPool {
  readonly root = h('div', { class: 'panel pool' });
  private readonly grid = h('div', { class: 'pool-grid' });
  private readonly info = h('div', { class: 'pool-info' });
  private selected: string | null = null;
  onEditImage: ((mediaId: string) => void) | null = null;
  onSounds: (() => void) | null = null;

  constructor() {
    const head = h(
      'div',
      { class: 'panel-head' },
      h('span', {}, 'Media Pool'),
      h(
        'div',
        { class: 'head-tools' },
        button(`${icons.music}<span>Sounds</span>`, 'Open the sound library', () => this.onSounds?.(), 'btn small'),
        button(`${icons.plus}<span>Import</span>`, 'Import media (Ctrl+I)', () => void this.import(), 'btn small'),
      ),
    );
    this.root.append(head, this.grid, this.info);
    this.root.addEventListener('dragover', e => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        this.root.classList.add('drop');
      }
    });
    this.root.addEventListener('dragleave', () => this.root.classList.remove('drop'));
    this.root.addEventListener('drop', e => {
      this.root.classList.remove('drop');
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      e.stopPropagation();
      void importFiles([...e.dataTransfer.files]);
    });
    store.on(c => {
      if (c === 'media' || c === 'project') this.render();
    });
    this.render();
  }

  async import(): Promise<void> {
    const files = await pickFiles(ACCEPT, true);
    if (files.length) await importFiles(files);
  }

  private render(): void {
    const media = store.project.media;
    if (!media.length) {
      this.grid.replaceChildren(h('div', { class: 'empty' }, h('strong', {}, 'No media yet'), h('span', {}, 'Click Import or drop video, audio and image files here.')));
    } else {
      this.grid.replaceChildren(...media.map(m => this.card(m)));
    }
    this.renderInfo();
  }

  private card(m: MediaMeta): HTMLElement {
    const rt = store.runtime.get(m.id);
    const thumb = h('div', { class: `thumb ${m.kind}` });
    if (rt?.thumb) thumb.style.backgroundImage = `url(${rt.thumb})`;
    else if (rt?.peaks) thumb.style.backgroundImage = `url(${rt.peaks})`;
    thumb.append(h('span', { class: 'badge' }, m.kind === 'image' ? 'Still' : shortDuration(m.duration)));
    if (!rt) thumb.append(h('span', { class: 'offline-tag' }, 'Offline'));
    const remove = button(icons.close, `Remove ${m.name}`, () => {
      if (!confirm(`Remove "${m.name}" and its clips from the project?`)) return;
      const url = store.runtime.get(m.id)?.url;
      if (url) URL.revokeObjectURL(url);
      store.runtime.delete(m.id);
      void deleteBlob(m.id);
      removeMedia(m.id);
    }, 'icon-btn remove');
    const card = h('div', { class: `card${this.selected === m.id ? ' sel' : ''}`, draggable: 'true', title: `${m.name}\nDouble-click to add to the end of the timeline` }, thumb, h('div', { class: 'card-name' }, m.name), remove);
    card.append(button(icons.plus, `Add ${m.name} to the timeline`, () => appendMedia(m.id), 'icon-btn add-media'));
    if (m.kind === 'image' && rt) {
      card.append(button(icons.pencil, `Edit ${m.name} in the image editor`, () => this.onEditImage?.(m.id), 'icon-btn edit-img'));
    }
    card.addEventListener('dragstart', e => {
      e.dataTransfer?.setData(MEDIA_MIME, m.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
    });
    card.dataset.id = m.id;
    card.addEventListener('click', () => {
      this.selected = m.id;
      this.grid.querySelectorAll<HTMLElement>('.card').forEach(el => el.classList.toggle('sel', el.dataset.id === m.id));
      this.renderInfo();
    });
    card.addEventListener('dblclick', () => appendMedia(m.id));
    return card;
  }

  private renderInfo(): void {
    const m = store.media(this.selected ?? undefined);
    if (!m) {
      this.info.replaceChildren();
      return;
    }
    const rows: [string, string][] = [
      ['Name', m.name],
      ['Type', m.kind],
      ['Duration', m.kind === 'image' ? 'Still image' : shortDuration(m.duration)],
      ['Resolution', m.width ? `${m.width} × ${m.height}` : '—'],
      ['Audio', m.hasAudio ? 'Yes' : 'No'],
      ['Size', fileSize(m.size)],
      ['Status', store.runtime.has(m.id) ? 'Online' : 'Offline – import the file again to relink'],
    ];
    this.info.replaceChildren(...rows.map(([k, v]) => h('div', { class: 'kv' }, h('span', {}, k), h('span', {}, v))));
  }
}
