export const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

const pad = (n: number): string => String(n).padStart(2, '0');

export function timecode(t: number, fps: number): string {
  const frames = Math.round(Math.max(0, t) * fps);
  const s = Math.floor(frames / fps);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(frames % fps)}`;
}

export function shortDuration(t: number): string {
  if (!Number.isFinite(t)) return '—';
  const s = Math.round(t);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

export function button(label: string, title: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  const b = h('button', { class: cls, type: 'button', title, 'aria-label': title });
  b.innerHTML = label;
  b.addEventListener('click', onClick);
  return b;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable);
}

export function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept });
    input.multiple = multiple;
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    input.click();
  });
}

export const icons = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
  start: '<svg viewBox="0 0 24 24"><path d="M5 4h2v16H5zM20 4.5v15L8.5 12z"/></svg>',
  end: '<svg viewBox="0 0 24 24"><path d="M17 4h2v16h-2zM4 4.5v15L15.5 12z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M18 5v14l-9-7zM6 5h2v14H6z"/></svg>',
  fwd: '<svg viewBox="0 0 24 24"><path d="M6 5v14l9-7zM16 5h2v14h-2z"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 11a4 4 0 110-8 4 4 0 010 8z"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9zM16 8.5a5 5 0 010 7l1.4 1.4a7 7 0 000-9.8z"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><path d="M7 10V7a5 5 0 0110 0v3h1v11H6V10zm2 0h6V7a3 3 0 00-6 0z"/></svg>',
  cursor: '<svg viewBox="0 0 24 24"><path d="M5 3l14 8-6 1.5 4 7-2.5 1.4-4-7L6 18z"/></svg>',
  blade: '<svg viewBox="0 0 24 24"><path d="M4 18l9-9 2 2-9 9H4zM14 8l3-3 2 2-3 3z"/></svg>',
  split: '<svg viewBox="0 0 24 24"><path d="M11 3h2v18h-2zM3 8h6v8H3zM15 8h6v8h-6z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M6 7h12l-1 14H7zM9 3h6l1 2h4v2H4V5h4z"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M4 4h16v4h-2V6h-5v13h3v2H8v-2h3V6H6v2H4z"/></svg>',
  magnet: '<svg viewBox="0 0 24 24"><path d="M5 3h4v8a3 3 0 006 0V3h4v8a7 7 0 01-14 0zm0 0v3h4V3zm10 0v3h4V3z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 4.6L12 10.6l6-6L19.4 6l-6 6 6 6-1.4 1.4-6-6-6 6L4.6 18l6-6-6-6z"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M9 4h6l1.5 2H20a1 1 0 011 1v11a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1h3.5zm3 4a4.5 4.5 0 100 9 4.5 4.5 0 000-9z"/></svg>',
  pencil: '<svg viewBox="0 0 24 24"><path d="M4 17.2V20h2.8l9.6-9.6-2.8-2.8zM18.7 8.1a1 1 0 000-1.4l-1.4-1.4a1 1 0 00-1.4 0l-1.2 1.2 2.8 2.8z"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M18 16a3 3 0 00-2.2 1l-7-3.6a3 3 0 000-1.8l7-3.6A3 3 0 1015 6a3 3 0 00.1.8l-7 3.6a3 3 0 100 4.2l7 3.6A3 3 0 1018 16z"/></svg>',
  rotL: '<svg viewBox="0 0 24 24"><path d="M7.1 8.5L9 10.4H3V4.4l2.6 2.6A9 9 0 1112 21v-2a7 7 0 10-4.9-10.5z"/></svg>',
  rotR: '<svg viewBox="0 0 24 24"><path d="M16.9 8.5L15 10.4h6V4.4l-2.6 2.6A9 9 0 1012 21v-2a7 7 0 114.9-10.5z"/></svg>',
  music: '<svg viewBox="0 0 24 24"><path d="M9 4l11-2v13.5a3 3 0 11-2-2.8V6.4L11 7.7v9.8a3 3 0 11-2-2.8z"/></svg>',
  wand: '<svg viewBox="0 0 24 24"><path d="M3 19.6L14.6 8l1.4 1.4L4.4 21zM17 2l1 2.5L20.5 5.5 18 6.5 17 9l-1-2.5L13.5 5.5 16 4.5zM20 10l.6 1.4 1.4.6-1.4.6L20 14l-.6-1.4L18 12l1.4-.6zM10 2l.6 1.4L12 4l-1.4.6L10 6l-.6-1.4L8 4l1.4-.6z"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M8 7V3L2 9l6 6v-4h7a4 4 0 010 8h-3v2h3a6 6 0 000-12z"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M16 7V3l6 6-6 6v-4H9a4 4 0 000 8h3v2H9A6 6 0 019 9z"/></svg>',
  image: '<svg viewBox="0 0 24 24"><path d="M4 4h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1zm1 12v2h14v-4l-4-4-5 5-2-2zm3-9a2 2 0 100 4 2 2 0 000-4z"/></svg>',
};

let toastEl: HTMLElement | null = null;
let toastTimer = 0;

export function toast(message: string): void {
  toastEl ??= document.body.appendChild(h('div', { class: 'toast', role: 'status' }));
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('show'), 2600);
}
