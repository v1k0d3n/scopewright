import { describe, uniqueName } from "./documents.ts";
import { parseLock } from "./locks.ts";
import { ConflictError } from "./types.ts";
import type { DocumentBody, DocumentRef, LockInfo, SourceProvider } from "./types.ts";

/**
 * Estimates kept in this browser's localStorage. Always available, needs no
 * setup, and is not shared with anyone: clearing site data removes them.
 */

/**
 * One localStorage record per document. A single shared map would be read,
 * changed and written back whole, so two tabs saving different documents
 * would each erase the other's change. Separate records touch only their own
 * key; two tabs on the same document are what the lock and revision are for.
 */
const PREFIX = "scopewright:document:";
const LEGACY_KEY = "scopewright:library";

type Entry = { name: string; payload: unknown; revision: number; updatedAt: number; lock: unknown };

function parse(raw: string | null): Entry | null {
  try {
    const entry = JSON.parse(raw ?? "null") as Partial<Entry> | null;
    return entry && typeof entry === "object" && typeof entry.name === "string" && typeof entry.revision === "number" ? (entry as Entry) : null;
  } catch {
    return null;
  }
}

const get = (id: string) => parse(window.localStorage.getItem(PREFIX + id));
// Let a quota error surface: silently losing a save would be worse.
const put = (id: string, entry: Entry) => window.localStorage.setItem(PREFIX + id, JSON.stringify(entry));

/** Builds of this feature before release kept everything under one key; split it once. */
function migrate() {
  const raw = window.localStorage.getItem(LEGACY_KEY);
  if (raw === null) return;
  try {
    for (const [id, entry] of Object.entries(JSON.parse(raw) as Record<string, unknown>)) if (parse(JSON.stringify(entry)) && !get(id)) put(id, entry as Entry);
  } catch {
    /* unreadable: nothing to carry over */
  }
  window.localStorage.removeItem(LEGACY_KEY);
}

function all(): [string, Entry][] {
  migrate();
  const found: [string, Entry][] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    const entry = key?.startsWith(PREFIX) ? parse(window.localStorage.getItem(key)) : null;
    if (key && entry) found.push([key.slice(PREFIX.length), entry]);
  }
  return found;
}

export const browserSource: SourceProvider = {
  id: "browser",
  label: "This browser",
  description: "Kept in this browser only. Private to you, and gone if you clear site data.",

  configured: () => true,
  unavailable: () => null,
  resume: async () => true,
  connect: async () => {},
  disconnect: async () => {},
  location: () => "This browser",

  async list(): Promise<DocumentRef[]> {
    return all().flatMap(([id, entry]) => describe(id, entry.name, entry.payload, entry.updatedAt, entry.lock) ?? []);
  },

  async read(id): Promise<DocumentBody> {
    const entry = get(id);
    if (!entry) throw new Error("That estimate is no longer in this browser.");
    return { payload: entry.payload, revision: String(entry.revision) };
  },

  async write(id, name, payload, revision) {
    const existing = id ? get(id) : null;
    // Saving back to a document that was deleted elsewhere must not quietly bring it back.
    if (id && !existing) throw new ConflictError();
    if (existing && revision !== null && String(existing.revision) !== revision) throw new ConflictError();
    const key = id ?? crypto.randomUUID();
    const next = (existing?.revision ?? 0) + 1;
    const finalName = existing?.name ?? uniqueName(name, all().map(([, entry]) => entry.name));
    put(key, { name: finalName, payload, revision: next, updatedAt: Date.now(), lock: existing?.lock ?? null });
    return { id: key, name: finalName, revision: String(next) };
  },

  async remove(id) {
    window.localStorage.removeItem(PREFIX + id);
  },

  async readLock(id): Promise<LockInfo | null> {
    return parseLock(get(id)?.lock);
  },

  async writeLock(id, lock) {
    const entry = get(id);
    if (entry) put(id, { ...entry, lock });
  },
};
