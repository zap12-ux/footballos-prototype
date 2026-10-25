/**
 * In-flight uploads remembered in `localStorage` so a reload can resume them (§14.1:
 * `GET /uploads/:id` gives `receivedBytes`). Browsers do not keep File handles across a
 * reload, so the coach re-selects the same file; name, size and modification time are
 * compared before anything is sent.
 */
export interface InFlightUpload {
  uploadId: string;
  assetId: string;
  gameId: string;
  filename: string;
  byteSize: number;
  lastModified: number;
  startedAt: string;
}

const KEY = 'footballos.uploads.inflight.v1';

export interface UploadRegistry {
  list(gameId?: string): InFlightUpload[];
  remember(record: InFlightUpload): void;
  forget(uploadId: string): void;
}

function read(storage: Storage): InFlightUpload[] {
  try {
    const raw = storage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as InFlightUpload[]).filter((r) => r && typeof r.uploadId === 'string') : [];
  } catch {
    return [];
  }
}

function write(storage: Storage, records: InFlightUpload[]) {
  try {
    storage.setItem(KEY, JSON.stringify(records));
  } catch {
    /* storage unavailable: resume after reload is not possible, uploads still work */
  }
}

export function createUploadRegistry(storage: Storage | null = typeof window === 'undefined' ? null : window.localStorage): UploadRegistry {
  if (!storage) {
    let memory: InFlightUpload[] = [];
    return {
      list: (gameId) => memory.filter((r) => !gameId || r.gameId === gameId),
      remember: (record) => {
        memory = [...memory.filter((r) => r.uploadId !== record.uploadId), record];
      },
      forget: (uploadId) => {
        memory = memory.filter((r) => r.uploadId !== uploadId);
      },
    };
  }
  return {
    list: (gameId) => read(storage).filter((r) => !gameId || r.gameId === gameId),
    remember: (record) => write(storage, [...read(storage).filter((r) => r.uploadId !== record.uploadId), record]),
    forget: (uploadId) => write(storage, read(storage).filter((r) => r.uploadId !== uploadId)),
  };
}

/** The same file, as far as a browser can tell without reading it. */
export function fileMatches(record: InFlightUpload, file: File): boolean {
  return record.filename === file.name && record.byteSize === file.size && record.lastModified === file.lastModified;
}
