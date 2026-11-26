import { docToTrack, trackToDoc, type SavedTrack } from '../firebase/library';

/**
 * Saved tracks that stay in this browser (IndexedDB). Private mode saves here,
 * so its descriptions, timings and file names are never sent to Firestore.
 */

export interface TrackStore {
  put(id: string, value: Record<string, unknown>): Promise<void>;
  all(): Promise<Array<{ id: string; value: Record<string, unknown> }>>;
  remove(id: string): Promise<void>;
}

const DB_NAME = 'seen-aloud-local';
const STORE = 'tracks';

/** A minimal promise wrapper over one IndexedDB object store. */
export function indexedDbStore(factory: IDBFactory = indexedDB): TrackStore {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB is not available in this browser.'));
    }));
  const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
    });
  };
  return {
    async put(id, value) {
      await run('readwrite', (s) => s.put(value, id));
    },
    async all() {
      const [keys, values] = await Promise.all([
        run('readonly', (s) => s.getAllKeys()),
        run('readonly', (s) => s.getAll() as IDBRequest<Record<string, unknown>[]>),
      ]);
      return keys.map((key, i) => ({ id: String(key), value: values[i] }));
    },
    async remove(id) {
      await run('readwrite', (s) => s.delete(id));
    },
  };
}

export class LocalTrackLibrary {
  constructor(
    private readonly store: TrackStore = indexedDbStore(),
    private readonly now: () => number = () => Date.now(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  async save(track: SavedTrack): Promise<string> {
    const id = track.id || this.newId();
    await this.store.put(id, { ...trackToDoc(track), updatedAt: this.now() });
    return id;
  }

  async list(): Promise<SavedTrack[]> {
    const rows = await this.store.all();
    return rows
      .map((row) => docToTrack(row.id, row.value))
      .filter((t): t is SavedTrack => t !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 50);
  }

  async remove(id: string): Promise<void> {
    await this.store.remove(id);
  }
}
