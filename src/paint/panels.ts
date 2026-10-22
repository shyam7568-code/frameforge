import type { App } from './app';
import { BLENDS, ctx2d, makeCanvas, type Blend, type Layer } from './doc';
import { BRUSH_CATEGORIES, GRAINS, TIPS, previewBrush, saveCustomBrushes, tipCanvas, type Brush } from './brushes';
import { btn, closePopover, el, fromHex, hex, hsvToRgb, ic, menuList, pick, popover, rgbToHsv, segmented, slider, toggle } from './kit';
import { toast, uid } from '../util';


export function brushPanel(app: App, anchor: HTMLElement, tool: 'brush' | 'smudge' | 'erase'): void {
  const root = el('div', 'pbrushes');
  const cats = el('div', 'pcats');
  const list = el('div', 'plist');
  const custom = (): Brush[] => app.brushes.filter(b => b.custom);
  const allCats = (): string[] => [...BRUSH_CATEGORIES, ...(custom().length ? ['My Brushes'] : [])];
  const current = app.brushes.find(b => b.id === app.toolBrush[tool]);
  let cat = current ? (current.custom ? 'My Brushes' : current.cat) : BRUSH_CATEGORIES[0];
  const renderCats = (): void => {
    cats.replaceChildren(
      ...allCats().map(c =>
        btn(c, c, () => {
          cat = c;
          renderCats();
          renderList();
        }, `pcat${c === cat ? ' on' : ''}`),
      ),
    );
  };
  const renderList = (): void => {
    const items = app.brushes.filter(b => (cat === 'My Brushes' ? b.custom : b.cat === cat && !b.custom));
    list.replaceChildren(
      ...items.map(b => {
        const row = el('button', `pbrush${app.toolBrush[tool] === b.id ? ' on' : ''}`);
        row.type = 'button';
        const prev = previewBrush(b, 220, 46, app.prefs.light ? '#222' : '#eee');
        row.append(el('span', 'pbrush-name', b.name), prev);
        row.addEventListener('click', () => {
          if (app.toolBrush[tool] === b.id) {
            closePopover();
            brushStudio(app, b, tool);
            return;
          }
          app.toolBrush[tool] = b.id;
          app.emit('brush');
          renderList();
        });
        return row;
      }),
    );
  };
  const actions = el(
    'div',
    'prow-btns',
    btn(`${ic.plus}<span>New</span>`, 'Create a new brush from the current one', () => {
      const base = app.brush(tool);
      const b: Brush = { ...base, id: `custom-${uid()}`, name: `${base.name} copy`, cat: 'My Brushes', custom: true };
      app.brushes.push(b);
      saveCustomBrushes(custom());
      app.toolBrush[tool] = b.id;
      closePopover();
      brushStudio(app, b, tool);
    }, 'pbtn small'),
    btn(`${ic.import}<span>Import</span>`, 'Import a .ffbrush file', async () => {
      const f = await pick('.ffbrush,application/json');
      if (!f) return;
      try {
        const data = JSON.parse(await f.text()) as Brush | Brush[];
        const arr = Array.isArray(data) ? data : [data];
        for (const b of arr) app.brushes.push({ ...b, id: `custom-${uid()}`, custom: true, cat: 'My Brushes' });
        saveCustomBrushes(custom());
        cat = 'My Brushes';
        renderCats();
        renderList();
        toast(`Imported ${arr.length} brush${arr.length > 1 ? 'es' : ''}`);
      } catch {
        toast('That file is not a brush.');
      }
    }, 'pbtn small'),
  );
  root.append(el('div', 'pbrushes-body', cats, list), actions);
  renderCats();
  renderList();
  popover(anchor, root, { width: 470, title: `${tool === 'brush' ? 'Brush' : tool === 'smudge' ? 'Smudge' : 'Eraser'} Library` });
  list.querySelector('.on')?.scrollIntoView({ block: 'center' });
}

export function brushStudio(app: App, original: Brush, tool: 'brush' | 'smudge' | 'erase'): void {
  let b: Brush = { ...original };
  const root = el('div', 'pstudio');
  const preview = el('div', 'pstudio-preview');
  const drawPreview = (): void => {
    preview.replaceChildren(previewBrush({ ...b, size: Math.min(40, b.size) }, 420, 90, app.prefs.light ? '#222' : '#eee'));
  };
  const ensureCustom = (): void => {
    if (b.custom) return;
    b = { ...b, id: `custom-${uid()}`, name: `${b.name} (edited)`, cat: 'My Brushes', custom: true };
    app.brushes.push(b);
    app.toolBrush[tool] = b.id;
    toast('Editing a copy in My Brushes');
  };
  const set = <K extends keyof Brush>(k: K, v: Brush[K]): void => {
    ensureCustom();
    b[k] = v;
    const i = app.brushes.findIndex(x => x.id === b.id);
    if (i >= 0) app.brushes[i] = { ...b };
    saveCustomBrushes(app.brushes.filter(x => x.custom));
    app.emit('brush');
    drawPreview();
  };
  const num = (label: string, k: keyof Brush, min: number, max: number, step = 0.01, fmt?: (v: number) => string): HTMLElement =>
    slider(label, min, max, step, b[k] as number, v => set(k, v as never), fmt ?? (v => (max <= 1 ? `${Math.round(v * 100)}%` : `${Math.round(v * 10) / 10}`)));
  const tips = el('div', 'ptips');
  const drawTips = (): void => {
    tips.replaceChildren(
      ...TIPS.map(t => {
        const c = makeCanvas(44, 44);
        const g = ctx2d(c);
        g.drawImage(tipCanvas(t, b.hardness), 2, 2, 40, 40);
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = app.prefs.light ? '#222' : '#eee';
        g.fillRect(0, 0, 44, 44);
        const bt = el('button', `ptip${t === b.tip ? ' on' : ''}`, c);
        bt.type = 'button';
        bt.title = t;
        bt.addEventListener('click', () => {
          set('tip', t);
          drawTips();
        });
        return bt;
      }),
    );
  };
  drawTips();
  const grain = el('select', 'pselect');
  GRAINS.forEach(g => grain.append(new Option(g === 'none' ? 'No grain' : g[0].toUpperCase() + g.slice(1), g)));
  grain.value = b.grain;
  grain.addEventListener('change', () => set('grain', grain.value as Brush['grain']));
  const name = el('input', 'pinput');
  name.value = b.name;
  name.addEventListener('change', () => set('name', name.value.trim() || b.name));
  const sec = (title: string, ...rows: HTMLElement[]): HTMLElement => el('section', 'psec', el('h4', '', title), ...rows);
  root.append(
    preview,
    el(
      'div',
      'pstudio-body',
      sec('Properties', el('label', 'prow', el('span', 'plabel', 'Name'), name), num('Size (px)', 'size', 1, 600, 1, v => `${Math.round(v)}`), num('Opacity', 'opacity', 0.01, 1), num('Minimum size', 'minSize', 0, 1)),
      sec('Stroke path', num('Spacing', 'spacing', 0.02, 2), num('Scatter', 'scatter', 0, 3), num('Count', 'count', 1, 8, 1, v => `${v}`), num('Streamline', 'smoothing', 0, 1), num('Flow', 'flow', 0.02, 1)),
      sec('Taper', num('Start taper', 'taperStart', 0, 1), num('End taper', 'taperEnd', 0, 1)),
      sec('Shape', tips, num('Hardness', 'hardness', 0, 1), num('Roundness', 'roundness', 0.05, 1), num('Angle', 'angle', -180, 180, 1, v => `${Math.round(v)}°`), toggle('Follow stroke direction', b.follow, v => set('follow', v)), num('Angle jitter', 'angleJitter', 0, 1)),
      sec('Grain', el('label', 'prow', el('span', 'plabel', 'Texture'), grain), num('Depth', 'grainDepth', 0, 1), num('Scale', 'grainScale', 0.2, 4)),
      sec('Rendering', num('Wet mix', 'wet', 0, 1), toggle('Glow (adds light)', b.glow, v => set('glow', v))),
      sec('Color dynamics', num('Hue jitter', 'hueJitter', 0, 0.5), num('Saturation jitter', 'satJitter', 0, 1), num('Brightness jitter', 'briJitter', 0, 1)),
      sec('Dynamics', num('Size jitter', 'sizeJitter', 0, 1), num('Opacity jitter', 'opacityJitter', 0, 1)),
      sec('Pencil & stylus', num('Size by pressure', 'sizePressure', 0, 1), num('Opacity by pressure', 'opacityPressure', 0, 1), num('Size by tilt', 'tiltSize', 0, 2), num('Opacity by tilt', 'tiltOpacity', 0, 1)),
      el(
        'div',
        'prow-btns',
        btn('Export brush', 'Download this brush as a .ffbrush file', () => {
          const blob = new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${b.name.replace(/[^\w -]+/g, '')}.ffbrush`;
          a.click();
        }, 'pbtn small'),
        btn('Duplicate', 'Duplicate this brush', () => {
          const copy = { ...b, id: `custom-${uid()}`, name: `${b.name} copy`, custom: true, cat: 'My Brushes' };
          app.brushes.push(copy);
          saveCustomBrushes(app.brushes.filter(x => x.custom));
          toast('Duplicated into My Brushes');
        }, 'pbtn small'),
        ...(original.custom
          ? [
              btn('Delete', 'Delete this brush', () => {
                if (!confirm(`Delete "${b.name}"?`)) return;
                app.brushes = app.brushes.filter(x => x.id !== b.id);
                saveCustomBrushes(app.brushes.filter(x => x.custom));
                app.toolBrush[tool] = app.brushes[0].id;
                app.emit('brush');
                closePopover();
              }, 'pbtn small danger'),
            ]
          : []),
      ),
    ),
  );
  drawPreview();
  popover(null, root, { title: 'Brush Studio', sheet: true });
}

export function colorPanel(app: App, anchor: HTMLElement): void {
  const root = el('div', 'pcolor');
  let [hh, ss, vv] = rgbToHsv(...app.color);
  const mode = { v: (localStorage.getItem('frameforge-paint:colormode') as 'disc' | 'classic' | 'harmony' | 'value' | 'palettes') || 'disc' };
  const body = el('div', 'pcolor-body');
  const swatches = el('div', 'precent');
  const top = el('div', 'pcolor-top');
  const primary = el('button', 'pswatch big');
  const secondary = el('button', 'pswatch');
  primary.type = secondary.type = 'button';
  primary.title = 'Current color';
  secondary.title = 'Secondary color (tap to swap)';
  secondary.addEventListener('click', () => {
    const c = app.color;
    app.setColor(app.secondary);
    app.secondary = c;
    [hh, ss, vv] = rgbToHsv(...app.color);
    render();
  });
  top.append(primary, secondary);
  const commit = (): void => {
    app.setColor(hsvToRgb(hh, ss, vv));
    primary.style.background = hex(app.color);
    secondary.style.background = hex(app.secondary);
    drawers.forEach(fn => fn());
  };
  const drawers: (() => void)[] = [];
  const dragArea = (c: HTMLCanvasElement, onPick: (x: number, y: number) => void): void => {
    const go = (e: PointerEvent): void => {
      const r = c.getBoundingClientRect();
      onPick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      commit();
    };
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      go(e);
    });
    c.addEventListener('pointermove', e => c.hasPointerCapture(e.pointerId) && go(e));
    c.addEventListener('pointerup', () => app.pushRecent());
  };
  const svSquare = (size: number): HTMLCanvasElement => {
    const c = makeCanvas(size, size);
    c.className = 'pcolor-sv';
    const draw = (): void => {
      const g = ctx2d(c);
      g.fillStyle = `hsl(${hh * 360},100%,50%)`;
      g.fillRect(0, 0, size, size);
      const wg = g.createLinearGradient(0, 0, size, 0);
      wg.addColorStop(0, '#fff');
      wg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = wg;
      g.fillRect(0, 0, size, size);
      const bg = g.createLinearGradient(0, 0, 0, size);
      bg.addColorStop(0, 'rgba(0,0,0,0)');
      bg.addColorStop(1, '#000');
      g.fillStyle = bg;
      g.fillRect(0, 0, size, size);
      g.strokeStyle = vv > 0.5 ? '#000' : '#fff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(ss * size, (1 - vv) * size, 8, 0, Math.PI * 2);
      g.stroke();
    };
    drawers.push(draw);
    draw();
    dragArea(c, (x, y) => {
      ss = Math.min(1, Math.max(0, x));
      vv = Math.min(1, Math.max(0, 1 - y));
    });
    return c;
  };
  const hueBar = (): HTMLCanvasElement => {
    const c = makeCanvas(300, 22);
    c.className = 'pcolor-hue';
    const draw = (): void => {
      const g = ctx2d(c);
      const gr = g.createLinearGradient(0, 0, 300, 0);
      for (let i = 0; i <= 6; i++) gr.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
      g.fillStyle = gr;
      g.fillRect(0, 0, 300, 22);
      g.strokeStyle = '#fff';
      g.lineWidth = 3;
      g.strokeRect(hh * 300 - 3, 1, 6, 20);
    };
    drawers.push(draw);
    draw();
    dragArea(c, x => (hh = Math.min(0.9999, Math.max(0, x))));
    return c;
  };
  const disc = (): HTMLElement => {
    const S = 280;
    const c = makeCanvas(S, S);
    c.className = 'pcolor-disc';
    const ring = 26;
    const inner = (S / 2 - ring - 6) * Math.SQRT1_2;
    const draw = (): void => {
      const g = ctx2d(c);
      g.clearRect(0, 0, S, S);
      for (let a = 0; a < 360; a++) {
        g.beginPath();
        g.strokeStyle = `hsl(${a},100%,50%)`;
        g.lineWidth = ring;
        g.arc(S / 2, S / 2, S / 2 - ring / 2, ((a - 90.6) * Math.PI) / 180, ((a - 89) * Math.PI) / 180);
        g.stroke();
      }
      const x0 = S / 2 - inner;
      const sz = inner * 2;
      g.fillStyle = `hsl(${hh * 360},100%,50%)`;
      g.fillRect(x0, x0, sz, sz);
      const wg = g.createLinearGradient(x0, 0, x0 + sz, 0);
      wg.addColorStop(0, '#fff');
      wg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = wg;
      g.fillRect(x0, x0, sz, sz);
      const bg = g.createLinearGradient(0, x0, 0, x0 + sz);
      bg.addColorStop(0, 'rgba(0,0,0,0)');
      bg.addColorStop(1, '#000');
      g.fillStyle = bg;
      g.fillRect(x0, x0, sz, sz);
      const ha = hh * Math.PI * 2 - Math.PI / 2;
      g.lineWidth = 3;
      g.strokeStyle = '#fff';
      g.beginPath();
      g.arc(S / 2 + Math.cos(ha) * (S / 2 - ring / 2), S / 2 + Math.sin(ha) * (S / 2 - ring / 2), ring / 2 - 2, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = vv > 0.5 ? '#000' : '#fff';
      g.beginPath();
      g.arc(x0 + ss * sz, x0 + (1 - vv) * sz, 8, 0, Math.PI * 2);
      g.stroke();
    };
    drawers.push(draw);
    draw();
    let target: 'ring' | 'square' | null = null;
    const go = (e: PointerEvent): void => {
      const r = c.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * S;
      const y = ((e.clientY - r.top) / r.height) * S;
      const d = Math.hypot(x - S / 2, y - S / 2);
      if (!target) target = d > S / 2 - ring - 4 ? 'ring' : 'square';
      if (target === 'ring') hh = ((Math.atan2(y - S / 2, x - S / 2) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
      else {
        ss = Math.min(1, Math.max(0, (x - (S / 2 - inner)) / (inner * 2)));
        vv = Math.min(1, Math.max(0, 1 - (y - (S / 2 - inner)) / (inner * 2)));
      }
      commit();
    };
    c.addEventListener('pointerdown', e => {
      target = null;
      c.setPointerCapture(e.pointerId);
      go(e);
    });
    c.addEventListener('pointermove', e => c.hasPointerCapture(e.pointerId) && go(e));
    c.addEventListener('pointerup', () => app.pushRecent());
    return el('div', 'pcenter', c);
  };
  const harmony = (): HTMLElement => {
    const S = 260;
    const c = makeCanvas(S, S);
    c.className = 'pcolor-disc';
    const kind = { v: localStorage.getItem('frameforge-paint:harmony') ?? 'complementary' };
    const offsets: Record<string, number[]> = {
      complementary: [0.5],
      'split complementary': [0.42, 0.58],
      analogous: [-1 / 12, 1 / 12],
      triadic: [1 / 3, 2 / 3],
      tetradic: [0.25, 0.5, 0.75],
    };
    const chips = el('div', 'pharmony');
    const draw = (): void => {
      const g = ctx2d(c);
      const img = g.createImageData(S, S);
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const dx = x - S / 2;
          const dy = y - S / 2;
          const d = Math.hypot(dx, dy) / (S / 2);
          if (d > 1) continue;
          const rgb = hsvToRgb(((Math.atan2(dy, dx) / (Math.PI * 2)) + 1.25) % 1, d, vv);
          const i = (y * S + x) * 4;
          img.data[i] = rgb[0] * 255;
          img.data[i + 1] = rgb[1] * 255;
          img.data[i + 2] = rgb[2] * 255;
          img.data[i + 3] = 255;
        }
      g.putImageData(img, 0, 0);
      const mark = (hue: number, main: boolean): void => {
        const a = hue * Math.PI * 2 - Math.PI / 2;
        g.beginPath();
        g.arc(S / 2 + Math.cos(a) * ss * (S / 2), S / 2 + Math.sin(a) * ss * (S / 2), main ? 10 : 7, 0, Math.PI * 2);
        g.lineWidth = main ? 3 : 2;
        g.strokeStyle = '#fff';
        g.stroke();
      };
      mark(hh, true);
      chips.replaceChildren(
        ...[0, ...offsets[kind.v]].map(o => {
          const rgb = hsvToRgb((hh + o + 1) % 1, ss, vv);
          if (o) mark((hh + o + 1) % 1, false);
          const b = el('button', 'pswatch');
          b.type = 'button';
          b.style.background = hex(rgb);
          b.addEventListener('click', () => {
            [hh, ss, vv] = rgbToHsv(...rgb);
            commit();
          });
          return b;
        }),
      );
    };
    drawers.push(draw);
    draw();
    dragArea(c, (x, y) => {
      const dx = x - 0.5;
      const dy = y - 0.5;
      hh = ((Math.atan2(dy, dx) / (Math.PI * 2)) + 1.25) % 1;
      ss = Math.min(1, Math.hypot(dx, dy) * 2);
    });
    const sel = el('select', 'pselect');
    Object.keys(offsets).forEach(k => sel.append(new Option(k[0].toUpperCase() + k.slice(1), k)));
    sel.value = kind.v;
    sel.addEventListener('change', () => {
      kind.v = sel.value;
      localStorage.setItem('frameforge-paint:harmony', sel.value);
      draw();
    });
    const bright = slider('Brightness', 0, 1, 0.01, vv, v => {
      vv = v;
      commit();
    }, v => `${Math.round(v * 100)}%`);
    return el('div', 'pcenter', sel, c, bright, chips);
  };
  const values = (): HTMLElement => {
    const wrap = el('div', '');
    const hexIn = el('input', 'pinput');
    const rows = el('div', '');
    const build = (): void => {
      const rgb = hsvToRgb(hh, ss, vv);
      hexIn.value = hex(rgb).toUpperCase();
      rows.replaceChildren(
        slider('Hue', 0, 360, 1, Math.round(hh * 360), v => ((hh = v / 360), commit()), v => `${Math.round(v)}°`),
        slider('Saturation', 0, 100, 1, Math.round(ss * 100), v => ((ss = v / 100), commit()), v => `${Math.round(v)}%`),
        slider('Brightness', 0, 100, 1, Math.round(vv * 100), v => ((vv = v / 100), commit()), v => `${Math.round(v)}%`),
        ...(['Red', 'Green', 'Blue'] as const).map((n, i) =>
          slider(n, 0, 255, 1, Math.round(rgb[i] * 255), v => {
            const c = hsvToRgb(hh, ss, vv);
            c[i] = v / 255;
            [hh, ss, vv] = rgbToHsv(...c);
            commit();
          }),
        ),
      );
    };
    hexIn.addEventListener('change', () => {
      const c = fromHex(hexIn.value);
      if (!c) return;
      [hh, ss, vv] = rgbToHsv(...c);
      commit();
      build();
    });
    build();
    wrap.append(el('label', 'prow', el('span', 'plabel', 'Hex'), hexIn), rows);
    return wrap;
  };
  const palettes = (): HTMLElement => {
    const wrap = el('div', 'ppalettes');
    const draw = (): void => {
      const pals = loadPalettes();
      wrap.replaceChildren(
        ...pals.map((p, pi) => {
          const grid = el('div', 'pgrid');
          p.colors.forEach((c, ci) => {
            const b = el('button', 'pswatch');
            b.type = 'button';
            b.style.background = c;
            b.title = `${c} (hold to remove)`;
            let timer = 0;
            b.addEventListener('pointerdown', () => {
              timer = window.setTimeout(() => {
                if (!confirm('Remove this swatch?')) return;
                p.colors.splice(ci, 1);
                savePalettes(pals);
                draw();
                timer = -1;
              }, 600);
            });
            b.addEventListener('pointerup', () => {
              clearTimeout(timer);
              if (timer === -1) return;
              const rgb = fromHex(c);
              if (rgb) {
                [hh, ss, vv] = rgbToHsv(...rgb);
                commit();
                app.pushRecent();
              }
            });
            grid.append(b);
          });
          const add = btn(ic.plus, 'Add the current color', () => {
            p.colors.push(hex(app.color));
            savePalettes(pals);
            draw();
          }, 'pswatch add');
          grid.append(add);
          const name = el('div', 'ppal-head', el('strong', '', p.name));
          name.append(
            btn(ic.more, 'Palette options', () => {
              const action = prompt('Rename the palette, or type DELETE to remove it', p.name);
              if (action === null) return;
              if (action === 'DELETE') pals.splice(pi, 1);
              else if (action.trim()) p.name = action.trim();
              savePalettes(pals);
              draw();
            }, 'pbtn icon small'),
          );
          return el('div', 'ppal', name, grid);
        }),
        el(
          'div',
          'prow-btns',
          btn(`${ic.plus}<span>New palette</span>`, 'Create an empty palette', () => {
            const pals2 = loadPalettes();
            pals2.unshift({ name: 'Untitled palette', colors: [] });
            savePalettes(pals2);
            draw();
          }, 'pbtn small'),
          btn(`${ic.camera}<span>From image</span>`, 'Build a palette from a photo or image', async () => {
            const f = await pick('image/*');
            if (!f) return;
            const bmp = await createImageBitmap(f);
            const c = makeCanvas(120, (120 * bmp.height) / bmp.width);
            ctx2d(c).drawImage(bmp, 0, 0, c.width, c.height);
            const colors = paletteFromImage(ctx2d(c).getImageData(0, 0, c.width, c.height).data, 30);
            const pals2 = loadPalettes();
            pals2.unshift({ name: f.name.replace(/\.[^.]+$/, ''), colors });
            savePalettes(pals2);
            draw();
          }, 'pbtn small'),
        ),
      );
    };
    draw();
    return wrap;
  };
  const render = (): void => {
    drawers.length = 0;
    primary.style.background = hex(app.color);
    secondary.style.background = hex(app.secondary);
    body.replaceChildren(
      mode.v === 'disc'
        ? disc()
        : mode.v === 'classic'
          ? el('div', 'pcenter', svSquare(260), hueBar(), slider('Saturation', 0, 1, 0.01, ss, v => ((ss = v), commit()), v => `${Math.round(v * 100)}%`), slider('Brightness', 0, 1, 0.01, vv, v => ((vv = v), commit()), v => `${Math.round(v * 100)}%`))
          : mode.v === 'harmony'
            ? harmony()
            : mode.v === 'value'
              ? values()
              : palettes(),
    );
    swatches.replaceChildren(
      ...app.recent.map(c => {
        const b = el('button', 'pswatch small');
        b.type = 'button';
        b.style.background = c;
        b.addEventListener('click', () => {
          const rgb = fromHex(c);
          if (!rgb) return;
          [hh, ss, vv] = rgbToHsv(...rgb);
          commit();
        });
        return b;
      }),
    );
  };
  const tabs = segmented(
    [
      { id: 'disc', label: 'Disc' },
      { id: 'classic', label: 'Classic' },
      { id: 'harmony', label: 'Harmony' },
      { id: 'value', label: 'Value' },
      { id: 'palettes', label: 'Palettes' },
    ],
    mode.v,
    v => {
      mode.v = v;
      localStorage.setItem('frameforge-paint:colormode', v);
      render();
    },
  );
  root.append(top, tabs, body, el('div', 'plabel small', 'History'), swatches);
  render();
  popover(anchor, root, { width: 340, title: 'Colors' });
}

interface Palette {
  name: string;
  colors: string[];
}

const PAL_KEY = 'frameforge-paint:palettes';

const DEFAULT_PALETTES: Palette[] = [
  { name: 'Essentials', colors: ['#000000', '#3a3a3c', '#8e8e93', '#d1d1d6', '#ffffff', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#30b0c7', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#a2845e'] },
  { name: 'Skin tones', colors: ['#ffe0c4', '#f6c9a5', '#eab38a', '#d99a6c', '#c68352', '#a86a3d', '#8a5230', '#6b3c22', '#4d2a17', '#3a1f10'] },
  { name: 'Pastel', colors: ['#ffd1dc', '#ffe5b4', '#fffacd', '#c1f0c1', '#b5e7f5', '#c9c9ff', '#e5c7ff', '#f7c6e0'] },
  { name: 'Earth', colors: ['#3b2f2f', '#6b4f3a', '#8b6c42', '#a68a64', '#c2b280', '#7a8450', '#4f5d2f', '#2f3e2b'] },
  { name: 'Neon', colors: ['#ff00ff', '#00ffff', '#39ff14', '#ffff00', '#ff073a', '#fe4164', '#bc13fe', '#0ff0fc'] },
  { name: 'Grayscale', colors: ['#000000', '#1c1c1e', '#2c2c2e', '#48484a', '#636366', '#8e8e93', '#aeaeb2', '#c7c7cc', '#e5e5ea', '#ffffff'] },
];

function loadPalettes(): Palette[] {
  try {
    const raw = localStorage.getItem(PAL_KEY);
    return raw ? (JSON.parse(raw) as Palette[]) : structuredClone(DEFAULT_PALETTES);
  } catch {
    return structuredClone(DEFAULT_PALETTES);
  }
}

function savePalettes(p: Palette[]): void {
  try {
    localStorage.setItem(PAL_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function paletteFromImage(data: Uint8ClampedArray, n: number): string[] {
  const pts: number[][] = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) pts.push([data[i], data[i + 1], data[i + 2]]);
  const boxes = [pts];
  while (boxes.length < n) {
    let bi = -1;
    let best = -1;
    let ch = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) {
        const vals = b.map(p => p[c]);
        const r = Math.max(...vals) - Math.min(...vals);
        if (r > best) {
          best = r;
          bi = i;
          ch = c;
        }
      }
    });
    if (bi < 0) break;
    const b = boxes[bi].sort((p, q) => p[ch] - q[ch]);
    boxes.splice(bi, 1, b.slice(0, b.length >> 1), b.slice(b.length >> 1));
  }
  return boxes
    .filter(b => b.length)
    .map(b => hex([0, 1, 2].map(c => b.reduce((s, p) => s + p[c], 0) / b.length / 255) as [number, number, number]))
    .sort();
}

function thumb(layer: Layer, w: number, h: number, mask = false): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  c.className = 'pthumb';
  const g = ctx2d(c);
  const src = mask && layer.mask ? layer.mask : layer.canvas;
  if (layer.kind === 'group' && !mask) {
    g.fillStyle = 'rgba(128,128,128,0.25)';
    g.fillRect(0, 0, w, h);
    return c;
  }
  const s = Math.min(w / src.width, h / src.height);
  if (mask) {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
  }
  g.drawImage(src, (w - src.width * s) / 2, (h - src.height * s) / 2, src.width * s, src.height * s);
  return c;
}

export function layersPanel(app: App, anchor: HTMLElement): void {
  const root = el('div', 'players');
  const list = el('div', 'plist layers');
  let drag: { id: string; ghost: HTMLElement } | null = null;
  const render = (): void => {
    const rows: HTMLElement[] = [];
    const walkRows = (layers: Layer[], depth: number): void => {
      for (let i = layers.length - 1; i >= 0; i--) {
        const l = layers[i];
        const active = l.id === app.doc.activeId;
        const row = el('div', `player${active ? ' on' : ''}${l.clip ? ' clip' : ''}${l.kind === 'group' ? ' group' : ''}`);
        row.dataset.id = l.id;
        row.style.paddingLeft = `${8 + depth * 18}px`;
        const handle = btn(ic.drag, 'Drag to reorder', () => undefined, 'pbtn icon small handle');
        handle.addEventListener('pointerdown', e => {
          e.preventDefault();
          const ghost = el('div', 'pghost', l.name);
          document.body.append(ghost);
          drag = { id: l.id, ghost };
          handle.setPointerCapture(e.pointerId);
        });
        handle.addEventListener('pointermove', e => {
          if (!drag) return;
          drag.ghost.style.left = `${e.clientX + 10}px`;
          drag.ghost.style.top = `${e.clientY - 12}px`;
          list.querySelectorAll('.player').forEach(r => r.classList.remove('drop-above', 'drop-below', 'drop-into'));
          const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.player') as HTMLElement | null;
          if (over && over.dataset.id !== l.id) {
            const r = over.getBoundingClientRect();
            const y = (e.clientY - r.top) / r.height;
            over.classList.add(over.classList.contains('group') && y > 0.3 && y < 0.7 ? 'drop-into' : y < 0.5 ? 'drop-above' : 'drop-below');
          }
        });
        handle.addEventListener('pointerup', () => {
          if (!drag) return;
          const target = list.querySelector('.drop-above, .drop-below, .drop-into') as HTMLElement | null;
          drag.ghost.remove();
          const id = drag.id;
          drag = null;
          if (!target?.dataset.id) return render();
          if (target.classList.contains('drop-into')) {
            const grp = target.dataset.id;
            app.reorder(id, grp, false);
          } else app.reorder(id, target.dataset.id, target.classList.contains('drop-above'));
          render();
        });
        if (l.kind === 'group') {
          row.append(
            handle,
            btn(ic.chevron, l.collapsed ? 'Expand group' : 'Collapse group', () => {
              l.collapsed = !l.collapsed;
              render();
            }, `pbtn icon small chev${l.collapsed ? '' : ' open'}`),
            el('span', 'pfolder', el('span', '', '')),
          );
          (row.lastChild as HTMLElement).innerHTML = ic.folder;
        } else row.append(handle, thumb(l, 54, 40));
        const name = el('div', 'pname', el('span', '', l.name));
        if (l.kind === 'text') name.append(el('em', '', 'Text'));
        if (l.locked) name.append(el('em', '', 'Locked'));
        if (l.alphaLock) name.append(el('em', '', 'α lock'));
        if (l.reference) name.append(el('em', '', 'Reference'));
        if (l.assist) name.append(el('em', '', 'Assisted'));
        const blendBtn = btn(BLENDS.find(b => b.id === l.blend)?.short ?? 'N', 'Blend mode and opacity', () => blendPanel(app, l, blendBtn, render), 'pbtn small blend');
        const vis = btn(l.visible ? ic.eye : ic.eyeOff, l.visible ? 'Hide layer' : 'Show layer', () => app.setLayerProp(l.id, 'visible', !l.visible, l.visible ? 'Hide layer' : 'Show layer'), `pbtn icon small${l.visible ? '' : ' off'}`);
        row.append(name, blendBtn, vis);
        row.addEventListener('click', e => {
          if ((e.target as HTMLElement).closest('button')) return;
          if (active && !app.doc.maskTarget) layerMenu(app, l, row, render);
          else {
            app.doc.activeId = l.id;
            app.doc.maskTarget = false;
            if (app.tool === 'transform') {
              app.commitTransform();
              app.startTransform();
            }
            app.emit('layers');
            render();
          }
        });
        rows.push(row);
        if (l.mask) {
          const mrow = el('div', `player maskrow${active && app.doc.maskTarget ? ' on' : ''}`);
          mrow.style.paddingLeft = `${44 + depth * 18}px`;
          mrow.append(thumb(l, 40, 30, true), el('div', 'pname', el('span', '', 'Layer mask'), el('em', '', l.maskOn ? '' : 'Off')));
          mrow.addEventListener('click', () => {
            if (active && app.doc.maskTarget) {
              popover(
                mrow,
                menuList([
                  { label: l.maskOn ? 'Disable mask' : 'Enable mask', action: () => (app.setLayerProp(l.id, 'maskOn', !l.maskOn, 'Toggle mask'), closePopover()) },
                  { label: 'Apply mask', action: () => (app.removeMask(true, l.id), closePopover()) },
                  { label: 'Delete mask', danger: true, action: () => (app.removeMask(false, l.id), closePopover()) },
                ]),
                { width: 220, stack: true },
              );
              return;
            }
            app.doc.activeId = l.id;
            app.doc.maskTarget = true;
            app.emit('layers');
            render();
          });
          rows.push(mrow);
        }
        if (l.kind === 'group' && !l.collapsed) walkRows(l.children ?? [], depth + 1);
      }
    };
    walkRows(app.doc.layers, 0);
    const bg = el('div', 'player bgrow');
    const sw = el('input', 'pcolorin');
    sw.type = 'color';
    sw.value = app.doc.background;
    sw.addEventListener('change', () => app.setBackground(sw.value));
    bg.append(sw, el('div', 'pname', el('span', '', 'Background color')), btn(app.doc.bgVisible ? ic.eye : ic.eyeOff, 'Show or hide the background', () => app.setBackground(null), `pbtn icon small${app.doc.bgVisible ? '' : ' off'}`));
    rows.push(bg);
    list.replaceChildren(...rows);
  };
  const add = btn(ic.plus, 'Add layer', () => app.addLayer(), 'pbtn icon');
  const head = el('div', 'players-head', el('span', 'plabel', `${app.doc.width} × ${app.doc.height}`), btn(`${ic.folder}`, 'New group', () => app.addLayer('group'), 'pbtn icon'), add);
  root.append(head, list);
  render();
  const off = app.on(w => {
    if ((w === 'layers' || w === 'thumbs') && root.isConnected && !drag) render();
  });
  popover(anchor, root, { width: 360, title: 'Layers', onClose: off });
}

function blendPanel(app: App, l: Layer, anchor: HTMLElement, rerender: () => void): void {
  const root = el('div', 'pblend');
  const original = l.opacity;
  root.append(
    slider('Opacity', 0, 100, 1, Math.round(l.opacity * 100), v => {
      l.opacity = v / 100;
      app.changed(null);
    }, v => `${Math.round(v)}%`, v => {
      l.opacity = original;
      app.setLayerProp(l.id, 'opacity', v / 100, 'Opacity');
      rerender();
    }),
  );
  let group = '';
  const grid = el('div', 'pblends');
  for (const b of BLENDS) {
    if (b.group !== group) {
      group = b.group;
      grid.append(el('div', 'pmenu-h', group));
    }
    grid.append(
      btn(b.label, b.label, () => {
        app.setLayerProp(l.id, 'blend', b.id as Blend, 'Blend mode');
        grid.querySelectorAll('.on').forEach(x => x.classList.remove('on'));
        rerender();
        closePopover();
      }, `pbtn small${l.blend === b.id ? ' on' : ''}`),
    );
  }
  root.append(grid);
  popover(anchor, root, { width: 300, title: 'Blend mode', stack: true });
}

function layerMenu(app: App, l: Layer, anchor: HTMLElement, rerender: () => void): void {
  const close = (fn: () => void) => (): void => {
    fn();
    closePopover();
    rerender();
  };
  const paint = l.kind !== 'group';
  popover(
    anchor,
    menuList([
      { label: 'Rename', action: close(() => {
        const n = prompt('Layer name', l.name);
        if (n?.trim()) app.setLayerProp(l.id, 'name', n.trim(), 'Rename');
      }) },
      ...(l.kind === 'text' ? [{ label: 'Edit text', action: close(() => app.emit('edit-text')) }, { label: 'Rasterize', action: close(() => app.rasterize(l)) }] : []),
      ...(paint
        ? [
            { label: 'Select', hint: 'from layer pixels', action: close(() => app.selectLayerAlpha(l.id)) },
            { label: 'Copy', action: close(() => app.emit('copy')) },
            { label: 'Fill layer', action: close(() => app.fillLayer()) },
            { label: 'Clear', action: close(() => app.clearLayer()) },
            { label: 'Alpha lock', on: l.alphaLock, action: close(() => app.setLayerProp(l.id, 'alphaLock', !l.alphaLock, 'Alpha lock')) },
            { label: 'Invert colors', action: close(() => app.invertLayer()) },
          ]
        : []),
      { label: l.mask ? 'Edit mask' : 'Add mask', action: close(() => (l.mask ? ((app.doc.maskTarget = true), app.emit('layers')) : app.addMask(l.id))) },
      { label: 'Clipping mask', on: l.clip, action: close(() => app.setLayerProp(l.id, 'clip', !l.clip, 'Clipping mask')) },
      ...(paint ? [{ label: 'Drawing assist', on: l.assist, action: close(() => app.setLayerProp(l.id, 'assist', !l.assist, 'Drawing assist')) }, { label: 'Reference', on: l.reference, action: close(() => app.setLayerProp(l.id, 'reference', !l.reference, 'Reference')) }] : []),
      { label: 'Lock', on: l.locked, action: close(() => app.setLayerProp(l.id, 'locked', !l.locked, 'Lock')) },
      'sep',
      { label: 'Merge down', action: close(() => app.mergeDown(l.id)) },
      l.kind === 'group' ? { label: 'Ungroup', action: close(() => app.ungroup(l.id)) } : { label: 'Combine down', hint: 'into a group', action: close(() => app.group(l.id)) },
      { label: 'Move up', action: close(() => app.moveLayer(l.id, 1)) },
      { label: 'Move down', action: close(() => app.moveLayer(l.id, -1)) },
      { label: 'Duplicate', action: close(() => app.duplicateLayer(l.id)) },
      { label: 'Delete', danger: true, action: close(() => app.deleteLayer(l.id)) },
    ]),
    { width: 240, stack: true },
  );
}
