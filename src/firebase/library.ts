import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import type { AppMode } from '../ai/engine';
import type { Cue, DescriptionLanguage, TextSource } from '../core/types';

/**
 * Only text and timings are stored: never the video, frames or thumbnails.
 * Path: users/{uid}/tracks/{trackId} (see firestore.rules).
 */
export interface SavedTrack {
  id: string;
  title: string;
  fileName: string;
  durationSec: number;
  language: DescriptionLanguage;
  mode: AppMode;
  cues: Cue[];
  ledger: { onDevice: number; inCloud: number; framesOnDevice: number; framesInCloud: number };
  /** Milliseconds since epoch; 0 when not saved yet. */
  updatedAt: number;
}

const MAX_CUES = 600;
const MAX_TEXT = 600;
const SOURCES: readonly TextSource[] = ['on_device', 'in_cloud', 'manual'];

export function trackToDoc(track: SavedTrack): Record<string, unknown> {
  return {
    title: track.title.slice(0, 200),
    fileName: track.fileName.slice(0, 260),
    durationSec: round2(track.durationSec),
    language: track.language,
    mode: track.mode,
    cues: track.cues.slice(0, MAX_CUES).map((c) => ({
      sceneId: c.sceneId,
      start: round2(c.start),
      end: round2(c.end),
      budgetWords: c.budgetWords,
      extended: c.extended,
      text: c.text.slice(0, MAX_TEXT),
      source: c.source,
    })),
    ledger: { ...track.ledger },
  };
}

/** Validates a Firestore document; returns null for anything malformed. */
export function docToTrack(id: string, data: Record<string, unknown>): SavedTrack | null {
  if (typeof data.title !== 'string' || !Array.isArray(data.cues)) return null;
  const cues: Cue[] = [];
  for (const raw of data.cues) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    if (typeof c.start !== 'number' || typeof c.end !== 'number' || typeof c.text !== 'string') continue;
    cues.push({
      sceneId: typeof c.sceneId === 'string' ? c.sceneId : `s${cues.length + 1}`,
      start: c.start,
      end: c.end,
      budgetWords: typeof c.budgetWords === 'number' ? c.budgetWords : 12,
      extended: c.extended === true,
      text: c.text,
      source: SOURCES.includes(c.source as TextSource) ? (c.source as TextSource) : 'manual',
    });
  }
  const ledger = (data.ledger ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const updated = data.updatedAt as { toMillis?: () => number } | undefined;
  return {
    id,
    title: data.title,
    fileName: typeof data.fileName === 'string' ? data.fileName : '',
    durationSec: num(data.durationSec),
    language: data.language === 'es' ? 'es' : 'en',
    mode: data.mode === 'private' || data.mode === 'cloud' ? data.mode : 'hybrid',
    cues,
    ledger: {
      onDevice: num(ledger.onDevice),
      inCloud: num(ledger.inCloud),
      framesOnDevice: num(ledger.framesOnDevice),
      framesInCloud: num(ledger.framesInCloud),
    },
    updatedAt: typeof updated?.toMillis === 'function' ? updated.toMillis() : 0,
  };
}

export class TrackLibrary {
  constructor(
    private readonly db: Firestore,
    private readonly uid: () => Promise<string>,
  ) {}

  async save(track: SavedTrack): Promise<string> {
    const uid = await this.uid();
    const ref = track.id
      ? doc(this.db, 'users', uid, 'tracks', track.id)
      : doc(collection(this.db, 'users', uid, 'tracks'));
    await setDoc(ref, { ...trackToDoc(track), updatedAt: serverTimestamp() });
    return ref.id;
  }

  async list(): Promise<SavedTrack[]> {
    const uid = await this.uid();
    const snapshot = await getDocs(
      query(collection(this.db, 'users', uid, 'tracks'), orderBy('updatedAt', 'desc'), limit(50)),
    );
    return snapshot.docs.map((d) => docToTrack(d.id, d.data())).filter((t): t is SavedTrack => t !== null);
  }

  async remove(id: string): Promise<void> {
    const uid = await this.uid();
    await deleteDoc(doc(this.db, 'users', uid, 'tracks', id));
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
