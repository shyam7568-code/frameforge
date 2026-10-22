# Frameforge

A video editor that runs entirely in your browser, with four workspaces: Media, Edit, Color and Deliver. No server, no install, no upload. Your files never leave your computer.

**Live demo:** [Video editor](https://shyam7568-code.github.io/frameforge/) · [Paint studio](https://shyam7568-code.github.io/frameforge/paint.html)

**Built with:** TypeScript, WebGL 2, Canvas, Web Audio, MediaRecorder, IndexedDB, Vite and a service worker for offline PWA support. Developed with AI coding agents (Claude Code).

## Use it

**Portable:** open `Frameforge.html` (video editor) or `Paint.html` (painting studio) from the `Frameforge.zip` release, or `dist/index.html` / `dist/paint.html` in Chrome, Edge, Firefox or Safari. It is one self-contained file, so you can copy it to any computer or USB stick.

**On phones and tablets:** the layout adapts to any screen. On a phone, the viewer stays on top and a Timeline / Media / Inspector switcher sits underneath, with a menu button (☰) for the rest. You can tap **+** on a media card to add it, drag clips with your finger, and pinch the timeline to zoom.

Phones can't run a downloaded HTML file properly (iPhone's Files app only previews it), so put the `website` folder online and open the link instead. The site contains both apps: the editor at the main address and the painting studio at `/paint.html`. Any free static host works, for example [Netlify Drop](https://app.netlify.com/drop) (drag the folder onto the page) or GitHub Pages. Once it's online:

- **iPhone / iPad (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** ⋮ menu → *Install app*
- **Desktop (Chrome / Edge):** the install icon in the address bar

The installed app opens full screen and works offline after the first visit.

**From source:**

```bash
npm install
npm run dev      # development server
npm run build    # produces dist/index.html
```

Needs Node.js 20.19+ or 22.12+ to build.

## Features

| Page | What you can do |
|---|---|
| **Media** | Import video, audio and images (button, Ctrl+I, or drag files in). Thumbnails, audio waveforms and file details. |
| **Edit** | Multi-track timeline (add more video and audio tracks). Drag clips in, move them between tracks, trim their edges, and cut with the blade tool or Ctrl+B. Snapping, titles with fades, and an inspector for zoom, position, opacity, volume and fades. Clips placed over others overwrite them. Video with sound brings its audio along as a linked clip. |
| **Color** | Lift / Gamma / Gain / Offset colour wheels with master sliders. Exposure, contrast, saturation, temperature, tint, shadows and highlights, each keyframeable. Secondary correction with an HSL qualifier (eyedropper pick) and power windows (circle, rectangle, linear) you drag on the viewer. Copy and paste grades. Waveform, RGB parade, histogram and vectorscope. All grading runs on the GPU. |
| **Deliver** | Render the timeline with audio to MP4 (H.264) or WebM (VP9/VP8), at 720p to 4K, vertical or square, 24–60 fps, with a choice of quality. Share finished videos through your system share sheet, or download them and open YouTube, Instagram, TikTok, Facebook, X, LinkedIn, WhatsApp, Google Drive or email in one click. |

### Clip effects (Inspector)

| Feature | Details |
|---|---|
| **Filters** | 12 one-click looks: Black & White, Sepia, Cinematic, Vintage, Vivid, Cool, Warm, Noir, Faded, Cyberpunk, Invert and Golden Hour, with an amount slider |
| **Effects** | Vignette, film grain, blur and sharpen |
| **Transform** | Zoom, position, rotation, opacity, horizontal and vertical flip |
| **Crop** | Crop from the left, right, top and bottom |
| **Animation** | In and Out animations (fade, slide in four directions, zoom in/out, spin, pop, blur) with adjustable timing, plus continuous motion (Ken Burns, pulse, float, rotate, shake) |
| **Speed** | 0.25× to 4× for video and audio, keeping the same footage |
| **Keyframes** | Click the ◆ next to zoom, position, rotation, opacity or a grade control to set a key at the playhead. Values ease smoothly between keys; ◀ ▶ jump between them |
| **Transitions** | Cross dissolve, dip to black, push, slide, wipe (4 directions), iris, zoom, spin and blur. Select a cut and press Ctrl+T, or pick one under *Transition* and set its length |
| **Composite** | Blend modes: normal, multiply, screen, overlay, soft light, hard light, add, difference, darken, lighten, color dodge |
| **Lens & cleanup** | Noise reduction, lens distortion correction and a movable lens flare |
| **AI Magic Mask** | Remove or blur the background behind people |
| **AI Auto Subtitles** | Transcribe speech in a clip into subtitles on a *Subtitles* track, then export them as `.srt` |
| **AI Object Cutout** | Click any object in the viewer and it is tracked through the whole clip. Choose *Keep only the object* (transparent background, so lower tracks show through) or *Erase the object* (filled from other frames when the camera is steady, otherwise from the surrounding pixels). Add more objects, soften or grow the edge, and show the mask to check it |
| **AI Styles** | Cartoon, anime, pencil sketch, color pencil, oil painting, watercolor, comic book, pixel art and neon edges, with an amount slider. Runs on the GPU in real time, offline |
| **Fit / Fill** | Fit the whole picture inside the canvas, or zoom it to cover the canvas (useful for vertical video) |

### Canvas formats

Pick the canvas shape from the menu at the top of the viewer (also under *Resolution* on the Deliver page): YouTube 16:9 (720p, 1080p, 1440p, 4K), Reels / TikTok / Shorts 9:16, Instagram 4:5, square 1:1, 4:3, 3:4, Pinterest 2:3, ultrawide 21:9, cinemascope 2.39:1, DCI 2K/4K, or any custom size.

### Sound library

Click **Sounds** in the top bar or the Media Pool. It has 51 built-in sounds (rain, thunder, wind, fire, waves, streams, waterfalls, birds, crickets, frogs, bees, owls, engines, traffic, sirens, horns, planes, helicopters, trains, crowds, applause, cheering, footsteps, heartbeat, bells, chimes, knocks, whooshes, dings, phones, alarms, typing, impacts and explosions) that are generated inside the app and always work offline. There are also 43 real recordings (people talking, shouting, laughing, babies, kids, dogs, cats, roosters, sheep, goats, horses, elephants, wolves, frogs, rain, rivers, beach waves, motorbikes, trains, planes, helicopters, sirens, car horns, doors, typing, bells and more). They download once from Wikimedia Commons, about 22 MB in total, or one at a time when you use them, and then stay saved in your browser. All recordings are public domain or CC0, so you can use them in any video without credit; **Credits** lists their sources. **Add** places the sound at the playhead on a free audio track.

### Audio mixer

Open **Mixer** on the Edit timeline. Each audio track has a fader (−60 to +12 dB), a level meter, mute and solo, pan, and a 3-band EQ (low, mid, high). The master fader controls everything you hear and render.

### Image editor

Open it from the top bar (**Image Editor**) or from the pencil on any image in the Media Pool. It offers AI object selection (click an object, Shift-click to add more, then *Keep object* for a transparent background or *Erase object* to remove it), crop with aspect presets (free, 1:1, 16:9, 9:16, 4:3, 3:4), 90° rotation, flipping, brightness/contrast/saturation/warmth/vignette, the same 12 filters, a brush and text. Export as PNG or JPG, share, or save the result back into the Media Pool (the original stays untouched).

**Snapshot** in the viewer saves the current frame as an image in the Media Pool.

Projects autosave in your browser, including imported media. Use **Save** and **Open** for portable `.ffproj` project files. Opening a project on another computer shows media as *offline* until you import the same files again; they relink automatically by file name.

## Frameforge Paint

A full drawing and painting studio included in the same package. Open **Paint.html** (or `paint.html` on the website), or press **Paint** in Frameforge's top bar. It works with a mouse, a finger, or a stylus with pressure and tilt (Apple Pencil, Samsung S Pen, Wacom), on computers, tablets and phones.

| Area | What you get |
|---|---|
| **Brushes** | 86 original brushes in 15 sets (sketching, inking, painting, airbrush, charcoal, textures, nature, calligraphy, glow, water and more). Pressure and tilt control size and opacity; streamline smoothing; start/end tapers; wet color mixing; smudge and eraser with any brush |
| **Brush Studio** | Edit every setting: tip shape (20), grain texture (9), spacing, scatter, jitter, color dynamics, glow, pressure and tilt response. Make unlimited custom brushes and import or export them as `.ffbrush` |
| **Layers** | Unlimited layers (limited by device memory), groups, 26 blend modes, opacity, clipping masks, layer masks, alpha lock, reference layers, lock, merge, duplicate, drag to reorder |
| **Color** | Color disc, classic picker, harmony (complementary, split, analogous, triadic, tetradic), exact HSB/RGB/hex values, palettes (create, edit, or build from a photo), color history, eyedropper (touch and hold, or Alt-click). Drag the color dot onto the canvas to fill an area, then fine-tune the threshold |
| **Selections** | Automatic (magic wand, drag to change the threshold), freehand and polygon, rectangle, ellipse; add, remove, invert, feather, save and load, copy and paste, color fill |
| **Transform** | Freeform, uniform, distort (true perspective), warp mesh, flip, rotate, snapping, fit to canvas |
| **Adjustments** | Hue/saturation/brightness, color balance, curves, gradient map, invert, gaussian/motion/perspective blur, noise, sharpen, bloom, glitch, halftone, chromatic aberration, liquify (push, twirl, pinch, expand, crystals, reconstruct) and clone. Apply to the whole layer, or paint the effect on with **Pencil** mode |
| **Drawing help** | Hold at the end of a stroke to snap it to a perfect line, arc, circle, ellipse, rectangle, polygon or polyline (keep holding to adjust; add a finger or Shift for a perfect shape; drag the handles afterwards). Drawing guides: 2D grid, isometric, 1/2/3-point perspective and symmetry (vertical, horizontal, quadrant, radial, rotational) with drawing assist |
| **Text** | Editable text layers with fonts, weight, italic, underline, alignment, tracking, line height, outline, import your own fonts |
| **Animation** | Frame-by-frame animation with onion skins, frames per second, loop/ping-pong/one shot, hold frames, background and foreground layers. Export animated GIF, animated PNG or video |
| **Time-lapse** | Every stroke is recorded automatically. Replay it, or export full length or a 30-second summary as video |
| **Files** | Gallery with autosave. Export PNG, JPEG, PSD (with layers, blend modes and opacity), PDF, layer PNGs (zip) and the native `.ffpaint`. Import images, photos, PSD and `.ffpaint`. **Send to Frameforge** puts the artwork straight into the video editor's Media Pool |
| **3D painting** | Paint directly on 3D models with every brush, smudge, eraser, ColorDrop and eyedropper. Start from a built-in sphere, cube, cylinder, cone, torus or plane, or import OBJ (with MTL and textures), glTF or GLB (multi-material models are packed into one texture). Orbit with two fingers or a right-drag, zoom with pinch or the wheel, or switch on one-finger orbit. Adjustable lighting and wireframe; switch to the flat texture view with the cube button. Export GLB, USDZ (opens in AR on iPhone and iPad), OBJ with material and texture, a 3D snapshot or a turntable video |
| **Gestures** | Pinch to zoom and rotate, two-finger tap to undo (hold for rapid undo), three-finger tap to redo, four-finger tap for full screen, palm rejection when a stylus is used. Reference window, light/dark interface, left or right-handed sidebar, adjustable pressure response |

Limits: the app can't open Procreate's own `.procreate` files, and 3D models import from OBJ, glTF and GLB but not from USDZ; use PSD to exchange layered files with other apps. Very large canvases with many layers need a device with plenty of memory. Frameforge Paint is an original app; it is not affiliated with Procreate or Savage Interactive.

## Keyboard shortcuts

| Key | Action |
|---|---|
| Space | Play / pause |
| ← / → | Previous / next frame (hold Shift for 1 second) |
| Home / End | Go to start / end |
| A / B | Selection tool / blade tool |
| Ctrl/Cmd + B | Split at the playhead |
| Ctrl/Cmd + T | Add a transition at the selected cut |
| Delete | Delete selected clips |
| N | Toggle snapping |
| + / − or Ctrl + scroll | Zoom the timeline |
| Ctrl/Cmd + Z / Shift + Z | Undo / redo |
| Ctrl/Cmd + S / O / I | Save project / open project / import media |
| Esc / Ctrl+Z (image editor) | Close / undo |

## Notes and limits

- Sharing straight into social apps needs their own upload pages, so Share downloads the file and opens the site for you; on phones and Safari the system share sheet sends the file directly.
- Rendering runs in real time, so a 2-minute timeline takes about 2 minutes. Keep the tab visible while it renders.
- Supported formats are whatever your browser can play. MP4 (H.264), WebM, MP3, WAV, AAC, PNG and JPEG work everywhere. Some MOV/HEVC files only play in Safari.
- The AI features need an internet connection the first time, to download their models (the person and object segmenters are a few MB each, the speech model about 40–75 MB). After that they run on your device and nothing is uploaded. Magic Mask works best on people. Object Cutout works on any clearly separated object; fast motion, motion blur and very fine detail such as hair lower its accuracy. Tracking takes roughly a few seconds per second of video.
- Erasing large objects from footage with a moving camera can leave a smeared area, because nothing in the frame shows what was behind the object.
- AI Styles are image-processing filters that run on your device. They restyle your footage but do not generate new content.
- Phones are slower than computers: AI tracking and 4K renders take noticeably longer, and very long 4K projects can exceed a phone's memory. Exporting MP4 needs a recent browser (Safari 14.1+, Chrome 94+).
- Very large projects are limited by your browser's memory and storage.
