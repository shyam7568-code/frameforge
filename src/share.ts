import { button, downloadBlob, h, icons } from './util';

const PLATFORMS: { name: string; url: string; color: string }[] = [
  { name: 'YouTube', url: 'https://studio.youtube.com/', color: '#ff3b30' },
  { name: 'Instagram', url: 'https://www.instagram.com/', color: '#d6249f' },
  { name: 'TikTok', url: 'https://www.tiktok.com/upload', color: '#25f4ee' },
  { name: 'Facebook', url: 'https://www.facebook.com/', color: '#1877f2' },
  { name: 'X', url: 'https://x.com/compose/post', color: '#e7e9ea' },
  { name: 'LinkedIn', url: 'https://www.linkedin.com/feed/', color: '#0a66c2' },
  { name: 'WhatsApp', url: 'https://web.whatsapp.com/', color: '#25d366' },
  { name: 'Google Drive', url: 'https://drive.google.com/drive/my-drive', color: '#f4b400' },
];

export async function shareFile(file: File): Promise<void> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  openShareDialog(file);
}

function openShareDialog(file: File): void {
  const overlay = h('div', { class: 'overlay share-overlay' });
  const close = (): void => overlay.remove();
  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });
  const grid = h('div', { class: 'share-grid' });
  for (const p of PLATFORMS) {
    const b = button(`<span class="share-dot" style="background:${p.color}"></span><span>${p.name}</span>`, `Download and open ${p.name}`, () => {
      downloadBlob(file, file.name);
      window.open(p.url, '_blank', 'noopener');
    }, 'share-btn');
    grid.append(b);
  }
  const mail = button('<span class="share-dot" style="background:#8d8d97"></span><span>Email</span>', 'Download and start an email', () => {
    downloadBlob(file, file.name);
    window.location.href = `mailto:?subject=${encodeURIComponent(file.name)}&body=${encodeURIComponent(`I made this with Frameforge. The file "${file.name}" is attached.`)}`;
  }, 'share-btn');
  grid.append(mail);
  overlay.append(
    h(
      'div',
      { class: 'dialog share-dialog' },
      h('div', { class: 'dialog-head' }, h('h3', {}, `Share "${file.name}"`), button(icons.close, 'Close', close, 'icon-btn')),
      h('p', { class: 'hint' }, 'Pick where to post it. The file downloads to your computer and the site opens in a new tab, ready for you to upload it.'),
      grid,
      h('div', { class: 'row-end' }, button('Download only', 'Download the file', () => downloadBlob(file, file.name), 'btn')),
    ),
  );
  document.body.append(overlay);
}
