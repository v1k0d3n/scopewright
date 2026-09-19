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
  await release(provider, "a.json", "tab-2");
  assert.ok(await provider.readLock("a.json"), "someone else cannot release it");
  await release(provider, "a.json", "tab-1");
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
  const ref = describe("x", "x.json", { format: "scopewright-estimate", estimate: {}, summary: { customer: 7, title: "T", totalHours: "many" } }, 9, { owner: "ana" });
  assert.deepEqual(ref, { id: "x", name: "x.json", customer: "", title: "T", totalHours: null, updatedAt: 9, lock: null });
});

test("deployment settings: browser is always offered and secrets are never published", () => {
  assert.deepEqual(readSourcesConfig({}), { enabled: null, config: {} });
  const read = readSourcesConfig({ SOURCES: " Local-Folder ,, ", SOURCE_GOOGLE_CLIENT_ID: "abc", SOURCE_GOOGLE_CLIENT_SECRET: "nope", SOURCE_EMPTY: "", PATH: "/bin" });
  assert.deepEqual(read.enabled, ["browser", "local-folder"]);
  assert.deepEqual(read.config, { GOOGLE_CLIENT_ID: "abc" });
});
