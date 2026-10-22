import { h } from '../util';

const svg = (d: string, extra = ''): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${extra}>${d}</svg>`;

export const ic = {
  gallery: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  actions: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3.6 17.4a1.5 1.5 0 0 0 2.1 2.1l5.7-5.7a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.1-.5-.5-2.1z"/>'),
  adjust: svg('<path d="M4 20 15 9"/><path d="m14 4 1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/><path d="m19 11 .6 1.2 1.2.6-1.2.6-.6 1.2-.6-1.2-1.2-.6 1.2-.6z"/>'),
  select: svg('<path d="M5 8c0-3 4-5 8-4.5S20 6 19.5 9.5 15 15 10 14.5 5 11 5 8z" stroke-dasharray="3 2.4"/><path d="M8 14.5c-1 2-1 4 1 5.5"/>'),
  transform: svg('<path d="M5 3l12 6-5 1.5L10 16z"/><path d="M14 14l5 5"/>'),
  brush: svg('<path d="M20 4c-4 3-8 7-10 10"/><path d="M10 14c-2 0-4 1.5-4 4 0 1.3-1 2-2 2 3 1 8 0 8-3 0-1.3-.7-2.4-2-3z"/>'),
  smudge: svg('<path d="M9 21v-7a2 2 0 0 1 4 0V9a2 2 0 0 1 4 0v8a4 4 0 0 1-4 4z"/><path d="M13 14V6a2 2 0 0 0-4 0v8"/>'),
  erase: svg('<path d="M4 15l8-8a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3l-6 6H8z"/><path d="M8 20h12"/><path d="M9 10l6 6"/>'),
  layers: svg('<path d="M12 3 2 8l10 5 10-5z"/><path d="m2 13 10 5 10-5"/><path d="m2 17.5 10 5 10-5" opacity=".55"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>'),
  eye: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a9.6 9.6 0 0 0 4.2-1"/>'),
  play: svg('<path d="M7 4v16l13-8z" fill="currentColor"/>'),
  pause: svg('<path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor"/>'),
  more: svg('<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>'),
  drag: svg('<path d="M5 9h14M5 15h14"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>'),
  dropper: svg('<path d="m14 4 6 6-2 2-6-6z"/><path d="M12 6 4 14v4h4l8-8"/>'),
  import: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>'),
  share: svg('<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>'),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  text: svg('<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  folder: svg('<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  film: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>'),
  palette: svg('<path d="M12 3a9 9 0 0 0 0 18c1 0 2-.8 2-2 0-.6-.3-1-.6-1.4-.3-.4-.4-.8-.4-1.2 0-1 .9-1.6 2-1.6h2a5 5 0 0 0 5-5c0-4-4.5-6.8-10-6.8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="11" cy="7.5" r="1"/><circle cx="16" cy="8.5" r="1"/>'),
  cube: svg('<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>'),
  orbit: svg('<ellipse cx="12" cy="12" rx="10" ry="4"/><path d="M12 2a4 10 0 0 1 0 20"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  swap: svg('<path d="M7 7h11l-3-3M17 17H6l3 3"/>'),
};

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  return h(tag, cls ? { class: cls } : {}, ...children);
}

export function btn(html: string, title: string, onClick: (e: MouseEvent) => void, cls = 'pbtn'): HTMLButtonElement {
  const b = h('button', { class: cls, type: 'button', title, 'aria-label': title });
  b.innerHTML = html;
  b.addEventListener('click', e => onClick(e));
  return b;
}

export const isPhone = (): boolean => window.matchMedia('(max-width: 700px)').matches;

interface Pop {
  el: HTMLElement;
  anchor: HTMLElement | null;
  onClose?: () => void;
}

const stack: Pop[] = [];

export function closePopover(all = false): void {
  do {
    const c = stack.pop();
    if (!c) return;
    c.el.remove();
    c.anchor?.classList.remove('open');
    c.onClose?.();
  } while (all && stack.length);
}

export function popoverOpen(anchor?: HTMLElement): boolean {
  return stack.length > 0 && (!anchor || stack.some(p => p.anchor === anchor));
}

export function popover(anchor: HTMLElement | null, content: HTMLElement, opts: { width?: number; title?: string; onClose?: () => void; sheet?: boolean; stack?: boolean } = {}): HTMLElement {
  if (opts.stack) {
    while (stack.length > 1) closePopover();
  } else {
    const same = stack.length > 0 && stack[0].anchor === anchor && anchor !== null;
    closePopover(true);
    if (same) return content;
  }
  const sheet = opts.sheet || isPhone() || !anchor;
  const box = el('div', `ppop${sheet ? ' sheet' : ''}${opts.stack ? ' child' : ''}`);
  if (opts.title || sheet) {
    const head = el('div', 'ppop-head', el('strong', '', opts.title ?? ''));
    head.append(btn(ic.close, 'Close', () => closePopover(), 'pbtn icon'));
    if (sheet) box.append(el('div', 'grab'));
    box.append(head);
  }
  box.append(content);
  document.body.append(box);
  if (!sheet && anchor) {
    const r = anchor.getBoundingClientRect();
    const w = opts.width ?? 320;
    box.style.width = `${w}px`;
    const parent = opts.stack ? stack[0]?.el.getBoundingClientRect() : null;
    if (parent) {
      const leftSide = parent.left - w - 8 > 8;
      box.style.left = `${leftSide ? parent.left - w - 8 : Math.min(window.innerWidth - w - 8, parent.right + 8)}px`;
      box.style.top = `${Math.max(8, Math.min(r.top, window.innerHeight - 320))}px`;
      box.style.maxHeight = `${window.innerHeight - Math.max(8, Math.min(r.top, window.innerHeight - 320)) - 12}px`;
    } else {
      const left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
      box.style.left = `${left}px`;
      box.style.top = `${r.bottom + 8}px`;
      box.style.maxHeight = `${window.innerHeight - r.bottom - 20}px`;
    }
  }
  anchor?.classList.add('open');
  stack.push({ el: box, anchor, onClose: opts.onClose });
  return content;
}

document.addEventListener('pointerdown', e => {
  const t = e.target as HTMLElement;
  if (t.closest('.pkeep')) return;
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (top.el.contains(t) || top.anchor?.contains(t)) return;
    closePopover();
  }
});

export function slider(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void, fmt: (v: number) => string = v => `${Math.round(v * 100) / 100}`, onCommit?: (v: number) => void): HTMLElement {
  const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  const out = el('span', 'pval', fmt(value));
  input.addEventListener('input', () => {
    out.textContent = fmt(Number(input.value));
    onInput(Number(input.value));
  });
  input.addEventListener('change', () => onCommit?.(Number(input.value)));
  return el('label', 'prow', el('span', 'plabel', label), input, out);
}

export function toggle(label: string, on: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox' });
  input.checked = on;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', 'prow ptoggle', el('span', 'plabel', label), input, el('span', 'pswitch'));
}

export function segmented<T extends string>(options: { id: T; label: string }[], value: T, onChange: (v: T) => void, cls = ''): HTMLElement {
  const wrap = el('div', `pseg ${cls}`);
  for (const o of options) {
    const b = btn(o.label, o.label, () => {
      wrap.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      onChange(o.id);
    }, `pbtn${o.id === value ? ' on' : ''}`);
    wrap.append(b);
  }
  return wrap;
}

export function menuList(items: ({ label: string; hint?: string; icon?: string; on?: boolean; danger?: boolean; action: () => void } | 'sep' | { header: string })[]): HTMLElement {
  const list = el('div', 'pmenu');
  for (const it of items) {
    if (it === 'sep') list.append(el('div', 'psep'));
    else if ('header' in it) list.append(el('div', 'pmenu-h', it.header));
    else {
      const b = btn(`${it.icon ?? ''}<span>${it.label}</span>${it.hint ? `<em>${it.hint}</em>` : ''}${it.on !== undefined ? `<i class="pcheck${it.on ? ' on' : ''}"></i>` : ''}`, it.label, () => it.action(), `pmenu-item${it.danger ? ' danger' : ''}`);
      list.append(b);
    }
  }
  return list;
}

export class VSlider {
  readonly el = el('div', 'pvs');
  private readonly fill = el('div', 'pvs-fill');
  private readonly knob = el('div', 'pvs-knob');
  private readonly bubble = el('div', 'pvs-bubble');
  private t = 0.5;

  constructor(
    title: string,
    private readonly onInput: (t: number) => void,
    private readonly describe: (t: number) => string,
    private readonly onPreview?: (t: number, bubble: HTMLElement) => void,
  ) {
    this.el.title = title;
    this.el.setAttribute('role', 'slider');
    this.el.setAttribute('aria-label', title);
    this.el.append(this.fill, this.knob, this.bubble);
    this.el.addEventListener('pointerdown', e => {
      this.el.setPointerCapture(e.pointerId);
      this.el.classList.add('active');
      this.set(e);
    });
    this.el.addEventListener('pointermove', e => {
      if (this.el.hasPointerCapture(e.pointerId)) this.set(e);
    });
    const end = (): void => this.el.classList.remove('active');
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }

  private set(e: PointerEvent): void {
    const r = this.el.getBoundingClientRect();
    const t = 1 - (e.clientY - r.top) / r.height;
    this.value = Math.min(1, Math.max(0, t));
    this.onInput(this.t);
  }

  get value(): number {
    return this.t;
  }

  set value(t: number) {
    this.t = t;
    this.fill.style.height = `${t * 100}%`;
    this.knob.style.bottom = `calc(${t * 100}% - 7px)`;
    this.bubble.textContent = this.describe(t);
    this.onPreview?.(t, this.bubble);
  }
}

export const hex = (c: [number, number, number]): string => `#${c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;

export const fromHex = (s: string): [number, number, number] | null => {
  const m = s.trim().replace('#', '').match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const v = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1];
  return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number];
};

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hh = 0;
  if (d) hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((hh * 60 + 360) % 360) / 360, max ? d / max : 0, max];
}

export function hsvToRgb(hh: number, s: number, v: number): [number, number, number] {
  const f = (n: number): number => {
    const k = (n + hh * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function shareOrDownload(blob: Blob, name: string): Promise<void> {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  download(blob, name);
}

export function pick(accept: string, capture = false): Promise<File | null> {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept });
    if (capture) input.setAttribute('capture', 'environment');
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.click();
  });
}

export function pickMany(accept: string): Promise<File[]> {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept, multiple: '' });
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    input.click();
  });
}
