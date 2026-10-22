import type { Engine } from './engine';
import { store } from './state';
import { canvasSelect } from './formats';
import { importFiles } from './media';
import { button, h, icons, timecode, toast } from './util';

export class Viewer {
  readonly root = h('div', { class: 'panel viewer' });
  private readonly tc = h('span', { class: 'tc' });
  private readonly total = h('span', { class: 'tc dim' });
  private readonly playBtn: HTMLButtonElement;
  readonly stage = h('div', { class: 'stage' });

  constructor(private readonly engine: Engine) {
    const step = (dir: number) => () => store.setPlayhead(store.ui.playhead + dir * store.frame());
    this.playBtn = button(icons.play, 'Play / Pause (Space)', () => engine.toggle(), 'icon-btn play');
    const transport = h(
      'div',
      { class: 'transport' },
      h('div', { class: 'tc-box' }, this.tc),
      h(
        'div',
        { class: 'transport-btns' },
        button(icons.start, 'Go to start (Home)', () => store.setPlayhead(0), 'icon-btn'),
        button(icons.back, 'Previous frame (←)', step(-1), 'icon-btn'),
        this.playBtn,
        button(icons.fwd, 'Next frame (→)', step(1), 'icon-btn'),
        button(icons.end, 'Go to end (End)', () => store.setPlayhead(store.duration()), 'icon-btn'),
      ),
      h('div', { class: 'tc-box right' }, this.total),
    );
    const snapshot = button(`${icons.camera}<span>Snapshot</span>`, 'Save the current frame as an image in the Media Pool', () => void this.snapshot(), 'btn small');
    const canvas = canvasSelect('select small canvas-select');
    this.root.append(h('div', { class: 'panel-head' }, h('span', {}, 'Timeline Viewer'), h('div', { class: 'head-tools' }, canvas, snapshot)), this.stage, transport);
    this.stage.append(engine.canvas);
    store.on(c => {
      if (c === 'playhead' || c === 'project') this.updateTimecode();
      if (c === 'ui') this.playBtn.innerHTML = store.ui.playing ? icons.pause : icons.play;
    });
    this.updateTimecode();
  }

  mount(slot: HTMLElement): void {
    slot.append(this.root);
    this.engine.requestRender();
  }

  setOverlay(el: HTMLElement | null): void {
    this.stage.querySelector('.stage-overlay')?.remove();
    if (el) {
      el.classList.add('stage-overlay');
      this.stage.append(el);
    }
  }

  contentRect(): DOMRect {
    const c = this.engine.canvas.getBoundingClientRect();
    const aspect = this.engine.canvas.width / this.engine.canvas.height;
    const w = Math.min(c.width, c.height * aspect);
    const hgt = w / aspect;
    return new DOMRect(c.left + (c.width - w) / 2, c.top + (c.height - hgt) / 2, w, hgt);
  }

  private async snapshot(): Promise<void> {
    if (store.duration() <= 0) {
      toast('Add clips to the timeline first.');
      return;
    }
    const blob = await this.engine.snapshot();
    const stamp = timecode(store.ui.playhead, store.project.fps).replace(/:/g, '-');
    await importFiles([new File([blob], `Snapshot ${stamp}.png`, { type: 'image/png' })]);
    toast('Snapshot added to the Media Pool');
  }

  private updateTimecode(): void {
    const fps = store.project.fps;
    this.tc.textContent = timecode(store.ui.playhead, fps);
    this.total.textContent = timecode(store.duration(), fps);
  }
}
