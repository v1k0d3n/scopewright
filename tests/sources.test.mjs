import assert from "node:assert/strict";
import test from "node:test";
import { describe, fileNameFor, uniqueName } from "../app/lib/sources/documents.ts";
import { acquire, LOCK_MINUTES, lockedByOther, newLock, parseLock, release } from "../app/lib/sources/locks.ts";
import { readSourcesConfig } from "../app/lib/sources/server-config.ts";

/** The smallest thing that satisfies the locking half of SourceProvider. */
function memoryProvider() {
  const locks = new Map();
  return { readLock: async (id) => locks.get(id) ?? null, writeLock: async (id, lock) => void (lock ? locks.set(id, lock) : locks.delete(id)) };
}

test("a document is locked for one holder until they release it", async () => {
  const provider = memoryProvider();
  assert.equal(await acquire(provider, "a.json", "ana", "tab-1", 1000), null);
  const blocked = await acquire(provider, "a.json", "ben", "tab-2", 2000);
  assert.equal(blocked.owner, "ana");
  assert.equal(await acquire(provider, "a.json", "ana", "tab-1", 3000), null, "the holder can renew");
  await release(provider, "a.json", "tab-2", 3500);
  assert.ok(await provider.readLock("a.json"), "someone else cannot release it");
  await release(provider, "a.json", "tab-1", 3500);
  assert.equal(await acquire(provider, "a.json", "ben", "tab-2", 4000), null);
});

test("an abandoned lock expires", async () => {
  const provider = memoryProvider();
  await acquire(provider, "a.json", "ana", "tab-1", 0);
  const later = LOCK_MINUTES * 60_000 + 1;
  assert.equal(await acquire(provider, "a.json", "ben", "tab-2", later), null);
  assert.equal(lockedByOther(newLock("ana", "tab-1", 0), "tab-2", later), false);
});

test("the same person in a second tab is still a second editor", () => {
  assert.equal(lockedByOther(newLock("ana", "tab-1", 0), "tab-9", 1), true);
});

test("lock files are untrusted: only the exact shape is accepted", () => {
  assert.equal(parseLock(null), null);
  assert.equal(parseLock("locked"), null);
  assert.equal(parseLock({ owner: "ana", token: "t" }), null);
  assert.equal(parseLock({ owner: "ana", token: "t", until: "soon" }), null);
  assert.equal(parseLock({ owner: "ana", token: "t", until: Infinity }), null);
  const parsed = parseLock({ owner: "a".repeat(500), token: "t", until: 5, extra: "<script>" });
  assert.deepEqual(Object.keys(parsed), ["owner", "token", "until"]);
  assert.equal(parsed.owner.length, 120);
});

test("file names are safe on any filesystem and never collide", () => {
  assert.equal(fileNameFor("Acme / Co.", "POC: Platform"), "acme-co-poc-platform.json");
  assert.equal(fileNameFor("", ""), "estimate.json");
  assert.equal(fileNameFor("../../etc", "passwd"), "etc-passwd.json");
  assert.equal(uniqueName("acme.json", []), "acme.json");
  assert.equal(uniqueName("acme.json", ["ACME.json", "acme-2.json"]), "acme-3.json");
});

test("files that are not estimates stay out of the list", () => {
  assert.equal(describe("x", "x.json", { hello: "world" }, 0, null), null);
  assert.equal(describe("x", "x.json", [1, 2], 0, null), null);
  assert.equal(describe("x", "x.json", { format: "other", version: 1, estimate: {} }, 0, null), null, "an unknown format");
  assert.equal(describe("x", "x.json", { format: "scopewright-estimate", version: 2, estimate: {} }, 0, null), null, "a future version");
  assert.equal(describe("x", "x.json", { format: "scopewright-estimate", version: 1, estimate: [] }, 0, null), null, "an estimate that is not an object");
  assert.ok(describe("x", "x.json", { format: "poc-estimate", version: 1, estimate: {} }, 0, null), "the legacy format still lists");
  const ref = describe("x", "x.json", { format: "scopewright-estimate", version: 1, estimate: {}, summary: { customer: 7, title: "T", totalHours: "many" } }, 9, { owner: "ana" });
  assert.deepEqual(ref, { id: "x", name: "x.json", customer: "", title: "T", totalHours: null, updatedAt: 9, lock: null });
});

test("deployment settings: browser is always offered and secrets are never published", () => {
  assert.deepEqual(readSourcesConfig({}), { enabled: null, config: {} });
  const read = readSourcesConfig({ SOURCES: " Local-Folder ,, ", SOURCE_GOOGLE_CLIENT_ID: "abc", SOURCE_GOOGLE_CLIENT_SECRET: "nope", SOURCE_EMPTY: "", PATH: "/bin" });
  assert.deepEqual(read.enabled, ["browser", "local-folder"]);
  assert.deepEqual(read.config, { GOOGLE_CLIENT_ID: "abc" });
});

test("typed folder names are made safe, and an empty one is refused", async () => {
  const { folderNameFor } = await import("../app/lib/sources/documents.ts");
  assert.equal(folderNameFor("  Acme / 2026: POCs  "), "Acme 2026 POCs");
  assert.equal(folderNameFor("../../etc"), "etc");
  assert.equal(folderNameFor("..hidden"), "hidden");
  assert.equal(folderNameFor("trailing. . "), "trailing");
  assert.equal(folderNameFor("x".repeat(300)).length, 100);
  assert.throws(() => folderNameFor(" /\\ .. "), /Type a name/);
});

test("a typed file name always ends in .json, exactly once", async () => {
  const { fileNameFromTyped } = await import("../app/lib/sources/documents.ts");
  assert.equal(fileNameFromTyped("Acme POC"), "Acme POC.json");
  assert.equal(fileNameFromTyped(" acme-poc.JSON "), "acme-poc.json");
  assert.equal(fileNameFromTyped("a/b\\c.json"), "a b c.json");
  assert.throws(() => fileNameFromTyped(".json"), /Type a name/);
});

/** Enough of localStorage for the browser source, with every setItem recorded. */
function fakeLocalStorage() {
  const store = new Map();
  store.writes = [];
  globalThis.window = { localStorage: { get length() { return store.size; }, key: (index) => [...store.keys()][index] ?? null, getItem: (key) => store.get(key) ?? null, setItem: (key, value) => { store.writes.push(key); store.set(key, value); }, removeItem: (key) => void store.delete(key) } };
  return store;
}

test("releasing never removes a lock that may have changed hands", async () => {
  const { RELEASE_MARGIN_MS } = await import("../app/lib/sources/locks.ts");
  const provider = memoryProvider();
  await acquire(provider, "a.json", "ana", "tab-1", 0);
  const expiry = LOCK_MINUTES * 60_000;
  // Expired, or about to: someone else may be taking it right now, so leave it.
  await release(provider, "a.json", "tab-1", expiry + 1);
  assert.ok(await provider.readLock("a.json"), "an expired lock is left alone");
  await release(provider, "a.json", "tab-1", expiry - RELEASE_MARGIN_MS + 1);
  assert.ok(await provider.readLock("a.json"), "so is one inside the safety margin");
  await release(provider, "a.json", "tab-1", expiry - RELEASE_MARGIN_MS - 1);
  assert.equal(await provider.readLock("a.json"), null, "a comfortably live lock is released");
});

test("this browser: saving back to a document deleted elsewhere is a conflict, not a resurrection", async () => {
  fakeLocalStorage();
  const { browserSource } = await import("../app/lib/sources/browser.ts");
  const { ConflictError } = await import("../app/lib/sources/types.ts");
  const payload = { format: "scopewright-estimate", version: 1, estimate: {} };
  const first = await browserSource.write(null, "acme.json", payload, null);
  assert.equal((await browserSource.write(first.id, "acme.json", payload, first.revision)).revision, "2");
  await assert.rejects(browserSource.write(first.id, "acme.json", payload, first.revision), ConflictError, "a stale revision");
  await browserSource.remove(first.id);
  await assert.rejects(browserSource.write(first.id, "acme.json", payload, "2"), ConflictError, "a deleted document");
  assert.deepEqual(await browserSource.list(), []);
  delete globalThis.window;
});

test("this browser: a save touches only its own record, so another tab's save cannot be erased", async () => {
  const store = fakeLocalStorage();
  const { browserSource } = await import("../app/lib/sources/browser.ts");
  const payload = { format: "scopewright-estimate", version: 1, estimate: {} };
  const a = await browserSource.write(null, "a.json", payload, null);
  const b = await browserSource.write(null, "b.json", payload, null);
  store.writes.length = 0;
  await browserSource.write(a.id, "a.json", payload, a.revision);
  await browserSource.writeLock(b.id, { owner: "ana", token: "t", until: 5 });
  assert.deepEqual(store.writes, [`scopewright:document:${a.id}`, `scopewright:document:${b.id}`]);
  assert.equal((await browserSource.list()).length, 2);
  delete globalThis.window;
});

test("this browser: estimates kept under the old single key are carried over once", async () => {
  const store = fakeLocalStorage();
  const { browserSource } = await import("../app/lib/sources/browser.ts");
  store.set("scopewright:library", JSON.stringify({ old1: { name: "old.json", payload: { format: "scopewright-estimate", version: 1, estimate: {} }, revision: 3, updatedAt: 1, lock: null }, junk: "nope" }));
  assert.deepEqual((await browserSource.list()).map((doc) => [doc.id, doc.name]), [["old1", "old.json"]]);
  assert.equal(store.has("scopewright:library"), false);
  assert.equal((await browserSource.read("old1")).revision, "3");
  delete globalThis.window;
});

test("this browser: a migration that runs out of space keeps the old copy and resumes later", async () => {
  const store = fakeLocalStorage();
  const { browserSource } = await import("../app/lib/sources/browser.ts");
  const doc = (name) => ({ name, payload: { format: "scopewright-estimate", version: 1, estimate: {} }, revision: 1, updatedAt: 1, lock: null });
  store.set("scopewright:library", JSON.stringify({ one: doc("one.json"), two: doc("two.json") }));
  const realSet = window.localStorage.setItem;
  let budget = 1;
  window.localStorage.setItem = (key, value) => { if (budget-- <= 0) throw new DOMException("full", "QuotaExceededError"); realSet(key, value); };
  assert.deepEqual((await browserSource.list()).map((d) => d.name), ["one.json"], "only the first fitted");
  assert.ok(store.has("scopewright:library"), "the old copy is kept, since it is the only copy of two.json");
  window.localStorage.setItem = realSet;
  assert.deepEqual((await browserSource.list()).map((d) => d.name).sort(), ["one.json", "two.json"], "the next attempt finishes the job");
  assert.equal(store.has("scopewright:library"), false);
  delete globalThis.window;
});
