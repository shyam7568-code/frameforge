import type { Clip, Grade, MediaMeta, MediaRuntime, Page, Project, Tool, Track } from './types';
import { clamp } from './util';

export const defaultGrade = (): Grade => ({
  exposure: 0,
  contrast: 0,
  saturation: 1,
  temperature: 0,
  tint: 0,
  lift: { x: 0, y: 0, m: 0 },
  gamma: { x: 0, y: 0, m: 0 },
  gain: { x: 0, y: 0, m: 0 },
});

const track = (id: string, kind: Track['kind']): Track => ({ id, kind, name: id, muted: false, hidden: false, locked: false });

export const newProject = (): Project => ({
  version: 1,
  name: 'Untitled Project',
  width: 1920,
  height: 1080,
  fps: 30,
  tracks: [track('V2', 'video'), track('V1', 'video'), track('A1', 'audio'), track('A2', 'audio')],
  clips: [],
  media: [],
});

export type Change = 'project' | 'playhead' | 'selection' | 'ui' | 'media';

interface Ui {
  page: Page;
  selected: string[];
  playhead: number;
  pps: number;
  tool: Tool;
  playing: boolean;
  snapping: boolean;
}

class Store {
  project: Project = newProject();
  readonly runtime = new Map<string, MediaRuntime>();
  readonly ui: Ui = { page: 'edit', selected: [], playhead: 0, pps: 60, tool: 'select', playing: false, snapping: true };
  private readonly listeners = new Set<(c: Change) => void>();
  private past: string[] = [];
  private future: string[] = [];

  on(fn: (c: Change) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(c: Change): void {
    this.listeners.forEach(fn => fn(c));
  }

  checkpoint(): void {
    this.past.push(JSON.stringify(this.project));
    if (this.past.length > 200) this.past.shift();
    this.future = [];
  }

  undo(): void {
    this.travel(this.past, this.future);
  }

  redo(): void {
    this.travel(this.future, this.past);
  }

  private travel(from: string[], to: string[]): void {
    const snap = from.pop();
    if (!snap) return;
    to.push(JSON.stringify(this.project));
    this.project = JSON.parse(snap) as Project;
    this.ui.selected = this.ui.selected.filter(id => this.clip(id));
    this.emit('project');
    this.emit('selection');
  }

  load(project: Project): void {
    this.project = project;
    this.past = [];
    this.future = [];
    this.ui.selected = [];
    this.ui.playhead = 0;
    this.emit('project');
    this.emit('selection');
    this.emit('media');
  }

  clip(id: string): Clip | undefined {
    return this.project.clips.find(c => c.id === id);
  }

  track(id: string): Track | undefined {
    return this.project.tracks.find(t => t.id === id);
  }

  media(id?: string): MediaMeta | undefined {
    return id ? this.project.media.find(m => m.id === id) : undefined;
  }

  duration(): number {
    return this.project.clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0);
  }

  frame(): number {
    return 1 / this.project.fps;
  }

  setPlayhead(t: number): void {
    this.ui.playhead = clamp(t, 0, this.duration());
    this.emit('playhead');
  }

  select(ids: string[]): void {
    this.ui.selected = ids;
    this.emit('selection');
  }

  setTool(tool: Tool): void {
    this.ui.tool = tool;
    this.emit('ui');
  }
}

export const store = new Store();
