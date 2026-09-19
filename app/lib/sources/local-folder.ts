import { describe, uniqueName } from "./documents.ts";
import { parseLock } from "./locks.ts";
import { ConflictError, NotConnectedError } from "./types.ts";
import type { DocumentBody, DocumentRef, LockInfo, SourceProvider } from "./types.ts";

/**
 * Estimates as JSON files in a folder the user picks, through the browser's
 * File System Access API. Point it at a synced or network folder and a team
 * can share it. Chromium browsers only; elsewhere the source reports itself
 * unavailable and import/export remains the way to move files.
 *
 * A document's id is its file name. Its lock is a sibling "<name>.lock" file.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const DB = "scopewright-sources";
const STORE = "handles";
const HANDLE_KEY = "local-folder";

type PermissionMode = { mode: "readwrite" };
type Directory = FileSystemDirectoryHandle & {
  queryPermission(options: PermissionMode): Promise<PermissionState>;
  requestPermission(options: PermissionMode): Promise<PermissionState>;
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};
type PickerWindow = Window & { showDirectoryPicker?: (options: { id: string; mode: "readwrite" }) => Promise<Directory> };

let folder: Directory | null = null;

/** The folder handle survives reloads in IndexedDB; it is a capability, not a path, and holds no file contents. */
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function remember(handle: Directory | null) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    if (handle) tx.objectStore(STORE).put(handle, HANDLE_KEY);
    else tx.objectStore(STORE).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function recall(): Promise<Directory | null> {
  const db = await database();
  const handle = await new Promise<Directory | null>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(HANDLE_KEY);
    request.onsuccess = () => resolve((request.result as Directory | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return handle;
}

function dir(): Directory {
  if (!folder) throw new NotConnectedError("Choose a folder first.");
  return folder;
}

/** Ids come from our own listing, but refuse anything that is not a plain JSON file name anyway. */
function safeName(id: string): string {
  if (!/^[^/\\:*?"<>|]+\.json$/i.test(id) || id.startsWith(".")) throw new Error("Not an estimate file name.");
  return id;
}

async function readJson(handle: FileSystemFileHandle): Promise<{ data: unknown; file: File }> {
  const file = await handle.getFile();
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is too large to be an estimate.`);
  return { data: JSON.parse(await file.text()) as unknown, file };
}

/**
 * Writes go to a temporary file that replaces the real one on close(). The
 * File System Access API has no compare-and-swap, so `stillCurrent` is asked
 * at the last possible moment, after the data is staged and just before the
 * swap; if it says no, the write is abandoned and the file is untouched. That
 * shrinks the window for two simultaneous saves to the swap itself.
 */
async function writeJson(handle: FileSystemFileHandle, data: unknown, stillCurrent?: () => Promise<boolean>) {
  const writable = await handle.createWritable();
  try {
    await writable.write(JSON.stringify(data, null, 2));
    if (stillCurrent && !(await stillCurrent())) throw new ConflictError();
  } catch (problem) {
    await writable.abort().catch(() => {});
    throw problem;
  }
  await writable.close();
}

/**
 * The revision is a digest of the content. Modified time and size are not
 * enough: on a filesystem with coarse timestamps, a same-sized edit inside one
 * tick would look unchanged. Estimates are small, so hashing one is cheap.
 */
async function revisionOf(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function lockOf(name: string): Promise<LockInfo | null> {
  try {
    return parseLock((await readJson(await dir().getFileHandle(`${name}.lock`))).data);
  } catch {
    return null;
  }
}

export const localFolderSource: SourceProvider = {
  id: "local-folder",
  label: "Local folder",
  description: "JSON files in a folder you choose. Use a synced or network folder to share with a team.",

  configured: () => true,
  unavailable: () => (typeof window !== "undefined" && "showDirectoryPicker" in window ? null : "This browser cannot open folders. Use Chrome or Edge, or keep using Import and Export."),

  async resume() {
    const handle = await recall().catch(() => null);
    if (!handle || (await handle.queryPermission({ mode: "readwrite" })) !== "granted") return false;
    folder = handle;
    return true;
  },

  async connect() {
    // A remembered folder only needs its permission renewed; otherwise ask for one.
    const remembered = folder ?? (await recall().catch(() => null));
    if (remembered && (await remembered.requestPermission({ mode: "readwrite" })) === "granted") {
      folder = remembered;
      return;
    }
    await this.changeLocation!({ config: {} });
  },

  async changeLocation() {
    const picked = await (window as PickerWindow).showDirectoryPicker!({ id: "scopewright", mode: "readwrite" });
    folder = picked;
    await remember(picked);
  },

  async disconnect() {
    folder = null;
    await remember(null);
  },

  location: () => (folder ? `Folder “${folder.name}”` : ""),

  async list(): Promise<DocumentRef[]> {
    const found: DocumentRef[] = [];
    for await (const [name, handle] of dir().entries()) {
      if (handle.kind !== "file" || !/\.json$/i.test(name) || name.startsWith(".")) continue;
      try {
        const { data, file } = await readJson(handle as FileSystemFileHandle);
        const ref = describe(name, name, data, file.lastModified, await lockOf(name));
        if (ref) found.push(ref);
      } catch {
        /* unreadable or not JSON: not one of ours */
      }
    }
    return found;
  },

  async read(id): Promise<DocumentBody> {
    const { data, file } = await readJson(await dir().getFileHandle(safeName(id)));
    return { payload: data, revision: await revisionOf(file) };
  },

  async write(id, name, payload, revision) {
    let target = id ? safeName(id) : "";
    if (!target) {
      const taken: string[] = [];
      for await (const [existing] of dir().entries()) taken.push(existing);
      target = safeName(uniqueName(name, taken));
    }
    const unchanged = async () => {
      const current = await dir().getFileHandle(target).then((handle) => handle.getFile()).catch(() => null);
      return Boolean(current && (await revisionOf(current)) === revision);
    };
    // A missing file counts as changed: it was deleted elsewhere and must not be recreated.
    if (id && revision !== null && !(await unchanged())) throw new ConflictError();
    const handle = await dir().getFileHandle(target, { create: !id || revision === null });
    await writeJson(handle, payload, id && revision !== null ? unchanged : undefined);
    return { id: target, name: target, revision: await revisionOf(await handle.getFile()) };
  },

  async remove(id) {
    await dir().removeEntry(safeName(id));
    await dir().removeEntry(`${safeName(id)}.lock`).catch(() => {});
  },

  readLock: (id) => lockOf(safeName(id)),

  async writeLock(id, lock) {
    const name = `${safeName(id)}.lock`;
    if (!lock) return void (await dir().removeEntry(name).catch(() => {}));
    await writeJson(await dir().getFileHandle(name, { create: true }), lock);
  },
};
