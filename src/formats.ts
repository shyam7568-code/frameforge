import { store } from './state';
import { h } from './util';

export interface CanvasFormat {
  label: string;
  group: string;
  w: number;
  h: number;
}

export const FORMATS: CanvasFormat[] = [
  { group: 'Landscape', label: 'YouTube 16:9 · 1920 × 1080', w: 1920, h: 1080 },
  { group: 'Landscape', label: 'HD 16:9 · 1280 × 720', w: 1280, h: 720 },
  { group: 'Landscape', label: 'QHD 16:9 · 2560 × 1440', w: 2560, h: 1440 },
  { group: 'Landscape', label: '4K UHD 16:9 · 3840 × 2160', w: 3840, h: 2160 },
  { group: 'Landscape', label: 'Classic 4:3 · 1440 × 1080', w: 1440, h: 1080 },
  { group: 'Vertical', label: 'Reels / TikTok / Shorts 9:16 · 1080 × 1920', w: 1080, h: 1920 },
  { group: 'Vertical', label: 'Vertical HD 9:16 · 720 × 1280', w: 720, h: 1280 },
  { group: 'Vertical', label: 'Vertical 4K 9:16 · 2160 × 3840', w: 2160, h: 3840 },
  { group: 'Vertical', label: 'Instagram portrait 4:5 · 1080 × 1350', w: 1080, h: 1350 },
  { group: 'Vertical', label: 'Portrait 3:4 · 1080 × 1440', w: 1080, h: 1440 },
  { group: 'Vertical', label: 'Pinterest 2:3 · 1000 × 1500', w: 1000, h: 1500 },
  { group: 'Square', label: 'Square 1:1 · 1080 × 1080', w: 1080, h: 1080 },
  { group: 'Square', label: 'Square HD 1:1 · 720 × 720', w: 720, h: 720 },
  { group: 'Cinema', label: 'Ultrawide 21:9 · 2560 × 1080', w: 2560, h: 1080 },
  { group: 'Cinema', label: 'Cinemascope 2.39:1 · 1920 × 804', w: 1920, h: 804 },
  { group: 'Cinema', label: 'DCI 2K 1.9:1 · 2048 × 1080', w: 2048, h: 1080 },
  { group: 'Cinema', label: 'DCI 4K 1.9:1 · 4096 × 2160', w: 4096, h: 2160 },
];

const even = (n: number): number => Math.max(64, Math.min(7680, Math.round(n / 2) * 2));

export function setCanvas(w: number, hgt: number): void {
  const width = even(w);
  const height = even(hgt);
  if (width === store.project.width && height === store.project.height) return;
  store.checkpoint();
  Object.assign(store.project, { width, height });
  store.emit('project');
}

export function canvasSelect(cls = 'select'): HTMLSelectElement {
  const sel = h('select', { class: cls, title: 'Canvas size and shape' });
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const f of FORMATS) {
    let g = groups.get(f.group);
    if (!g) {
      g = h('optgroup', { label: f.group });
      groups.set(f.group, g);
      sel.append(g);
    }
    g.append(h('option', { value: `${f.w}x${f.h}` }, f.label));
  }
  const custom = h('option', { value: 'custom' }, 'Custom size…');
  sel.append(custom);
  const sync = (): void => {
    const { width, height } = store.project;
    const value = `${width}x${height}`;
    custom.textContent = FORMATS.some(f => `${f.w}x${f.h}` === value) ? 'Custom size…' : `Custom · ${width} × ${height}`;
    sel.value = FORMATS.some(f => `${f.w}x${f.h}` === value) ? value : 'custom';
  };
  sel.addEventListener('change', () => {
    if (sel.value === 'custom') {
      const answer = prompt('Canvas size in pixels (width × height), for example 1600 × 900', `${store.project.width} x ${store.project.height}`);
      const m = answer?.match(/(\d+)\s*[x×*, ]\s*(\d+)/i);
      if (m) setCanvas(Number(m[1]), Number(m[2]));
      sync();
      return;
    }
    const [w, hh] = sel.value.split('x').map(Number);
    setCanvas(w, hh);
  });
  store.on(c => {
    if (c === 'project') sync();
  });
  sync();
  return sel;
}
