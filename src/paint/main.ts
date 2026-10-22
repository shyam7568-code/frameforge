import '../paint.css';
import { actionsMenu, ReferenceWindow, setClipboard } from './actions';
import { AnimBar } from './anim';
import { App, type Tool } from './app';
import type { Doc } from './doc';
import { Gallery } from './gallery';
import { btn, closePopover, el, hex, ic, VSlider } from './kit';
import { brushPanel, colorPanel, layersPanel } from './panels';
import { ToolBars } from './tools';
import { View } from './view';
import { Model3D, defaultLighting } from './model3d';
import { menuList, popover, slider, toggle } from './kit';
import { toast } from '../util';

const root = document.getElementById('paint') as HTMLElement;

function fatal(msg: string): void {
  root.replaceChildren(el('div', 'pfatal', el('h2', '', 'Frameforge Paint cannot start'), el('p', '', msg)));
}

let app: App;
let view: View;
try {
  app = new App();
  view = new View(app);
} catch (e) {
  fatal((e as Error).message);
  throw e;
}

let model3d: Model3D;
try {
  model3d = new Model3D(app);
} catch (e) {
  fatal((e as Error).message);
  throw e;
}
const bars = new ToolBars(app, view);
const reference = new ReferenceWindow(app);
const anim = new AnimBar(app);
const gallery = new Gallery(openDoc);

const tb = (html: string, title: string, fn: (b: HTMLButtonElement) => void, cls = 'ptb'): HTMLButtonElement => {
  const b = btn(html, title, () => fn(b), cls);
  return b;
};

const toolBtn = (tool: Tool, html: string, title: string): HTMLButtonElement =>
  tb(html, title, b => {
    if (tool === 'brush' || tool === 'smudge' || tool === 'erase') {
      if (app.tool === tool) brushPanel(app, b, tool);
      else {
        closePopover(true);
        app.setTool(tool);
      }
      return;
    }
    closePopover(true);
    app.setTool(app.tool === tool ? 'brush' : tool);
  });

const galleryBtn = tb(`${ic.gallery}<span>Gallery</span>`, 'Gallery', () => void closeDoc(), 'ptb text');
const actionsBtn = tb(ic.actions, 'Actions', b => actionsMenu(app, b, view, bars, reference, () => void closeDoc(), model3d));
const cubeBtn = tb(ic.cube, '3D view / texture view', () => set3d(!app.mode3d), 'ptb hidden');
const adjustBtn = tb(ic.adjust, 'Adjustments', b => {
  if (app.tool === 'adjust') app.applyAdjust();
  else bars.adjustMenu(b);
});
const selectBtn = toolBtn('select', ic.select, 'Selection');
const transformBtn = toolBtn('transform', ic.transform, 'Transform');
const brushBtn = toolBtn('brush', ic.brush, 'Paint (tap again for brushes)');
const smudgeBtn = toolBtn('smudge', ic.smudge, 'Smudge (tap again for brushes)');
const eraseBtn = toolBtn('erase', ic.erase, 'Erase (tap again for brushes)');
const layersBtn = tb(ic.layers, 'Layers', b => layersPanel(app, b));
const colorBtn = el('button', 'ptb pcolorbtn');
colorBtn.type = 'button';
colorBtn.title = 'Colors (drag onto the canvas to fill)';
const docName = el('span', 'pdocname', '');

const topbar = el('header', 'ptop', el('div', 'ptop-l', galleryBtn, actionsBtn, adjustBtn, selectBtn, transformBtn, cubeBtn), docName, el('div', 'ptop-r', brushBtn, smudgeBtn, eraseBtn, layersBtn, colorBtn));

const sizeSlider = new VSlider(
  'Brush size',
  t => {
    const b = app.brush();
    app.setSize(Math.max(1, 1 + (b.maxSize - 1) * t * t));
  },
  t => {
    const b = app.brush();
    return `${Math.round(1 + (b.maxSize - 1) * t * t)} px`;
  },
  (t, bubble) => {
    const b = app.brush();
    const px = Math.max(2, Math.min(120, (1 + (b.maxSize - 1) * t * t) * app.zoom));
    bubble.style.setProperty('--dot', `${px}px`);
  },
);
const opacitySlider = new VSlider('Opacity', t => app.setOpacity(Math.max(0.01, t)), t => `${Math.round(Math.max(0.01, t) * 100)}%`);
const undoBtn = btn(ic.undo, 'Undo', () => app.undo(), 'pbtn icon side');
const redoBtn = btn(ic.redo, 'Redo', () => app.redo(), 'pbtn icon side');
const modifyBtn = btn(ic.dropper, 'Eyedropper (then tap the canvas)', () => {
  if (app.mode3d) model3d.eyedropArmed = true;
  else view.eyedropArmed = true;
  toast('Tap the canvas to pick a color');
}, 'pbtn side modify');
const sidebar = el('aside', 'pside', sizeSlider.el, modifyBtn, opacitySlider.el, undoBtn, redoBtn);

const orbitBtn = btn(ic.orbit, 'One-finger orbit (otherwise one finger paints)', () => {
  model3d.orbitLock = !model3d.orbitLock;
  orbitBtn.classList.toggle('on', model3d.orbitLock);
  toast(model3d.orbitLock ? 'Drag to turn the model. Tap the orbit button again to paint.' : 'Painting on the model');
}, 'pbtn icon');
const lightBtn = btn(ic.sun, 'Lighting', () => lightingPanel(lightBtn), 'pbtn icon');
const bar3d = el(
  'div',
  'p3dbar hidden',
  orbitBtn,
  btn(ic.plus, 'Zoom in', () => model3d.zoom(1.2), 'pbtn icon'),
  btn('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h14"/></svg>', 'Zoom out', () => model3d.zoom(1 / 1.2), 'pbtn icon'),
  btn(ic.reset, 'Reset view', () => model3d.resetView(), 'pbtn icon'),
  lightBtn,
);
const stage = el('div', 'pstage', view.root, model3d.canvas, sidebar, bars.bar, anim.el, reference.el, bar3d);

function lightingPanel(anchor: HTMLElement): void {
  const m = app.doc.model;
  if (!m) return;
  const L = m.light;
  const ch = (): void => {
    app.emit('lighting');
    app.scheduleSave();
  };
  popover(
    anchor,
    el(
      'div',
      'pform',
      slider('Light direction', -180, 180, 1, L.az, v => ((L.az = v), ch()), v => `${Math.round(v)}°`),
      slider('Light height', -10, 90, 1, L.el, v => ((L.el = v), ch()), v => `${Math.round(v)}°`),
      slider('Brightness', 0, 2, 0.01, L.intensity, v => ((L.intensity = v), ch()), v => `${Math.round(v * 100)}%`),
      slider('Ambient light', 0, 1, 0.01, L.ambient, v => ((L.ambient = v), ch()), v => `${Math.round(v * 100)}%`),
      toggle('Show wireframe', L.wire, v => ((L.wire = v), ch())),
      menuList([{ label: 'Reset lighting', action: () => ((m.light = defaultLighting()), ch(), closePopover()) }]),
    ),
    { width: 300, title: 'Lighting' },
  );
}

function set3d(on: boolean): void {
  if (on && !app.doc.mesh) return;
  if (on && ['select', 'transform'].includes(app.tool)) app.setTool('brush');
  app.mode3d = on;
  model3d.show(on);
  bar3d.classList.toggle('hidden', !on);
  cubeBtn.classList.toggle('on', on);
  view.request();
  if (!on) app.emit('render');
}

app.on(w => {
  if (w === 'tool' && app.mode3d && (app.tool === 'select' || app.tool === 'transform' || (app.tool === 'adjust' && app.adjust?.kind === 'liquify'))) {
    set3d(false);
    toast('Showing the texture for this tool. Tap the cube to return to 3D.');
  }
});
const editor = el('div', 'peditor hidden', topbar, stage);
root.replaceChildren(editor, gallery.el);

function syncSliders(): void {
  const b = app.brush();
  sizeSlider.value = Math.sqrt(Math.max(0, (b.size - 1) / Math.max(1, b.maxSize - 1)));
  opacitySlider.value = b.opacity;
  const t = app.tool;
  brushBtn.classList.toggle('on', t === 'brush');
  smudgeBtn.classList.toggle('on', t === 'smudge');
  eraseBtn.classList.toggle('on', t === 'erase');
  selectBtn.classList.toggle('on', t === 'select');
  transformBtn.classList.toggle('on', t === 'transform');
  adjustBtn.classList.toggle('on', t === 'adjust');
  sidebar.classList.toggle('dim', !['brush', 'smudge', 'erase', 'adjust'].includes(t));
}

function syncColor(): void {
  colorBtn.style.background = hex(app.color);
}

function syncPrefs(): void {
  document.body.classList.toggle('plight', app.prefs.light);
  stage.classList.toggle('right', app.prefs.rightHanded);
  view.request();
}

app.on(w => {
  if (w === 'brush' || w === 'tool') syncSliders();
  if (w === 'color') syncColor();
  if (w === 'history') {
    undoBtn.disabled = !app.history.canUndo;
    redoBtn.disabled = !app.history.canRedo;
  }
  if (w === 'prefs') syncPrefs();
  if (w === 'edit-text') bars.textEditor();
  if (w === 'new3d') void closeDoc().then(() => gallery.new3d(null));
  if (w === 'copy') {
    setClipboard(app.copy(false));
    toast('Copied');
  }
  if (w === 'doc' || w === 'doc-name') docName.textContent = app.doc.name;
});
view.onColorPicked = () => syncColor();
model3d.onPicked = () => syncColor();
view.onUiToggle = () => {
  app.uiHidden = !app.uiHidden;
  editor.classList.toggle('ui-hidden', app.uiHidden);
  toast(app.uiHidden ? 'Interface hidden. Four-finger tap to show it again.' : 'Interface shown');
};

let drop: { x: number; y: number; dragging: boolean; dot: HTMLElement } | null = null;
let lastDrop: { x: number; y: number } | null = null;
const thresholdBar = el('div', 'pthreshold hidden');
document.body.append(thresholdBar);
let thresholdTimer = 0;

colorBtn.addEventListener('pointerdown', e => {
  try {
    colorBtn.setPointerCapture(e.pointerId);
  } catch {
    /* pointer already released */
  }
  const dot = el('div', 'pdrop');
  dot.style.background = hex(app.color);
  drop = { x: e.clientX, y: e.clientY, dragging: false, dot };
});
colorBtn.addEventListener('pointermove', e => {
  if (!drop) return;
  if (!drop.dragging && Math.hypot(e.clientX - drop.x, e.clientY - drop.y) > 12) {
    drop.dragging = true;
    document.body.append(drop.dot);
    closePopover(true);
  }
  if (drop.dragging) {
    drop.dot.style.left = `${e.clientX}px`;
    drop.dot.style.top = `${e.clientY}px`;
  }
});
colorBtn.addEventListener('pointerup', e => {
  const d = drop;
  drop = null;
  if (!d) return;
  d.dot.remove();
  if (!d.dragging) {
    colorPanel(app, colorBtn);
    return;
  }
  let p: { x: number; y: number };
  if (app.mode3d) {
    const uv = model3d.pick(e.clientX, e.clientY);
    if (!uv) return;
    p = { x: uv.u * app.doc.width, y: uv.v * app.doc.height };
  } else {
    const r = view.canvas.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    p = view.toDoc(e.clientX - r.left, e.clientY - r.top);
  }
  if (p.x < 0 || p.y < 0 || p.x >= app.doc.width || p.y >= app.doc.height) return;
  lastDrop = p;
  app.colorDrop(p.x, p.y, 0.2, false);
  showThreshold();
});

function showThreshold(): void {
  const input = el('input', '');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.value = '20';
  const label = el('span', '', 'Fill threshold 20%');
  let pending = 0;
  input.addEventListener('input', () => {
    label.textContent = `Fill threshold ${input.value}%`;
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => lastDrop && app.colorDrop(lastDrop.x, lastDrop.y, Number(input.value) / 100, true));
    clearTimeout(thresholdTimer);
    thresholdTimer = window.setTimeout(() => thresholdBar.classList.add('hidden'), 3500);
  });
  thresholdBar.replaceChildren(label, input, btn(ic.check, 'Done', () => thresholdBar.classList.add('hidden'), 'pbtn icon small'));
  thresholdBar.classList.remove('hidden');
  clearTimeout(thresholdTimer);
  thresholdTimer = window.setTimeout(() => thresholdBar.classList.add('hidden'), 3500);
}

function openDoc(doc: Doc): void {
  closePopover(true);
  app.load(doc);
  gallery.hide();
  editor.classList.remove('hidden');
  docName.textContent = doc.name;
  requestAnimationFrame(() => view.fit());
  cubeBtn.classList.toggle('hidden', !doc.mesh);
  model3d.setMesh(doc.mesh ?? null);
  set3d(!!doc.mesh);
  syncSliders();
  syncColor();
  app.dirtyLayers.add('*');
  void app.save();
}

async function closeDoc(): Promise<void> {
  closePopover(true);
  anim.stop();
  app.endSessions(false);
  set3d(false);
  await app.save();
  app.open = false;
  editor.classList.add('hidden');
  await gallery.show();
}

window.addEventListener('keydown', e => {
  if (!app.open) return;
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea, select')) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  const sizeStep = (dir: number): void => {
    const b = app.brush();
    app.setSize(Math.max(1, Math.min(b.maxSize, b.size * (dir > 0 ? 1.15 : 1 / 1.15))));
  };
  let handled = true;
  if (mod && k === 'z') e.shiftKey ? app.redo() : app.undo();
  else if (mod && k === 'y') app.redo();
  else if (mod && k === 'a') {
    app.selection.all();
    app.selectionChanged();
  } else if (mod && k === 'd') {
    app.selection.clear();
    app.selectionChanged();
  } else if (mod && k === 'j') app.duplicateLayer();
  else if (mod && k === 'e') app.mergeDown();
  else if (mod && k === 'c') {
    setClipboard(app.copy(false));
    toast('Copied');
  } else if (mod && k === 'x') setClipboard(app.copy(true));
  else if (mod && k === 's') void app.save().then(() => toast('Saved'));
  else if (mod) handled = false;
  else if (k === 'b') app.setTool('brush');
  else if (k === 's') app.setTool('smudge');
  else if (k === 'e') app.setTool('erase');
  else if (k === 'v') app.setTool('transform');
  else if (k === 'l') layersPanel(app, layersBtn);
  else if (k === 'c') colorPanel(app, colorBtn);
  else if (k === '[' && e.shiftKey) app.setOpacity(Math.max(0.01, app.brush().opacity - 0.1));
  else if (k === ']' && e.shiftKey) app.setOpacity(Math.min(1, app.brush().opacity + 0.1));
  else if (k === '[' || k === '{') sizeStep(-1);
  else if (k === ']' || k === '}') sizeStep(1);
  else if (k === '0') app.mode3d ? model3d.resetView() : view.fit();
  else if (k === '1') view.actualSize();
  else if (k === '=' || k === '+') view.zoomBy(1.25);
  else if (k === '-') view.zoomBy(0.8);
  else if (k === 'enter' && app.tool === 'transform') app.setTool('brush');
  else if (k === 'escape') {
    if (app.tool === 'transform') {
      app.cancelTransform();
      app.setTool('brush');
    } else if (app.tool === 'adjust') app.cancelAdjust();
    else closePopover(true);
  } else if (k === 'delete' || k === 'backspace') app.clearLayer();
  else if (k === 'tab') view.onUiToggle();
  else handled = false;
  if (handled) e.preventDefault();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void app.save();
});
window.addEventListener('pagehide', () => void app.save());

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  const m = document.createElement('link');
  m.rel = 'manifest';
  m.href = 'paint.webmanifest';
  const icon = document.createElement('link');
  icon.rel = 'apple-touch-icon';
  icon.href = 'apple-touch-icon.png';
  document.head.append(m, icon);
  window.addEventListener('load', () => void navigator.serviceWorker.register('sw.js').catch(() => undefined));
}

syncPrefs();
syncColor();
void gallery.show();
