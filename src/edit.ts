import { shiftKeys } from './keys';
import { speedOf } from './looks';
import { defaultGrade, store } from './state';
import type { Clip, Track, TrackKind } from './types';
import { uid } from './util';

export function makeClip(c: Pick<Clip, 'trackId' | 'kind' | 'name' | 'start' | 'duration'> & Partial<Clip>): Clip {
  return {
    id: uid(),
    offset: 0,
    opacity: 1,
    volume: 1,
    scale: 1,
    x: 0,
    y: 0,
    fadeIn: 0,
    fadeOut: 0,
    grade: defaultGrade(),
    ...c,
  };
}

export function linked(clip: Clip): Clip[] {
  return clip.linkId ? store.project.clips.filter(c => c.linkId === clip.linkId) : [clip];
}

export function withLinked(ids: string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const c = store.clip(id);
    if (c) linked(c).forEach(l => out.add(l.id));
  }
  return [...out];
}

export function maxDuration(clip: Clip): number {
  const m = store.media(clip.mediaId);
  return m && m.kind !== 'image' ? (m.duration - clip.offset) / speedOf(clip) : Infinity;
}

export function clearRange(trackId: string, start: number, end: number, keep: Set<string>): void {
  const out: Clip[] = [];
  for (const c of store.project.clips) {
    const cEnd = c.start + c.duration;
    if (c.trackId !== trackId || keep.has(c.id) || c.start >= end || cEnd <= start) {
      out.push(c);
      continue;
    }
    if (c.start < start) {
      const left = { ...c, duration: start - c.start };
      shiftKeys(left, 0);
      out.push(left);
    }
    if (cEnd > end) {
      const right: Clip = {
        ...structuredClone(c),
        id: uid(),
        linkId: undefined,
        transIn: undefined,
        offset: c.offset + (end - c.start) * speedOf(c),
        start: end,
        duration: cEnd - end,
      };
      shiftKeys(right, -(end - c.start));
      out.push(right);
    }
  }
  store.project.clips = out;
}

function place(clip: Clip): void {
  clearRange(clip.trackId, clip.start, clip.start + clip.duration, new Set());
  store.project.clips.push(clip);
}

function firstTrack(kind: TrackKind, preferred?: string): Track | undefined {
  const pick = preferred ? store.track(preferred) : undefined;
  if (pick && pick.kind === kind && !pick.locked) return pick;
  const tracks = store.project.tracks.filter(t => t.kind === kind && !t.locked);
  return kind === 'video' ? tracks[tracks.length - 1] : tracks[0];
}

export function addMedia(mediaId: string, trackId: string | undefined, start: number): Clip | undefined {
  const m = store.media(mediaId);
  if (!m) return undefined;
  const target = firstTrack(m.kind === 'audio' ? 'audio' : 'video', trackId);
  if (!target) return undefined;
  store.checkpoint();
  const duration = m.kind === 'image' ? 5 : m.duration;
  const linkId = m.kind === 'video' && m.hasAudio ? uid() : undefined;
  const main = makeClip({ trackId: target.id, kind: m.kind, mediaId, name: m.name, start, duration, linkId });
  place(main);
  if (linkId) {
    const audioTrack = firstTrack('audio');
    if (audioTrack) place(makeClip({ trackId: audioTrack.id, kind: 'audio', mediaId, name: m.name, start, duration, linkId }));
  }
  store.select([main.id]);
  store.emit('project');
  return main;
}

export function appendMedia(mediaId: string): void {
  const m = store.media(mediaId);
  if (!m) return;
  const target = firstTrack(m.kind === 'audio' ? 'audio' : 'video');
  if (!target) return;
  const end = store.project.clips.filter(c => c.trackId === target.id).reduce((max, c) => Math.max(max, c.start + c.duration), 0);
  addMedia(mediaId, target.id, end);
}

export function addTitle(start: number): void {
  const target = store.project.tracks.find(t => t.kind === 'video' && !t.locked);
  if (!target) return;
  store.checkpoint();
  const clip = makeClip({
    trackId: target.id,
    kind: 'text',
    name: 'Title',
    start,
    duration: 4,
    fadeIn: 0.4,
    fadeOut: 0.4,
    text: { content: 'Your Title', size: 110, color: '#ffffff', bold: true },
  });
  place(clip);
  store.select([clip.id]);
  store.emit('project');
}

export function splitAt(t: number, ids?: string[]): void {
  const frame = store.frame();
  const under = (list: string[]): Clip[] =>
    list
      .map(id => store.clip(id))
      .filter((c): c is Clip => !!c && !store.track(c.trackId)?.locked && t > c.start + frame / 2 && t < c.start + c.duration - frame / 2);
  let targets = under(ids?.length ? withLinked(ids) : withLinked(store.ui.selected));
  if (!targets.length && !ids?.length) targets = under(store.project.clips.map(c => c.id));
  if (!targets.length) return;
  store.checkpoint();
  const links = new Map<string, string>();
  for (const c of targets) {
    const cut = t - c.start;
    const right = structuredClone(c);
    right.id = uid();
    right.start = t;
    right.offset = c.offset + cut * speedOf(c);
    right.duration = c.duration - cut;
    right.fadeIn = 0;
    if (c.linkId) {
      if (!links.has(c.linkId)) links.set(c.linkId, uid());
      right.linkId = links.get(c.linkId);
    }
    right.transIn = undefined;
    shiftKeys(right, -cut);
    c.duration = cut;
    c.fadeOut = 0;
    shiftKeys(c, 0);
    store.project.clips.push(right);
  }
  store.emit('project');
}

export function deleteClips(ids: string[]): void {
  const all = new Set(withLinked(ids));
  if (!all.size) return;
  store.checkpoint();
  store.project.clips = store.project.clips.filter(c => !all.has(c.id));
  store.select([]);
  store.emit('project');
}

export function addTrack(kind: TrackKind): void {
  store.checkpoint();
  const prefix = kind === 'video' ? 'V' : 'A';
  const n = store.project.tracks.filter(t => t.kind === kind).length + 1;
  const track: Track = { id: `${prefix}${n}-${uid().slice(0, 4)}`, kind, name: `${prefix}${n}`, muted: false, hidden: false, locked: false };
  if (kind === 'video') store.project.tracks.unshift(track);
  else store.project.tracks.push(track);
  store.emit('project');
}

export function removeMedia(mediaId: string): void {
  store.checkpoint();
  store.project.clips = store.project.clips.filter(c => c.mediaId !== mediaId);
  store.project.media = store.project.media.filter(m => m.id !== mediaId);
  store.select([]);
  store.emit('project');
  store.emit('media');
}

export function setSpeed(clipId: string, speed: number): void {
  const clip = store.clip(clipId);
  if (!clip) return;
  for (const c of linked(clip)) {
    const source = c.duration * speedOf(c);
    c.speed = speed;
    c.duration = Math.max(store.frame(), Math.min(source / speed, maxDuration(c)));
  }
}

export function addTransition(ids: string[], duration = 1): number {
  const targets = withLinked(ids)
    .map(id => store.clip(id))
    .filter((c): c is Clip => !!c && !c.transIn);
  if (!targets.length) return 0;
  store.checkpoint();
  for (const c of targets) c.transIn = { kind: 'dissolve', duration: Math.min(duration, c.duration) };
  store.emit('project');
  return targets.length;
}
