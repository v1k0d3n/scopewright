import { describe, uniqueName } from "./documents.ts";
import { parseLock } from "./locks.ts";
import { ConflictError } from "./types.ts";
import type { DocumentBody, DocumentRef, LockInfo, SourceProvider } from "./types.ts";

/**
 * Estimates kept in this browser's localStorage. Always available, needs no
 * setup, and is not shared with anyone: clearing site data removes them.
 */

const KEY = "scopewright:library";

type Entry = { name: string; payload: unknown; revision: number; updatedAt: number; lock: unknown };
type Library = Record<string, Entry>;

function load(): Library {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Library) : {};
  } catch {
    return {};
  }
}

function store(library: Library) {
  // Let a quota error surface: silently losing a save would be worse.
  window.localStorage.setItem(KEY, JSON.stringify(library));
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
    return Object.entries(load()).flatMap(([id, entry]) => describe(id, entry.name, entry.payload, entry.updatedAt, entry.lock) ?? []);
  },

  async read(id): Promise<DocumentBody> {
    const entry = load()[id];
    if (!entry) throw new Error("That estimate is no longer in this browser.");
    return { payload: entry.payload, revision: String(entry.revision) };
  },

  async write(id, name, payload, revision) {
    const library = load();
    const existing = id ? library[id] : undefined;
    if (existing && revision !== null && String(existing.revision) !== revision) throw new ConflictError();
    const key = id ?? crypto.randomUUID();
    const next = (existing?.revision ?? 0) + 1;
    const others = Object.entries(library).filter(([other]) => other !== key).map(([, entry]) => entry.name);
    const finalName = existing?.name ?? uniqueName(name, others);
    library[key] = { name: finalName, payload, revision: next, updatedAt: Date.now(), lock: existing?.lock ?? null };
    store(library);
    return { id: key, name: finalName, revision: String(next) };
  },

  async remove(id) {
    const library = load();
    delete library[id];
    store(library);
  },

  async readLock(id): Promise<LockInfo | null> {
    return parseLock(load()[id]?.lock);
  },

  async writeLock(id, lock) {
    const library = load();
    if (!library[id]) return;
    library[id].lock = lock;
    store(library);
  },
};
