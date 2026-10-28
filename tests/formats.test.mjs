import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultCatalog, emptyEstimate } from "../app/lib/defaults.ts";
import { estimateExport, isNewerStoredCatalog, mergeCatalog, mergeEstimate, parseEstimateExport, placeholderValues, calculate, readCatalogFile, readEstimateFile, readStoredCatalog, sectionFrom, sectionTemplateChanged } from "../app/lib/estimate.ts";
import { scopeText } from "../app/lib/document.ts";
import { CATALOG_VERSION, ESTIMATE_VERSION, RELOAD_NEWER, RELOAD_OLDER, WRITTEN_BY, catalogDocument, catalogUpgrades, catalogWriteProblem, estimateUpgrades } from "../app/lib/formats.ts";
import { lintCatalogFile } from "../app/lib/lint.ts";

const fixture = (version, name) => readFileSync(new URL(`./fixtures/${version}/${name}`, import.meta.url), "utf8");
const json = (version, name) => JSON.parse(fixture(version, name));
const ORG = "Solstice Field Engineering";

/** Render a frozen fixture set with today's code. */
const render = (version) => {
  const read = readCatalogFile(json(version, "catalog.json"), defaultCatalog);
  assert.ok("catalog" in read, read.problem);
  const estimate = parseEstimateExport(json(version, "estimate.json"), emptyEstimate());
  assert.ok(estimate, "the frozen estimate still opens");
  return { catalog: read.catalog, estimate };
};

// Each folder under tests/fixtures holds files written by that version and the text they printed then. They are never edited:
// if today's code prints something different from an old file, an old document has changed, and that is the bug.
for (const version of readdirSync(new URL("./fixtures/", import.meta.url)).filter((name) => /^v\d+$/.test(name))) {
  test(`files written by ${version} still print exactly what they printed then`, () => {
    const { catalog, estimate } = render(version);
    assert.equal(`${scopeText(catalog, estimate, ORG)}\n`, fixture(version, "scope.txt"));
  });
}

test("every earlier version has an upgrade step to the next", () => {
  for (let version = 1; version < CATALOG_VERSION; version += 1) assert.equal(typeof catalogUpgrades[version], "function", `catalog ${version} → ${version + 1}`);
  for (let version = 1; version < ESTIMATE_VERSION; version += 1) assert.equal(typeof estimateUpgrades[version], "function", `estimate ${version} → ${version + 1}`);
});

test("an upgraded estimate is saved in the current version and prints the same", () => {
  const { catalog, estimate } = render("v1");
  assert.deepEqual(estimate.customSections, [], "an estimate with no introduction or closing gains no sections");
  assert.deepEqual(estimate.sectionLayout, [], "an estimate from before section layouts prints in the default order");
  const file = JSON.parse(JSON.stringify(estimateExport(catalog, estimate)));
  assert.equal(file.version, ESTIMATE_VERSION);
  assert.equal(file.writtenBy, WRITTEN_BY);
  assert.equal(scopeText(catalog, parseEstimateExport(file, emptyEstimate()), ORG), scopeText(catalog, estimate, ORG));
});

test("an estimate from a newer Scopewright opens view-only, never as an editable one", () => {
  const file = { ...json("v1", "estimate.json"), version: ESTIMATE_VERSION + 1 };
  assert.equal(parseEstimateExport(file, emptyEstimate()), null);
  const read = readEstimateFile(file, emptyEstimate());
  assert.equal(read.newer, ESTIMATE_VERSION + 1);
  assert.equal(read.estimate.customer, "Harbor & Vale Logistics", "what this version understands is still shown");
  assert.equal(readEstimateFile({ ...file, version: "3" }, emptyEstimate()), null, "a version that is not a whole number is not an estimate");
  assert.equal(readEstimateFile({ ...file, version: undefined }, emptyEstimate()), null, "estimate files always carried a version");
});

test("catalog files: older ones upgrade, newer ones are refused with the reason", () => {
  const v1 = json("v1", "catalog.json");
  const read = readCatalogFile(v1, defaultCatalog);
  assert.deepEqual(read.catalog.sectionTemplates, []);
  assert.ok("catalog" in readCatalogFile({ catalog: v1.catalog }, defaultCatalog), "a file without format or version is version 1");
  assert.match(readCatalogFile({ ...v1, version: CATALOG_VERSION + 1 }, defaultCatalog).problem, /newer Scopewright/);
  assert.match(readCatalogFile({ ...v1, version: 1.5 }, defaultCatalog).problem, /whole number/);
  assert.match(readCatalogFile({ hello: 1 }, defaultCatalog).problem, /Not a Scopewright catalog/);
  assert.ok(lintCatalogFile({ ...v1, version: CATALOG_VERSION + 1 }).some((m) => m.level === "error" && m.text.includes("reads catalog versions up to")));
});

test("the server keeps only current-version catalog writes", () => {
  const catalog = readCatalogFile(json("v1", "catalog.json"), defaultCatalog).catalog;
  assert.equal(catalogWriteProblem(catalog), RELOAD_OLDER, "a page from before versions sends the bare catalog");
  assert.equal(catalogWriteProblem({ ...catalogDocument(catalog), version: CATALOG_VERSION - 1 }), RELOAD_OLDER);
  assert.equal(catalogWriteProblem({ ...catalogDocument(catalog), version: CATALOG_VERSION + 1 }), RELOAD_NEWER);
  assert.equal(catalogWriteProblem(catalogDocument(catalog)), null);
});

test("a stored shared catalog of any earlier version still reads, and older pages can read the current one", () => {
  const sections = json("v1", "catalog.json").catalog;
  const old = readStoredCatalog(sections, defaultCatalog);
  assert.equal(old.products.length, sections.products.length);
  assert.deepEqual(old.sectionTemplates, []);
  const stored = JSON.parse(JSON.stringify(catalogDocument({ ...old, sectionTemplates: [{ id: "t", title: "T", category: "", blocks: [], enabled: true, locked: false }] })));
  assert.equal(readStoredCatalog(stored, defaultCatalog).sectionTemplates.length, 1);
  // What a page from before versions does with it: the sections are still at the top level.
  assert.equal(mergeCatalog(stored, defaultCatalog).products.length, sections.products.length);
  assert.equal(isNewerStoredCatalog(stored), false);
  assert.equal(isNewerStoredCatalog(sections), false);
  assert.equal(isNewerStoredCatalog({ ...stored, version: CATALOG_VERSION + 1 }), true);
});

test("the workspace API refuses a catalog save from another version with 409", async () => {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "scopewright-"));
  const { handleStore } = await import("../app/lib/server-store.ts");
  const put = (body) => handleStore("catalog", new Request("http://x/api/workspace/catalog", { method: "PUT", body: JSON.stringify(body) }));
  const stale = await put(defaultCatalog);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error, RELOAD_OLDER);
  assert.equal((await put(catalogDocument(defaultCatalog))).status, 200);
  const branding = await handleStore("branding", new Request("http://x/api/workspace/branding", { method: "PUT", body: JSON.stringify({ orgName: "Any" }) }));
  assert.equal(branding.status, 200, "branding is not versioned yet");
});

const solstice = render("v1").catalog;
const template = { id: "purpose", name: "Purpose of the proof of concept", introduction: "This proof of concept helps {customer} decide on {products}.\n\nIt is run by {organization}.", closing: "{title} ends with a decision. {unknown} stays.", enabled: true, locked: false };
const base = { ...emptyEstimate(), customer: "Acme", products: ["lakehouse", "insight"] };
const framing = { source: "template", templateId: "purpose", templateName: template.name, introduction: template.introduction, closing: template.closing, edited: false, locked: false };

test("{products} names the products picked, not the foundations they pull in", () => {
  assert.equal(placeholderValues(base, calculate(solstice, base), "Org").products, "Solstice Lakehouse and Nova Insight");
});

test("an earlier introduction and closing become the first and last custom sections, with their wording", () => {
  const estimate = mergeEstimate({ ...base, framing }, emptyEstimate());
  assert.deepEqual(estimate.customSections.map(({ id, title, templateId, templateName, edited, locked }) => ({ id, title, templateId, templateName, edited, locked })), [
    { id: "introduction", title: "Introduction", templateId: "purpose-introduction", templateName: "Introduction", edited: false, locked: false },
    { id: "closing", title: "Closing", templateId: "purpose-closing", templateName: "Closing", edited: false, locked: false },
  ]);
  assert.deepEqual(estimate.customSections[0].blocks, [{ kind: "text", text: template.introduction }]);
  assert.deepEqual([estimate.sectionLayout[0].id, estimate.sectionLayout.at(-1).id], ["introduction", "closing"]);
  const text = scopeText(solstice, estimate, "Org");
  assert.match(text, /\n1\. INTRODUCTION\nThis proof of concept helps Acme decide on Solstice Lakehouse and Nova Insight\.\n\nIt is run by Org\.\n\n2\. GOAL\n/);
  assert.match(text, /\d+\. CLOSING\n.+ ends with a decision\. \{unknown\} stays\.$/);
});

test("an earlier introduction keeps its lock, an edited one stays edited, and a saved layout keeps its order", () => {
  assert.equal(mergeEstimate({ framing: { ...framing, locked: true, edited: true } }, emptyEstimate()).customSections[0].edited, false, "a locked copy cannot claim to be edited");
  assert.equal(mergeEstimate({ framing: { ...framing, locked: true } }, emptyEstimate()).customSections[0].locked, true);
  assert.equal(mergeEstimate({ framing: { ...framing, source: "custom", locked: true } }, emptyEstimate()).customSections[0].templateId, "", "wording written for the estimate came from no template");
  assert.deepEqual(mergeEstimate({ framing: { source: "nope", introduction: "x" } }, emptyEstimate()).customSections, [], "an unknown source is none");
  assert.deepEqual(mergeEstimate({ framing: { source: "custom", introduction: "  ", closing: "Bye" } }, emptyEstimate()).customSections.map((item) => item.id), ["closing"], "an empty part adds no section");
  const layout = mergeEstimate({ framing, sectionLayout: [{ id: "assumptions" }, { id: "goal", hidden: true }] }, emptyEstimate()).sectionLayout;
  assert.deepEqual(layout, [{ id: "introduction", hidden: false }, { id: "assumptions", hidden: false }, { id: "goal", hidden: true }, { id: "closing", hidden: false }]);
});

test("earlier introduction and closing templates become section templates grouped under their name, and a converted copy is not offered an update", () => {
  const catalog = mergeCatalog({ ...solstice, documentTemplates: [template, { id: "locked", name: "Locked", introduction: "", closing: "Signed.", enabled: false, locked: true }, "junk"] }, defaultCatalog);
  assert.deepEqual(catalog.sectionTemplates.map((t) => [t.id, t.title, t.category, t.enabled, t.locked]), [
    ["purpose-introduction", "Introduction", "Purpose of the proof of concept", true, false],
    ["purpose-closing", "Closing", "Purpose of the proof of concept", true, false],
    ["locked-closing", "Closing", "Locked", false, true],
  ]);
  const converted = mergeEstimate({ framing }, emptyEstimate()).customSections[0];
  assert.equal(sectionTemplateChanged(catalog, converted), null);
  assert.deepEqual(sectionFrom(catalog.sectionTemplates[0], converted.id), converted, "the same as adding the converted template today");
  const v1 = json("v1", "catalog.json");
  assert.match(lintCatalogFile({ ...v1, catalog: { ...v1.catalog, documentTemplates: [template] } }).map((m) => m.text).join("\n"), /documentTemplates is from an earlier format/);
});
