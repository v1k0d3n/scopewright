import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { lintCatalog, lintCatalogFile } from "../app/lib/lint.ts";
import { defaultCatalog } from "../app/lib/defaults.ts";

const solstice = JSON.parse(readFileSync(new URL("../packs/solstice/catalog.json", import.meta.url), "utf8"));

test("the Solstice pack lints clean", () => {
  assert.deepEqual(lintCatalogFile(solstice), []);
  assert.deepEqual(lintCatalog(solstice.catalog, defaultCatalog).filter((m) => m.level === "error"), []);
});

test("an invented shape is named, not silently accepted", () => {
  const messages = lintCatalogFile({ metadata: {}, products: [], offerings: [], workstreams: [], tasks: [] });
  assert.ok(messages.some((m) => m.level === "error" && m.text.includes('"catalog" object')));
  assert.ok(messages.some((m) => m.text.includes("offerings")));
});

test("semantic problems are explained", () => {
  const messages = lintCatalog({
    products: [{ id: "a", name: "A", short: "A", portfolio: "P", mark: "AA", hours: 1, requires: ["b"], category: "x" }, { id: "b", name: "B", short: "B", portfolio: "P", mark: "BB", hours: 0, requires: ["a"] }],
    installation: { ghost: [], a: [{ id: "q", label: "Q", choices: [{ id: "c", label: "C", hours: 0 }] }] },
    prerequisites: {},
    groups: [{ id: "g", name: "G", category: "C", productId: "nope", tasks: [{ id: "t", name: "T", phase: "Migration", hours: "4", enabled: true }] }],
    solutions: [{ id: "s", title: "S", products: ["a", "zzz"] }],
  }, defaultCatalog);
  const text = messages.map((m) => m.text).join("\n");
  for (const expected of ["Circular requires", 'unknown field "category"', 'no product with id "ghost"', "at least two choices", 'productId "nope"', 'phase "Migration"', '"hours" missing', 'product "zzz"']) assert.ok(text.includes(expected), expected);
});
