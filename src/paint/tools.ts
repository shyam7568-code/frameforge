import { ADJUSTMENTS, GRADIENTS, LIQUIFY_MODES, type AdjustKind } from './adjust';
import type { App } from './app';
import { ctx2d, makeCanvas, type TextProps } from './doc';
import { btn, closePopover, el, hex, ic, menuList, pick, popover, segmented, slider, toggle } from './kit';
import { loadFonts, saveFont } from './store';
import type { View } from './view';
import { toast } from '../util';

export class ToolBars {
  readonly bar = el('div', 'pbar hidden');
  private fonts: string[] = [];

  constructor(
    private readonly app: App,
    private readonly view: View,
  ) {
    app.on(w => {
      if (w === 'tool' || w === 'adjust' || w === 'selection' || w === 'layers' || w === 'autoselect') this.render();
    });
    void loadFonts().then(f => (this.fonts = f));
  }

  render(): void {
    const app = this.app;
    const t = app.tool;
    this.bar.classList.toggle('hidden', !(t === 'select' || t === 'transform' || t === 'adjust'));
    this.bar.classList.toggle('side', t === 'adjust');
    if (t === 'select') this.selectBar();
    else if (t === 'transform') this.transformBar();
    else if (t === 'adjust') this.adjustBar();
  }

  private selectBar(): void {
    const app = this.app;
    const sel = app.selection;
    const tools = segmented(
      [
        { id: 'auto', label: 'Automatic' },
        { id: 'freehand', label: 'Freehand' },
        { id: 'rect', label: 'Rectangle' },
        { id: 'ellipse', label: 'Ellipse' },
      ],
      app.selectTool,
      v => {
        app.selectTool = v;
        this.view.clearPolygon();
      },
    );
    const modes = segmented(
      [
        { id: 'replace', label: 'New' },
        { id: 'add', label: 'Add' },
        { id: 'subtract', label: 'Remove' },
      ],
      app.selectMode,
      v => (app.selectMode = v),
      'small',
    );
    const act = (label: string, title: string, fn: () => void, enabled = true): HTMLButtonElement => {
      const b = btn(label, title, fn, 'pbtn small');
      b.disabled = !enabled;
      return b;
    };
    const has = sel.active;
    const threshold = this.view.autoThreshold;
    this.bar.replaceChildren(
      el('div', 'pbar-row', tools, modes),
      el(
        'div',
        'pbar-row wrap',
        ...(threshold !== null ? [el('span', 'pchip', `Threshold ${Math.round(threshold * 100)}%`)] : []),
        ...(app.selectTool === 'freehand' ? [act('Close shape', 'Close the tapped polygon', () => this.view.closePolygon())] : []),
        act('Select all', 'Select the whole canvas', () => {
          sel.all();
          app.selectionChanged();
        }),
        act('Invert', 'Invert the selection', () => {
          sel.invert();
          app.selectionChanged();
        }, has),
        act('Copy & paste', 'Copy the selection to a new layer', () => {
          const c = app.copy(false);
          if (c) {
            const full = makeCanvas(app.doc.width, app.doc.height);
            ctx2d(full).drawImage(c, 0, 0);
            app.paste(full);
          }
        }, has),
        act('Feather', 'Soften the selection edge', () => {
          const v = prompt('Feather radius in pixels', '12');
          const r = Number(v);
          if (r > 0) {
            sel.feather(r);
            app.selectionChanged();
          }
        }, has),
        act('Save', 'Save this selection to reuse later', () => {
          sel.save();
          toast(`Selection saved (${sel.saved.length})`);
          this.render();
        }, has),
        ...(sel.saved.length
          ? [
              act(`Load (${sel.saved.length})`, 'Load a saved selection', () => {
                const i = sel.saved.length > 1 ? Number(prompt(`Load which selection? 1–${sel.saved.length}`, String(sel.saved.length))) - 1 : 0;
                const s = sel.saved[i];
                if (!s) return;
                sel.restore(s);
                app.selectionChanged();
              }),
            ]
          : []),
        act('Color fill', 'Fill the selection with the current color', () => app.fillLayer(), has),
        act('Clear', 'Remove the selection', () => {
          sel.clear();
          this.view.clearPolygon();
          app.selectionChanged();
        }, has),
        btn(`${ic.check}<span>Done</span>`, 'Finish selecting', () => app.setTool('brush'), 'pbtn small primary'),
      ),
    );
  }

  private transformBar(): void {
    const app = this.app;
    const xf = app.xf;
    if (!xf) {
      this.bar.replaceChildren(
        el('div', 'pbar-row', el('span', 'pchip', 'Text layer: drag to move, corners to scale, green dot to rotate'), toggle('Snapping', app.xfSnap, v => (app.xfSnap = v)), btn(`${ic.check}<span>Done</span>`, 'Finish', () => app.setTool('brush'), 'pbtn small primary')),
      );
      return;
    }
    const modes = segmented(
      [
        { id: 'freeform', label: 'Freeform' },
        { id: 'uniform', label: 'Uniform' },
        { id: 'distort', label: 'Distort' },
        { id: 'warp', label: 'Warp' },
      ],
      xf.mode,
      v => {
        app.xfMode = v;
        if (v === 'warp' && xf.mode !== 'warp') xf.warp = xf.gridFromCorners();
        xf.mode = v;
        app.updateTransform();
      },
    );
    const a = (label: string, title: string, fn: () => void): HTMLButtonElement =>
      btn(label, title, () => {
        fn();
        app.updateTransform();
      }, 'pbtn small');
    this.bar.replaceChildren(
      el('div', 'pbar-row', modes, toggle('Snapping', app.xfSnap, v => (app.xfSnap = v))),
      el(
        'div',
        'pbar-row wrap',
        a('Flip ↔', 'Flip horizontally', () => xf.flip(true)),
        a('Flip ↕', 'Flip vertically', () => xf.flip(false)),
        a('Rotate 45°', 'Rotate 45 degrees', () => xf.rotate(Math.PI / 4)),
        a('Fit to canvas', 'Scale to fit the canvas', () => xf.fit(app.doc.width, app.doc.height)),
        a(xf.smooth ? 'Smooth' : 'Pixel sharp', 'Interpolation', () => {
          xf.smooth = !xf.smooth;
          this.render();
        }),
        a('Reset', 'Undo the changes in this transform', () => {
          xf.corners = [
            { x: xf.src.x, y: xf.src.y },
            { x: xf.src.x + xf.src.w, y: xf.src.y },
            { x: xf.src.x + xf.src.w, y: xf.src.y + xf.src.h },
            { x: xf.src.x, y: xf.src.y + xf.src.h },
          ];
          xf.warp = xf.gridFromCorners();
        }),
        btn('Cancel', 'Cancel the transform', () => {
          app.cancelTransform();
          app.setTool('brush');
        }, 'pbtn small'),
        btn(`${ic.check}<span>Done</span>`, 'Apply the transform', () => app.setTool('brush'), 'pbtn small primary'),
      ),
    );
  }

  private adjustBar(): void {
    const app = this.app;
    const a = app.adjust;
    if (!a) {
      this.bar.classList.add('hidden');
      return;
    }
    const info = ADJUSTMENTS.find(x => x.id === a.kind);
    const rows: HTMLElement[] = [];
    if (a.kind === 'curves') rows.push(curvesEditor(app));
    if (a.kind === 'liquify') {
      rows.push(
        segmented(
          LIQUIFY_MODES.map((m, i) => ({ id: String(i), label: m })),
          String(Math.round(a.values.mode)),
          v => (a.values.mode = Number(v)),
          'small wrap',
        ),
      );
    }
    for (const p of a.params) {
      if (a.kind === 'liquify' && p.key === 'mode') continue;
      if (a.kind === 'gradmap' && p.key === 'preset') {
        const row = el('div', 'pgrads');
        GRADIENTS.forEach((g, i) => {
          const b = btn(g.name, g.name, () => {
            a.values.preset = i;
            app.refreshAdjust();
            row.querySelectorAll('button').forEach((x, k) => x.classList.toggle('on', k === i));
          }, `pbtn small grad${Math.round(a.values.preset) === i ? ' on' : ''}`);
          b.style.background = `linear-gradient(90deg, ${g.stops.map(s => `${s.color} ${s.at * 100}%`).join(',')})`;
          row.append(b);
        });
        rows.push(row);
        continue;
      }
      rows.push(
        slider(p.label, p.min, p.max, p.step, a.values[p.key], v => {
          a.values[p.key] = v;
          this.throttledRefresh();
        }, p.fmt),
      );
    }
    if (a.kind === 'clone') rows.push(el('p', 'phint', 'Touch and hold (or Alt-click) to choose where to copy from, then paint with the current brush.'));
    if (a.kind === 'liquify') rows.push(el('p', 'phint', 'Drag on the canvas to push and pull pixels.'));
    const footer = el('div', 'pbar-row');
    if (info?.pencil) {
      footer.append(
        segmented(
          [
            { id: 'layer', label: 'Layer' },
            { id: 'pencil', label: 'Pencil' },
          ],
          a.mode,
          v => {
            a.mode = v;
            app.refreshAdjust();
            toast(v === 'pencil' ? 'Paint over the areas you want to change' : 'Applied to the whole layer');
          },
          'small',
        ),
      );
    }
    if (a.kind === 'liquify')
      footer.append(
        btn('Reset', 'Undo all liquify changes', () => {
          a.liquify?.reset();
          a.liquify?.render();
          app.recompose();
          app.emit('render');
        }, 'pbtn small'),
      );
    footer.append(el('span', 'grow'), btn('Cancel', 'Cancel', () => app.cancelAdjust(), 'pbtn small'), btn(`${ic.check}<span>Apply</span>`, 'Apply', () => app.applyAdjust(), 'pbtn small primary'));
    this.bar.replaceChildren(el('div', 'pbar-title', info?.label ?? ''), el('div', 'pbar-scroll', ...rows), footer);
  }

  private refreshQueued = false;

  private throttledRefresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    requestAnimationFrame(() => {
      this.refreshQueued = false;
      this.app.refreshAdjust();
    });
  }

  adjustMenu(anchor: HTMLElement): void {
    const app = this.app;
    let group = '';
    const items: Parameters<typeof menuList>[0] = [];
    for (const a of ADJUSTMENTS) {
      if (a.group !== group) {
        group = a.group;
        items.push({ header: group });
      }
      items.push({
        label: a.label,
        action: () => {
          closePopover(true);
          app.startAdjust(a.id as AdjustKind);
        },
      });
    }
    popover(anchor, menuList(items), { width: 260, title: 'Adjustments' });
  }

  textEditor(): void {
    const app = this.app;
    const layer = app.layer;
    if (!layer.text) return;
    const t = layer.text;
    const root = el('div', 'ptext');
    const area = el('textarea', 'pinput');
    area.rows = 3;
    area.value = t.content;
    let typingTimer = 0;
    area.addEventListener('input', () => {
      app.updateText({ content: area.value }, false);
      clearTimeout(typingTimer);
      typingTimer = window.setTimeout(() => app.scheduleSave(), 600);
    });
    area.addEventListener('change', () => {
      const v = area.value;
      app.updateText({ content: t.content }, false);
      app.updateText({ content: v }, true);
    });
    const set = (patch: Partial<TextProps>): void => app.updateText(patch, true);
    const fontSel = el('select', 'pselect');
    const families: [string, string][] = [
      ['System sans', 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'],
      ['Serif', 'Georgia, "Times New Roman", serif'],
      ['Mono', '"SF Mono", Menlo, Consolas, monospace'],
      ['Rounded', '"Arial Rounded MT Bold", "Varela Round", system-ui, sans-serif'],
      ['Handwriting', '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'],
      ['Display', 'Impact, "Arial Black", sans-serif'],
      ['Condensed', '"Arial Narrow", "Roboto Condensed", sans-serif'],
      ['Elegant', '"Didot", "Bodoni 72", "Playfair Display", serif'],
      ...this.fonts.map(f => [f, `"${f}"`] as [string, string]),
    ];
    families.forEach(([n, v]) => fontSel.append(new Option(n, v)));
    fontSel.value = families.find(f => f[1] === t.font)?.[1] ?? families[0][1];
    fontSel.addEventListener('change', () => set({ font: fontSel.value }));
    const importFont = btn(`${ic.import}<span>Import font</span>`, 'Import a .ttf, .otf or .woff font', async () => {
      const f = await pick('.ttf,.otf,.woff,.woff2,font/*');
      if (!f) return;
      const name = f.name.replace(/\.[^.]+$/, '');
      try {
        const face = new FontFace(name, await f.arrayBuffer());
        await face.load();
        document.fonts.add(face);
        await saveFont(name, f);
        this.fonts.push(name);
        set({ font: `"${name}"` });
        closePopover();
        this.textEditor();
        toast(`Font "${name}" added`);
      } catch {
        toast('That font file could not be read.');
      }
    }, 'pbtn small');
    const weight = segmented(
      [
        { id: '300', label: 'Light' },
        { id: '400', label: 'Regular' },
        { id: '600', label: 'Semibold' },
        { id: '800', label: 'Bold' },
      ],
      String(t.weight >= 700 ? 800 : t.weight >= 500 ? 600 : t.weight >= 400 ? 400 : 300),
      v => set({ weight: Number(v) }),
      'small',
    );
    const align = segmented(
      [
        { id: 'left', label: 'Left' },
        { id: 'center', label: 'Center' },
        { id: 'right', label: 'Right' },
      ],
      t.align,
      v => set({ align: v }),
      'small',
    );
    const outlineColor = el('input', 'pcolorin');
    outlineColor.type = 'color';
    outlineColor.value = t.outlineColor;
    outlineColor.addEventListener('change', () => set({ outlineColor: outlineColor.value }));
    root.append(
      area,
      el('label', 'prow', el('span', 'plabel', 'Font'), fontSel),
      importFont,
      slider('Size', 8, Math.max(app.doc.width, app.doc.height) / 2, 1, t.size, v => app.updateText({ size: v }, false), v => `${Math.round(v)} px`, v => (app.updateText({ size: t.size }, false), set({ size: v }))),
      weight,
      el('div', 'prow-btns', toggle('Italic', t.italic, v => set({ italic: v })), toggle('Underline', t.underline, v => set({ underline: v }))),
      align,
      slider('Tracking', -20, 100, 1, t.tracking, v => app.updateText({ tracking: v }, false), v => `${Math.round(v)}`, v => set({ tracking: v })),
      slider('Line height', 0.7, 3, 0.05, t.leading, v => app.updateText({ leading: v }, false), v => v.toFixed(2), v => set({ leading: v })),
      slider('Outline', 0, 40, 1, t.outline, v => app.updateText({ outline: v }, false), v => `${Math.round(v)} px`, v => set({ outline: v })),
      el('label', 'prow', el('span', 'plabel', 'Outline color'), outlineColor),
      el(
        'div',
        'prow-btns',
        btn('Use current color', 'Color the text with the current color', () => set({ color: hex(app.color) }), 'pbtn small'),
        btn('Move / scale', 'Move, scale or rotate the text', () => {
          closePopover();
          app.setTool('transform');
        }, 'pbtn small'),
        btn('Rasterize', 'Turn the text into paintable pixels', () => {
          app.rasterize(layer);
          closePopover();
        }, 'pbtn small'),
      ),
    );
    popover(null, root, { title: 'Edit text', sheet: true });
    setTimeout(() => area.focus(), 50);
  }

  guideEditor(): void {
    const app = this.app;
    const gd = app.doc.guides;
    const root = el('div', 'pguides');
    const changed = (): void => {
      app.emit('guides');
      app.scheduleSave();
    };
    const body = el('div', '');
    const draw = (): void => {
      const rows: HTMLElement[] = [];
      if (gd.type === 'grid' || gd.type === 'isometric') rows.push(slider('Grid size', 8, Math.max(app.doc.width, app.doc.height) / 2, 1, gd.size, v => ((gd.size = v), changed()), v => `${Math.round(v)} px`));
      if (gd.type === 'perspective') {
        rows.push(
          segmented(
            [
              { id: '1', label: '1-point' },
              { id: '2', label: '2-point' },
              { id: '3', label: '3-point' },
            ],
            String(gd.points.length),
            v => {
              const W = app.doc.width;
              const H = app.doc.height;
              const presets = [[{ x: W / 2, y: H * 0.45 }], [{ x: -W * 0.2, y: H * 0.45 }, { x: W * 1.2, y: H * 0.45 }], [{ x: -W * 0.2, y: H * 0.4 }, { x: W * 1.2, y: H * 0.4 }, { x: W / 2, y: H * 1.8 }]];
              gd.points = presets[Number(v) - 1];
              changed();
            },
          ),
          el('p', 'phint', 'Drag the blue dots on the canvas to move the vanishing points.'),
        );
      }
      if (gd.type === 'symmetry') {
        rows.push(
          segmented(
            [
              { id: 'vertical', label: 'Vertical' },
              { id: 'horizontal', label: 'Horizontal' },
              { id: 'quadrant', label: 'Quadrant' },
              { id: 'radial', label: 'Radial' },
            ],
            gd.symmetry,
            v => {
              gd.symmetry = v;
              changed();
              draw();
            },
          ),
          toggle('Rotational symmetry', gd.rotational, v => ((gd.rotational = v), changed())),
          el('p', 'phint', 'Drag the blue dot on the canvas to move the center.'),
        );
        if (gd.symmetry === 'radial') rows.push(slider('Segments', 2, 24, 1, gd.radial, v => ((gd.radial = v), changed()), v => `${v}`));
      }
      if (gd.type !== 'none') {
        const color = el('input', 'pcolorin');
        color.type = 'color';
        color.value = gd.color;
        color.addEventListener('input', () => ((gd.color = color.value), changed()));
        rows.push(
          slider('Rotation', -180, 180, 1, gd.rotation, v => ((gd.rotation = v), changed()), v => `${Math.round(v)}°`),
          slider('Opacity', 0.05, 1, 0.01, gd.opacity, v => ((gd.opacity = v), changed()), v => `${Math.round(v * 100)}%`),
          slider('Thickness', 0.5, 4, 0.5, gd.thickness, v => ((gd.thickness = v), changed()), v => `${v}`),
          el('label', 'prow', el('span', 'plabel', 'Color'), color),
          toggle(`Drawing assist on "${app.layer.name}"`, app.layer.assist, v => app.setLayerProp(app.layer.id, 'assist', v, 'Drawing assist')),
        );
      }
      body.replaceChildren(...rows);
    };
    root.append(
      segmented(
        [
          { id: 'none', label: 'Off' },
          { id: 'grid', label: '2D Grid' },
          { id: 'isometric', label: 'Isometric' },
          { id: 'perspective', label: 'Perspective' },
          { id: 'symmetry', label: 'Symmetry' },
        ],
        gd.type,
        v => {
          gd.type = v;
          if (v === 'symmetry' && !app.layer.assist) app.setLayerProp(app.layer.id, 'assist', true, 'Drawing assist');
          changed();
          draw();
        },
      ),
      body,
    );
    draw();
    app.guideEditing = true;
    app.emit('guides');
    popover(null, root, {
      title: 'Drawing guide',
      sheet: true,
      onClose: () => {
        app.guideEditing = false;
        app.emit('guides');
      },
    });
  }
}

function curvesEditor(app: App): HTMLElement {
  const a = app.adjust;
  const wrap = el('div', 'pcurves');
  if (!a) return wrap;
  let ch: 'm' | 'r' | 'g' | 'b' = 'm';
  const S = 220;
  const c = makeCanvas(S, S);
  c.className = 'pcurve';
  const draw = (): void => {
    const g = ctx2d(c);
    g.fillStyle = '#18181b';
    g.fillRect(0, 0, S, S);
    g.strokeStyle = '#333';
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo((i * S) / 4, 0);
      g.lineTo((i * S) / 4, S);
      g.moveTo(0, (i * S) / 4);
      g.lineTo(S, (i * S) / 4);
      g.stroke();
    }
    const colors = { m: '#fff', r: '#ff5a5a', g: '#4cd964', b: '#4aa3ff' };
    const pts = [...a.curves[ch]].sort((p, q) => p[0] - q[0]);
    g.strokeStyle = colors[ch];
    g.lineWidth = 2;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x * S, (1 - y) * S) : g.moveTo(x * S, (1 - y) * S)));
    g.stroke();
    g.fillStyle = colors[ch];
    pts.forEach(([x, y]) => {
      g.beginPath();
      g.arc(x * S, (1 - y) * S, 5, 0, Math.PI * 2);
      g.fill();
    });
  };
  let dragIdx = -1;
  const pos = (e: PointerEvent): [number, number] => {
    const r = c.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))];
  };
  c.addEventListener('pointerdown', e => {
    c.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    const pts = a.curves[ch];
    dragIdx = pts.findIndex(p => Math.hypot(p[0] - x, p[1] - y) < 0.06);
    if (dragIdx < 0) {
      pts.push([x, y]);
      dragIdx = pts.length - 1;
    }
    draw();
    app.refreshAdjust();
  });
  c.addEventListener('pointermove', e => {
    if (dragIdx < 0 || !c.hasPointerCapture(e.pointerId)) return;
    const pts = a.curves[ch];
    const [x, y] = pos(e);
    const end = dragIdx === 0 || dragIdx === 1 ? (pts[dragIdx][0] === 0 || pts[dragIdx][0] === 1) : false;
    pts[dragIdx] = [end ? pts[dragIdx][0] : x, y];
    draw();
    app.refreshAdjust();
  });
  c.addEventListener('pointerup', e => {
    const pts = a.curves[ch];
    const [x, y] = pos(e);
    const p = pts[dragIdx];
    if (p && p[0] !== 0 && p[0] !== 1 && (y <= 0.001 || y >= 0.999) && (x <= 0.01 || x >= 0.99)) pts.splice(dragIdx, 1);
    dragIdx = -1;
    draw();
    app.refreshAdjust();
  });
  wrap.append(
    segmented(
      [
        { id: 'm', label: 'Gamma' },
        { id: 'r', label: 'Red' },
        { id: 'g', label: 'Green' },
        { id: 'b', label: 'Blue' },
      ],
      ch,
      v => {
        ch = v;
        draw();
      },
      'small',
    ),
    c,
  );
  draw();
  return wrap;
}
