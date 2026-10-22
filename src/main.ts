import './styles.css';
import { ColorPage } from './color';
import { onMasksLoaded } from './cutout';
import { siblingPage, takeInbox } from './inbox';
import { DeliverPage } from './deliver';
import { deleteClips, splitAt } from './edit';
import { Engine } from './engine';
import { ImageEditor } from './imageeditor';
import { Inspector } from './inspector';
import { Mixer } from './mixer';
import { importFiles } from './media';
import { MediaPool } from './mediapool';
import { SoundLibrary } from './soundlib';
import { clearBlobs, parseProject, restore, startAutosave } from './persist';
import { newProject, store } from './state';
import { Timeline } from './timeline';
import type { Page } from './types';
import { button, downloadBlob, h, icons, isTyping, pickFiles, toast } from './util';
import { Viewer } from './viewer';

const app = document.getElementById('app')!;

function fail(message: string): void {
  app.replaceChildren(h('div', { class: 'fatal' }, h('h2', {}, 'Frameforge cannot start'), h('p', {}, message), h('p', {}, 'Use a recent version of Chrome, Edge, Firefox or Safari with hardware acceleration turned on.')));
}

let engine: Engine;
try {
  engine = new Engine();
} catch (e) {
  fail((e as Error).message);
  throw e;
}

const viewer = new Viewer(engine);
const pool = new MediaPool();
const timeline = new Timeline();
const inspector = new Inspector(engine, viewer);
const color = new ColorPage(engine, viewer);
const mixer = new Mixer(engine);
timeline.onToggleMixer = () => timeline.setMixerOpen(mixer.toggle());
engine.onAiStatus = (state, error) => {
  if (state === 'loading') toast('Downloading the AI model…');
  else if (state === 'ready') toast('AI model ready');
  else if (state === 'error') toast(`AI model unavailable: ${error}`);
  store.emit('selection');
};
onMasksLoaded(() => engine.requestRender());
const deliver = new DeliverPage(engine);
const imageEditor = new ImageEditor();
const sounds = new SoundLibrary();
pool.onSounds = () => void sounds.open();

const saveEdited = (file: File): void => {
  void importFiles([file]).then(ids => ids.length && toast(`"${file.name}" added to the Media Pool`));
};

pool.onEditImage = id => {
  const meta = store.media(id);
  const rt = store.runtime.get(id);
  if (meta && rt) void imageEditor.open(rt.blob, meta.name, saveEdited);
};

async function openImageEditor(): Promise<void> {
  const [file] = await pickFiles('image/*', false);
  if (file) await imageEditor.open(file, file.name, saveEdited);
}

const slot = (cls: string): HTMLElement => h('div', { class: `slot ${cls}` });

const media = { root: h('div', { class: 'page page-media' }), pool: slot('slot-pool'), viewer: slot('slot-viewer') };
media.root.append(media.pool, media.viewer);

const edit = { root: h('div', { class: 'page page-edit' }), pool: slot('slot-pool'), viewer: slot('slot-viewer'), inspector: slot('slot-inspector'), timeline: slot('slot-timeline') };
type Pane = 'timeline' | 'pool' | 'inspector';
const paneBtns = {} as Record<Pane, HTMLButtonElement>;
const showPane = (pane: Pane): void => {
  edit.root.dataset.pane = pane;
  (Object.keys(paneBtns) as Pane[]).forEach(p => paneBtns[p].classList.toggle('on', p === pane));
  if (pane === 'timeline') timeline.render();
};
const paneNav = h('nav', { class: 'pane-nav' });
for (const [pane, label] of [['timeline', 'Timeline'], ['pool', 'Media'], ['inspector', 'Inspector']] as [Pane, string][]) {
  paneBtns[pane] = button(label, `Show the ${label.toLowerCase()}`, () => showPane(pane), 'pane-btn');
  paneNav.append(paneBtns[pane]);
}
store.on(c => {
  if (c !== 'selection') return;
  paneBtns.inspector.classList.toggle('has-sel', store.ui.selected.length > 0);
  if (edit.root.dataset.pane === 'pool' && store.ui.selected.length) showPane('timeline');
});
showPane('timeline');
edit.root.append(edit.pool, edit.viewer, paneNav, edit.inspector, edit.timeline);
edit.inspector.append(inspector.root);
edit.timeline.append(timeline.root, mixer.root);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  document.head.append(h('link', { rel: 'manifest', href: 'manifest.webmanifest' }), h('link', { rel: 'apple-touch-icon', href: 'apple-touch-icon.png' }));
  window.addEventListener('load', () => void navigator.serviceWorker.register('sw.js').catch(() => undefined));
}

const pages: Record<Page, HTMLElement> = { media: media.root, edit: edit.root, color: color.root, deliver: deliver.root };
const tabs = {} as Record<Page, HTMLButtonElement>;

function showPage(page: Page): void {
  store.ui.page = page;
  (Object.keys(pages) as Page[]).forEach(p => {
    pages[p].classList.toggle('active', p === page);
    tabs[p].classList.toggle('on', p === page);
  });
  if (page === 'media') {
    media.pool.append(pool.root);
    viewer.mount(media.viewer);
  } else if (page === 'edit') {
    edit.pool.append(pool.root);
    viewer.mount(edit.viewer);
    timeline.render();
  } else if (page === 'color') {
    viewer.mount(color.viewerSlot);
  } else {
    viewer.mount(deliver.viewerSlot);
  }
  color.activate(page === 'color');
  store.emit('ui');
}

const projectName = h('input', { class: 'project-name', type: 'text', title: 'Project name', 'aria-label': 'Project name' });
projectName.addEventListener('change', () => {
  const value = projectName.value.trim() || 'Untitled Project';
  store.checkpoint();
  store.project.name = value;
  store.emit('project');
});

function saveProject(): void {
  const data = JSON.stringify({ app: 'frameforge', savedAt: new Date().toISOString(), project: store.project }, null, 2);
  downloadBlob(new Blob([data], { type: 'application/json' }), `${store.project.name || 'project'}.ffproj`);
}

async function openProject(): Promise<void> {
  const [file] = await pickFiles('.ffproj,.json,application/json', false);
  if (!file) return;
  try {
    engine.pause();
    store.load(parseProject(await file.text()));
    const offline = store.project.media.filter(m => !store.runtime.has(m.id)).length;
    if (offline) alert(`Project opened. ${offline} media file${offline === 1 ? ' is' : 's are'} offline – import ${offline === 1 ? 'it' : 'them'} again with the same file name to relink.`);
  } catch (e) {
    alert((e as Error).message);
  }
}

function newProjectFlow(): void {
  if (!confirm('Start a new project? The current project and its imported media will be cleared from this browser.')) return;
  engine.pause();
  store.runtime.forEach(rt => URL.revokeObjectURL(rt.url));
  store.runtime.clear();
  void clearBlobs();
  store.load(newProject());
}

const menu = h(
  'div',
  { class: 'menu' },
  button('New', 'New project', newProjectFlow, 'btn ghost'),
  button('Open', 'Open a .ffproj project', () => void openProject(), 'btn ghost'),
  button('Save', 'Save project file (Ctrl+S)', saveProject, 'btn ghost'),
  button('Import', 'Import media (Ctrl+I)', () => void pool.import(), 'btn ghost'),
  button('Image Editor', 'Open any image in the image editor', () => void openImageEditor(), 'btn ghost'),
  button('Sounds', 'Built-in sound effects and recordings', () => void sounds.open(), 'btn ghost'),
  button('Paint', 'Open Frameforge Paint, the drawing and painting studio', () => (location.href = siblingPage('paint')), 'btn ghost'),
  h('span', { class: 'sep' }),
  button('Undo', 'Undo (Ctrl+Z)', () => store.undo(), 'btn ghost wide-only'),
  button('Redo', 'Redo (Ctrl+Shift+Z)', () => store.redo(), 'btn ghost wide-only'),
);
const closeMenu = (): void => menu.classList.remove('open');
menu.addEventListener('click', e => {
  if ((e.target as HTMLElement).closest('button')) closeMenu();
});
document.addEventListener('pointerdown', e => {
  if (!(e.target as HTMLElement).closest('.menu, .menu-toggle')) closeMenu();
});

const topbar = h(
  'header',
  { class: 'topbar' },
  h('div', { class: 'brand' }, h('span', { class: 'logo' }), h('span', { class: 'brand-name' }, 'Frameforge')),
  projectName,
  menu,
  h('div', { class: 'status' }, 'Autosaved in this browser'),
  h(
    'div',
    { class: 'quick' },
    button(icons.undo, 'Undo', () => store.undo(), 'icon-btn'),
    button(icons.redo, 'Redo', () => store.redo(), 'icon-btn'),
    button(icons.menu, 'Menu', () => menu.classList.toggle('open'), 'icon-btn menu-toggle'),
  ),
);

const tabBar = h('nav', { class: 'tabs' });
const tabDefs: [Page, string, string][] = [
  ['media', 'Media', 'Import and organise footage'],
  ['edit', 'Edit', 'Cut and arrange the timeline'],
  ['color', 'Color', 'Grade with wheels and scopes'],
  ['deliver', 'Deliver', 'Render the final video'],
];
for (const [page, label, title] of tabDefs) {
  tabs[page] = button(`<span class="tab-icon ${page}"></span><span>${label}</span>`, title, () => showPage(page), 'tab');
  tabBar.append(tabs[page]);
}

app.replaceChildren(topbar, h('main', { class: 'pages' }, ...Object.values(pages)), tabBar);

store.on(c => {
  if (c === 'project' && document.activeElement !== projectName) projectName.value = store.project.name;
});
projectName.value = store.project.name;

window.addEventListener('dragover', e => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', e => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  void importFiles([...e.dataTransfer.files]);
});

window.addEventListener('keydown', e => {
  if (isTyping(e)) return;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  const step = (dt: number): void => store.setPlayhead(store.ui.playhead + dt);
  if (key === ' ') engine.toggle();
  else if (mod && key === 'z') e.shiftKey ? store.redo() : store.undo();
  else if (mod && key === 'y') store.redo();
  else if (mod && key === 's') saveProject();
  else if (mod && key === 'o') void openProject();
  else if (mod && key === 'i') void pool.import();
  else if (mod && key === 'b') splitAt(store.ui.playhead);
  else if (mod && key === 't') timeline.transition();
  else if (!mod && key === 'b') store.setTool('razor');
  else if (!mod && key === 'a') store.setTool('select');
  else if (!mod && key === 'n') {
    store.ui.snapping = !store.ui.snapping;
    store.emit('ui');
  } else if (key === 'delete' || key === 'backspace') deleteClips(store.ui.selected);
  else if (key === 'arrowleft') step(e.shiftKey ? -1 : -store.frame());
  else if (key === 'arrowright') step(e.shiftKey ? 1 : store.frame());
  else if (key === 'home') store.setPlayhead(0);
  else if (key === 'end') store.setPlayhead(store.duration());
  else if (key === '=' || key === '+') timeline.setZoom(store.ui.pps * 1.4);
  else if (key === '-') timeline.setZoom(store.ui.pps / 1.4);
  else if (key === 'escape') store.select([]);
  else return;
  e.preventDefault();
});

showPage('edit');
startAutosave();
const checkInbox = (): void => {
  void takeInbox()
    .then(files => {
      if (!files.length) return;
      void importFiles(files).then(ids => ids.length && toast(`${ids.length} artwork${ids.length > 1 ? 's' : ''} from Paint added to the Media Pool`));
    })
    .catch(() => undefined);
};
void restore().then(checkInbox);
window.addEventListener('focus', checkInbox);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkInbox());
