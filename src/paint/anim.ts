import type { App } from './app';
import { ctx2d, makeCanvas } from './doc';
import { btn, closePopover, el, ic, menuList, popover, segmented, slider, toggle } from './kit';

export class AnimBar {
  readonly el = el('div', 'panim hidden');
  private readonly strip = el('div', 'pframes');
  private readonly playBtn: HTMLButtonElement;
  private timer = 0;
  private dir = 1;
  private holdLeft = 0;

  constructor(private readonly app: App) {
    this.playBtn = btn(ic.play, 'Play', () => this.toggle(), 'pbtn icon');
    const settings = btn('Settings', 'Animation settings', () => this.settings(settings), 'pbtn small');
    const add = btn(`${ic.plus}<span>Frame</span>`, 'Add a frame', () => {
      this.stop();
      const top = app.doc.layers;
      const fg = app.doc.anim.foreground ? top[top.length - 1] : null;
      const anchor = fg ? top[top.length - 2] : top[top.length - 1];
      app.addLayer('paint', anchor?.id);
      app.doc.anim.current = app.frames().length - 1;
      app.recompose();
      app.emit('render');
      this.render();
    }, 'pbtn small');
    this.el.append(el('div', 'panim-ctl', this.playBtn, settings, add), this.strip);
    app.on(w => {
      if (w === 'anim' || w === 'doc') {
        this.el.classList.toggle('hidden', !app.doc.anim.on);
        if (!app.doc.anim.on) this.stop();
        this.render();
      }
      if ((w === 'layers' || w === 'thumbs') && app.doc.anim.on) this.render();
    });
  }

  private settings(anchor: HTMLElement): void {
    const a = this.app.doc.anim;
    const change = (): void => {
      this.app.recompose();
      this.app.emit('render');
      this.app.scheduleSave();
      this.render();
    };
    popover(
      anchor,
      el(
        'div',
        'pform',
        segmented(
          [
            { id: 'loop', label: 'Loop' },
            { id: 'pingpong', label: 'Ping-pong' },
            { id: 'once', label: 'One shot' },
          ],
          a.mode,
          v => ((a.mode = v), change()),
        ),
        slider('Frames per second', 1, 60, 1, a.fps, v => ((a.fps = v), change()), v => `${v}`),
        slider('Onion skin frames', 0, 12, 1, a.onion, v => ((a.onion = v), change()), v => (v ? `${v}` : 'Off')),
        slider('Onion skin opacity', 0.05, 1, 0.01, a.onionOpacity, v => ((a.onionOpacity = v), change()), v => `${Math.round(v * 100)}%`),
        toggle('Color secondary frames', a.colorSecondary, v => ((a.colorSecondary = v), change())),
        toggle('First layer is the background', a.background, v => ((a.background = v), change())),
        toggle('Last layer is the foreground', a.foreground, v => ((a.foreground = v), change())),
      ),
      { width: 300, title: 'Animation settings' },
    );
  }

  render(): void {
    if (!this.app.doc.anim.on) return;
    const frames = this.app.frames();
    const a = this.app.doc.anim;
    a.current = Math.min(a.current, frames.length - 1);
    this.strip.replaceChildren(
      ...frames.map((f, i) => {
        const c = makeCanvas(64, 48);
        const g = ctx2d(c);
        g.fillStyle = '#fff';
        g.fillRect(0, 0, 64, 48);
        const s = Math.min(64 / f.canvas.width, 48 / f.canvas.height);
        if (f.kind !== 'group') g.drawImage(f.canvas, (64 - f.canvas.width * s) / 2, (48 - f.canvas.height * s) / 2, f.canvas.width * s, f.canvas.height * s);
        const b = el('button', `pframe${i === a.current ? ' on' : ''}`, c, el('span', '', `${i + 1}${f.hold ? ` ·${f.hold + 1}` : ''}`));
        b.type = 'button';
        b.addEventListener('click', () => {
          this.stop();
          if (i === a.current) {
            this.frameMenu(b, i);
            return;
          }
          a.current = i;
          this.app.doc.activeId = f.id;
          this.app.recompose();
          this.app.emit('render');
          this.app.emit('layers');
          this.render();
        });
        return b;
      }),
    );
  }

  private frameMenu(anchor: HTMLElement, i: number): void {
    const f = this.app.frames()[i];
    popover(
      anchor,
      el(
        'div',
        '',
        slider('Hold duration (extra frames)', 0, 24, 1, f.hold ?? 0, v => {
          f.hold = v;
          this.app.scheduleSave();
          this.render();
        }, v => `${v}`),
        menuList([
          { label: 'Duplicate frame', action: () => (closePopover(), this.app.duplicateLayer(f.id), this.render()) },
          { label: 'Delete frame', danger: true, action: () => (closePopover(), this.app.deleteLayer(f.id), this.render()) },
        ]),
      ),
      { width: 260, title: `Frame ${i + 1}` },
    );
  }

  toggle(): void {
    if (this.app.playing) this.stop();
    else this.play();
  }

  play(): void {
    const frames = this.app.frames();
    if (frames.length < 2) return;
    this.app.playing = true;
    this.playBtn.innerHTML = ic.pause;
    this.dir = 1;
    this.holdLeft = frames[this.app.doc.anim.current]?.hold ?? 0;
    const step = (): void => {
      const a = this.app.doc.anim;
      const fr = this.app.frames();
      if (!this.app.playing || fr.length < 2) return this.stop();
      if (this.holdLeft > 0) this.holdLeft--;
      else {
        let n = a.current + this.dir;
        if (n >= fr.length || n < 0) {
          if (a.mode === 'loop') n = 0;
          else if (a.mode === 'pingpong') {
            this.dir = -this.dir;
            n = a.current + this.dir;
          } else return this.stop();
        }
        a.current = n;
        this.holdLeft = fr[n].hold ?? 0;
        this.app.recompose();
        this.app.emit('render');
      }
      this.timer = window.setTimeout(step, 1000 / a.fps);
    };
    this.app.recompose();
    this.app.emit('render');
    this.timer = window.setTimeout(step, 1000 / this.app.doc.anim.fps);
  }

  stop(): void {
    clearTimeout(this.timer);
    if (!this.app.playing) return;
    this.app.playing = false;
    this.playBtn.innerHTML = ic.play;
    this.app.recompose();
    this.app.emit('render');
    this.render();
  }
}
