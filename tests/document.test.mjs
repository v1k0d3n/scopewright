import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { emptyEstimate } from "../app/lib/defaults.ts";
import { mergeCatalog, readEstimateFile } from "../app/lib/estimate.ts";
import { builtInSections, documentText, scopeDocument } from "../app/lib/document.ts";

const emptyCatalog = { products: [], installation: {}, prerequisites: {}, groups: [], solutions: [], outOfScope: [], documentTemplates: [] };
const pack = (name) => JSON.parse(readFileSync(new URL(`../packs/solstice/${name}`, import.meta.url), "utf8"));
const catalog = mergeCatalog(pack("catalog.json").catalog, emptyCatalog);
const sample = readEstimateFile(pack("sample-estimate.json"), emptyEstimate()).estimate;

/** Every span in a list of blocks, however deeply grouped. */
const spans = (blocks) => blocks.flatMap((block) => {
  if (block.kind === "paragraph") return block.content;
  if (block.kind === "list") return block.items.flat();
  if (block.kind === "table") return block.rows.flatMap((row) => row.cells.flat());
  return [...block.title, ...spans(block.blocks)];
});

test("the page and the copied text print the same sections, numbered in the same order", () => {
  const document = scopeDocument(catalog, sample, "Org");
  assert.deepEqual(document.sections.map((section) => section.id), builtInSections.map((section) => section.id));
  const headings = documentText(document, "Org").split("\n").filter((line) => /^\d+\. [A-Z ]+$/.test(line));
  assert.deepEqual(headings, document.sections.map((section, index) => `${index + 1}. ${section.title}`));
});

test("a section left out of the document leaves no gap in the numbering", () => {
  const document = scopeDocument(catalog, { ...sample, options: { showHours: false }, outOfScope: [], customOutOfScope: "" }, "Org");
  const ids = document.sections.map((section) => section.id);
  assert.ok(!ids.includes("effort") && !ids.includes("out-of-scope"));
  assert.match(documentText(document, "Org"), /\n6\. SUCCESS CRITERIA\n/);
});

test("with hours hidden, no section carries an hour figure", () => {
  const document = scopeDocument(catalog, { ...sample, options: { showHours: false } }, "Org");
  const figures = document.sections.flatMap((section) => spans(section.blocks)).filter((span) => typeof span === "object" && "hours" in span);
  assert.deepEqual(figures, []);
  assert.doesNotMatch(document.sections.flatMap((section) => section.text).join("\n"), /\bhours?\b/);
});
