/**
 * Where estimates are kept.
 *
 * A source is somewhere a user can save several estimates and open them again:
 * this browser, a folder on disk, a cloud drive. Every source implements
 * SourceProvider and is listed in registry.ts; nothing else in the app knows
 * which sources exist. To add one (an S3 bucket, a Teams folder), write one
 * file that implements this interface and add one line to the registry.
 *
 * Providers run entirely in the browser. Estimates hold customer names, so
 * they go straight from the browser to the place the user chose and never
 * through the Scopewright server.
 */

/** Who holds a document open for editing. */
export type LockInfo = {
  /** Shown to other people: "locked by ...". */
  owner: string;
  /** Identifies one browser session, so the same person in two tabs still collides. */
  token: string;
  /** Epoch milliseconds. A lock past this time is ignored, so a closed laptop cannot hold a file forever. */
  until: number;
};

/** One saved estimate, as shown in a list. */
export type DocumentRef = {
  id: string;
  name: string;
  customer: string;
  title: string;
  totalHours: number | null;
  updatedAt: number;
  lock: LockInfo | null;
};

export type DocumentBody = {
  /** The parsed file, unvalidated. Callers must pass it through parseEstimateExport. */
  payload: unknown;
  /** Opaque marker of the version that was read; handed back on write to detect someone else's change. */
  revision: string;
};

export type SourceContext = {
  /** Deployment settings from /api/workspace/sources, e.g. a Google client id. Never secrets. */
  config: Record<string, string>;
};

export interface SourceProvider {
  readonly id: string;
  readonly label: string;
  /** One sentence for the source picker. */
  readonly description: string;

  /** False when this deployment has not set the source up; it is then not offered at all. */
  configured(context: SourceContext): boolean;
  /** Null when usable here; otherwise the reason it is not (unsupported browser, not configured). */
  unavailable(context: SourceContext): string | null;

  /** Restore a previous connection without prompting. Resolves false if the user must connect again. */
  resume(context: SourceContext): Promise<boolean>;
  /** Ask the user to choose or authorize a location. Must be called from a click. */
  connect(context: SourceContext): Promise<void>;
  disconnect(): Promise<void>;
  /** Human-readable place the documents live, once connected. */
  location(): string;

  list(): Promise<DocumentRef[]>;
  read(id: string): Promise<DocumentBody>;
  /**
   * Create (id null) or replace a document. When `revision` is given and the
   * stored document has moved on, reject with ConflictError instead of
   * overwriting.
   */
  write(id: string | null, name: string, payload: unknown, revision: string | null): Promise<{ id: string; name: string; revision: string }>;
  remove(id: string): Promise<void>;

  /** Current lock, expired or not; callers decide with lockedByOther(). */
  readLock(id: string): Promise<LockInfo | null>;
  writeLock(id: string, lock: LockInfo | null): Promise<void>;
}

/** The stored document changed since it was read. */
export class ConflictError extends Error {
  constructor() {
    super("This estimate was changed somewhere else since you opened it.");
    this.name = "ConflictError";
  }
}

/** The user has to connect (or reconnect) before the source can be used. */
export class NotConnectedError extends Error {
  constructor(message = "Connect to this source first.") {
    super(message);
    this.name = "NotConnectedError";
  }
}
