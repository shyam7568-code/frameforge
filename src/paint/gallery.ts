import { ctx2d, newDoc, newLayer, type Doc } from './doc';
import { imageLayer, readPsd } from './formats';
import { btn, closePopover, el, ic, menuList, pick, pickMany, popover, shareOrDownload } from './kit';
import { PRIMITIVES, parseGltf, parseObj, primitive, type ImportedModel, type Primitive } from './mesh';
import { defaultLighting } from './model3d';
import { deleteDoc, listDocs, loadDoc, packDoc, saveDoc, unpackDoc, type GalleryItem } from './store';
import { siblingPage } from '../inbox';
import { toast, uid } from '../util';

const PRESETS: { name: string; w: number; h: number; dpi: number }[] = [
  { name: 'Screen size', w: 0, h: 0, dpi: 132 },
  { name: 'Square', w: 2048, h: 2048, dpi: 132 },
  { name: '4K', w: 3840, h: 2160, dpi: 132 },
  { name: 'HD landscape', w: 1920, h: 1080, dpi: 72 },
  { name: 'Story / Reel 9:16', w: 1080, h: 1920, dpi: 72 },
  { name: 'Instagram portrait 4:5', w: 1080, h: 1350, dpi: 72 },
  { name: 'A4 (300 DPI)', w: 2480, h: 3508, dpi: 300 },
  { name: 'US Letter (300 DPI)', w: 2550, h: 3300, dpi: 300 },
  { name: 'Comic page', w: 1988, h: 3056, dpi: 300 },
  { name: 'Postcard', w: 1800, h: 1200, dpi: 300 },
  { name: 'Pixel art 64', w: 64, h: 64, dpi: 72 },
  { name: 'Pixel art 256', w: 256, h: 256, dpi: 72 },
];

const textureSize = (): number => (((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) < 4 ? 2048 : 4096);

function modelDoc(model: ImportedModel): Doc {
  const size = model.texture.width;
  const doc = newDoc(model.mesh.name || 'Model', size, size);
  const base = newLayer(doc, 'Base texture');
  ctx2d(base.canvas).drawImage(model.texture, 0, 0);
  doc.layers = [base, ...doc.layers];
  doc.activeId = doc.layers[1].id;
  doc.mesh = model.mesh;
  doc.model = { name: model.mesh.name, light: defaultLighting() };
  return doc;
}

export class Gallery {
  readonly el = el('div', 'pgallery');
  private readonly grid = el('div', 'pgallery-grid');

  constructor(private readonly openDoc: (doc: Doc) => void) {
    const head = el('div', 'pgallery-head', el('div', 'pbrand', el('span', 'plogo'), el('strong', '', 'Frameforge Paint')), el('span', 'grow'));
    head.append(
      btn(`${ic.import}<span>Import</span>`, 'Import an image, PSD or .ffpaint file', () => void this.importFile(), 'pbtn'),
      btn(`${ic.camera}<span>Photo</span>`, 'Start from a photo', () => void this.importFile(true), 'pbtn'),
      btn(`${ic.cube}<span>New 3D</span>`, 'Paint on a 3D model', e => this.new3d(e.currentTarget as HTMLElement), 'pbtn'),
      btn(`${ic.plus}<span>New canvas</span>`, 'Create a new canvas', e => this.newCanvas(e.currentTarget as HTMLElement), 'pbtn primary'),
    );
    const link = el('a', 'pbtn ghost', 'Open Frameforge video editor');
    link.setAttribute('href', siblingPage('editor'));
    this.el.append(head, this.grid, el('div', 'pgallery-foot', link));
  }

  async show(): Promise<void> {
    this.el.classList.remove('hidden');
    const items = await listDocs().catch(() => [] as GalleryItem[]);
    if (!items.length) {
      this.grid.replaceChildren(el('div', 'pempty', el('strong', '', 'No artwork yet'), el('span', '', 'Tap New canvas to start painting, or import an image.')));
      return;
    }
    this.grid.replaceChildren(...items.map(i => this.card(i)));
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  private card(item: GalleryItem): HTMLElement {
    const img = el('img', '');
    if (item.thumb) img.src = URL.createObjectURL(item.thumb);
    img.alt = item.name;
    const card = el('div', 'pcard', el('div', 'pcard-img', img), el('div', 'pcard-meta', el('strong', '', item.name), el('span', '', `${item.width} × ${item.height}`)));
    const more = btn(ic.more, 'Artwork options', e => {
      e.stopPropagation();
      popover(
        more,
        menuList([
          { label: 'Rename', action: () => void this.rename(item) },
          { label: 'Duplicate', action: () => void this.duplicate(item) },
          { label: 'Share as .ffpaint', action: () => void this.share(item) },
          { label: 'Delete', danger: true, action: () => void this.remove(item) },
        ]),
        { width: 220 },
      );
    }, 'pbtn icon small pcard-more');
    card.append(more);
    card.addEventListener('click', async () => {
      const doc = await loadDoc(item.id);
      if (doc) this.openDoc(doc);
      else toast('This artwork could not be opened.');
    });
    return card;
  }

  private async rename(item: GalleryItem): Promise<void> {
    closePopover();
    const n = prompt('Artwork name', item.name);
    if (!n?.trim()) return;
    const doc = await loadDoc(item.id);
    if (!doc) return;
    doc.name = n.trim();
    await this.persist(doc);
    void this.show();
  }

  private async duplicate(item: GalleryItem): Promise<void> {
    closePopover();
    const doc = await loadDoc(item.id);
    if (!doc) return;
    doc.id = uid();
    doc.name = `${doc.name} copy`;
    await this.persist(doc);
    void this.show();
  }

  private async share(item: GalleryItem): Promise<void> {
    closePopover();
    const doc = await loadDoc(item.id);
    if (doc) await shareOrDownload(await packDoc(doc), `${doc.name}.ffpaint`);
  }

  private async remove(item: GalleryItem): Promise<void> {
    closePopover();
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    await deleteDoc(item.id);
    void this.show();
  }

  private async persist(doc: Doc): Promise<void> {
    const thumbCanvas = document.createElement('canvas');
    const s = Math.min(1, 360 / Math.max(doc.width, doc.height));
    thumbCanvas.width = Math.max(1, Math.round(doc.width * s));
    thumbCanvas.height = Math.max(1, Math.round(doc.height * s));
    const { flatten } = await import('./compose');
    ctx2d(thumbCanvas).drawImage(flatten(doc), 0, 0, thumbCanvas.width, thumbCanvas.height);
    await saveDoc(doc, 'all', thumbCanvas);
  }

  newCanvas(anchor: HTMLElement): void {
    const items = PRESETS.map(p => {
      const w = p.w || Math.round(window.screen.width * (window.devicePixelRatio || 1));
      const h = p.h || Math.round(window.screen.height * (window.devicePixelRatio || 1));
      return { label: p.name, hint: `${w} × ${h}`, action: () => this.create(p.name === 'Screen size' ? 'Untitled' : p.name, w, h, p.dpi) };
    });
    popover(
      anchor,
      menuList([
        ...items,
        { header: '3D painting' },
        ...PRIMITIVES.map(pr => ({ label: `3D ${pr}`, hint: 'paint on a 3D shape', action: () => this.create3d(pr) })),
        { label: 'Import 3D model…', hint: 'OBJ, glTF, GLB', action: () => void this.import3d() },
        'sep',
        {
          label: 'Custom size…',
          action: () => {
            const v = prompt('Width × height in pixels (and optional DPI), e.g. 3000 x 2000 300', '3000 x 2000 300');
            const m = v?.match(/(\d+)\s*[x×*, ]\s*(\d+)(?:\s+(\d+))?/i);
            if (!m) return;
            const w = Math.min(16384, Math.max(16, Number(m[1])));
            const h = Math.min(16384, Math.max(16, Number(m[2])));
            this.create('Untitled', w, h, Number(m[3] ?? 132));
          },
        },
      ]),
      { width: 300, title: 'New canvas' },
    );
  }

  private create(name: string, w: number, h: number, dpi: number): void {
    closePopover(true);
    if (w * h > 120e6) {
      toast('That canvas is too large for this device.');
      return;
    }
    this.openDoc(newDoc(name, w, h, dpi));
  }

  new3d(anchor: HTMLElement | null): void {
    popover(
      anchor,
      menuList([
        ...PRIMITIVES.map(pr => ({ label: pr, hint: '3D shape', icon: ic.cube, action: () => this.create3d(pr) })),
        'sep',
        { label: 'Import 3D model…', hint: 'OBJ, glTF, GLB', icon: ic.import, action: () => void this.import3d() },
      ]),
      { width: 300, title: 'New 3D painting' },
    );
  }

  private create3d(kind: Primitive): void {
    closePopover(true);
    const doc = newDoc(`3D ${kind}`, 2048, 2048);
    doc.background = '#e9e6df';
    doc.mesh = primitive(kind);
    doc.model = { name: kind, light: defaultLighting() };
    this.openDoc(doc);
  }

  async import3d(): Promise<void> {
    closePopover(true);
    const files = await pickMany('.obj,.mtl,.glb,.gltf,.bin,image/*');
    if (!files.length) return;
    try {
      toast('Loading the model…');
      const model = files.some(f => /\.(glb|gltf)$/i.test(f.name)) ? await parseGltf(files, textureSize()) : await parseObj(files, textureSize());
      this.openDoc(modelDoc(model));
    } catch (e) {
      toast(`Could not load the model: ${(e as Error).message}`);
    }
  }

  async importFile(photo = false): Promise<void> {
    const f = await pick(photo ? 'image/*' : 'image/*,.psd,.ffpaint,.obj,.glb,.gltf', photo);
    if (!f) return;
    if (/\.(obj|glb|gltf)$/i.test(f.name)) {
      try {
        const model = /\.obj$/i.test(f.name) ? await parseObj([f], textureSize()) : await parseGltf([f], textureSize());
        this.openDoc(modelDoc(model));
      } catch (e) {
        toast(`Could not load the model: ${(e as Error).message}`);
      }
      return;
    }
    try {
      if (/\.ffpaint$/i.test(f.name)) {
        this.openDoc(await unpackDoc(f, uid()));
        return;
      }
      if (/\.psd$/i.test(f.name)) {
        const psd = await readPsd(f);
        const doc = newDoc(f.name.replace(/\.[^.]+$/, ''), psd.width, psd.height);
        doc.layers = psd.layers;
        doc.activeId = psd.layers[psd.layers.length - 1].id;
        this.openDoc(doc);
        if (psd.warning) toast(psd.warning);
        return;
      }
      const bmp = await createImageBitmap(f);
      const doc = newDoc(f.name.replace(/\.[^.]+$/, ''), bmp.width, bmp.height);
      const layer = imageLayer(doc, bmp, 'Image', false);
      doc.layers = [layer, ...doc.layers.map(l => ({ ...l, name: 'Layer 1' }))];
      doc.activeId = doc.layers[1].id;
      bmp.close();
      this.openDoc(doc);
    } catch (e) {
      toast(`Could not import: ${(e as Error).message}`);
    }
  }
}
