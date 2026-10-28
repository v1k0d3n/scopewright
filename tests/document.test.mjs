import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { emptyEstimate } from "../app/lib/defaults.ts";
import { mergeCatalog, mergeEstimate, readEstimateFile } from "../app/lib/estimate.ts";
import { builtInSections, documentOutline, documentText, scopeDocument, sectionLayout } from "../app/lib/document.ts";
import { sectionIds } from "../app/lib/types.ts";

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

test("the built-in sections are listed in the default order the data model names", () => {
  assert.deepEqual(builtInSections.map((section) => section.id), [...sectionIds]);
  assert.deepEqual(sectionLayout([]).map((item) => item.id), [...sectionIds]);
});

test("a saved layout sets the order, and hidden sections print nowhere", () => {
  const layout = [{ id: "assumptions", hidden: false }, { id: "goal", hidden: false }, { id: "prerequisites", hidden: true }];
  const document = scopeDocument(catalog, { ...sample, sectionLayout: layout }, "Org");
  const ids = document.sections.map((section) => section.id);
  assert.deepEqual(ids.slice(0, 2), ["assumptions", "goal"]);
  assert.ok(!ids.includes("prerequisites"));
  const text = documentText(document, "Org");
  assert.match(text, /^1\. ASSUMPTIONS\n- .+\n(- .+\n)*\n2\. GOAL\n/m, "a section moved up still ends with a blank line");
  assert.doesNotMatch(text, /PREREQUISITES/);
});

test("sections a saved layout does not mention go back in after the section they follow by default", () => {
  assert.deepEqual(sectionLayout([{ id: "effort", hidden: true }, { id: "goal", hidden: false }]).map((item) => item.id), ["effort", "goal", "products", "installation", "prerequisites", "delivery", "out-of-scope", "success", "assumptions"]);
});

test("the outline marks hidden sections and says why an empty one does not print", () => {
  const outline = documentOutline(catalog, { ...sample, options: { showHours: false }, sectionLayout: [{ id: "goal", hidden: true }] });
  assert.equal(outline.find((item) => item.id === "goal").hidden, true);
  assert.equal(outline.find((item) => item.id === "effort").omitted, "Hours are hidden");
  assert.equal(outline.find((item) => item.id === "products").omitted, null);
});

test("an untrusted layout keeps only known sections, once each", () => {
  const estimate = mergeEstimate({ sectionLayout: [{ id: "goal", hidden: true }, { id: "goal" }, { id: "nope" }, "x", { id: "effort", hidden: "yes" }] }, emptyEstimate());
  assert.deepEqual(estimate.sectionLayout, [{ id: "goal", hidden: true }, { id: "effort", hidden: false }]);
});
