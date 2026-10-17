import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultCatalog, emptyEstimate } from "../app/lib/defaults.ts";
import { defaultTitle, estimateExport, framedText, framingFrom, isNewerStoredCatalog, mergeCatalog, mergeEstimate, parseEstimateExport, placeholderValues, calculate, readCatalogFile, readEstimateFile, readStoredCatalog, removeFromCatalog, scopeText, templateChanged, unknownPlaceholders } from "../app/lib/estimate.ts";
import { CATALOG_VERSION, ESTIMATE_VERSION, RELOAD_NEWER, RELOAD_OLDER, WRITTEN_BY, catalogDocument, catalogUpgrades, catalogWriteProblem, estimateUpgrades } from "../app/lib/formats.ts";
import { lintCatalog, lintCatalogFile } from "../app/lib/lint.ts";

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
  assert.equal(estimate.framing.source, "none");
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
  assert.deepEqual(read.catalog.documentTemplates, []);
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
  assert.deepEqual(old.documentTemplates, []);
  const stored = JSON.parse(JSON.stringify(catalogDocument({ ...old, documentTemplates: [{ id: "t", name: "T", introduction: "Hi", closing: "", enabled: true }] })));
  assert.equal(readStoredCatalog(stored, defaultCatalog).documentTemplates.length, 1);
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

test("a template's wording is copied into the estimate and filled in when printed", () => {
  const estimate = { ...base, framing: framingFrom(template) };
  const values = placeholderValues(estimate, calculate(solstice, estimate), "Org");
  assert.equal(values.products, "Solstice Lakehouse and Nova Insight", "the products picked, not the foundations they pull in");
  const printed = framedText(estimate, values);
  assert.deepEqual(printed.introduction, ["This proof of concept helps Acme decide on Solstice Lakehouse and Nova Insight.", "It is run by Org."]);
  assert.deepEqual(printed.closing, [`${defaultTitle(calculate(solstice, estimate))} ends with a decision. {unknown} stays.`]);
  const text = scopeText(solstice, estimate, "Org");
  assert.ok(text.indexOf("This proof of concept helps Acme") < text.indexOf("1. GOAL"), "the introduction comes before the numbered sections");
  assert.ok(text.trimEnd().endsWith("{unknown} stays."), "the closing comes last");
  assert.deepEqual(unknownPlaceholders(template.closing), ["unknown"]);
  assert.deepEqual(framedText({ ...estimate, framing: { ...estimate.framing, source: "none" } }, values), { introduction: [], closing: [] });
});

test("a catalog edit never changes an estimate's wording, but is offered", () => {
  const estimate = { ...base, framing: framingFrom(template) };
  const revised = { ...solstice, documentTemplates: [{ ...template, introduction: "Revised wording." }] };
  assert.equal(templateChanged({ ...solstice, documentTemplates: [template] }, estimate.framing), null);
  assert.equal(templateChanged(revised, estimate.framing)?.introduction, "Revised wording.");
  assert.match(scopeText(revised, estimate, "Org"), /This proof of concept helps Acme/, "printed from the estimate's copy");
  assert.equal(templateChanged(revised, { ...estimate.framing, edited: true }), null, "an edited copy is the architect's own");
  assert.match(scopeText({ ...solstice, documentTemplates: [] }, estimate, "Org"), /This proof of concept helps Acme/, "deleting the template changes nothing either");
});

test("locked wording is copied locked, never marked edited, and a change of lock is offered", () => {
  const locked = { ...template, locked: true };
  const framing = framingFrom(locked);
  assert.equal(framing.locked, true);
  assert.equal(mergeEstimate({ framing: { ...framing, edited: true } }, emptyEstimate()).framing.edited, false, "a locked copy cannot claim to be edited");
  assert.equal(mergeEstimate({ framing: { ...framing, source: "custom" } }, emptyEstimate()).framing.locked, false, "only a template's wording can be locked");
  assert.equal(templateChanged({ ...solstice, documentTemplates: [locked] }, framingFrom(template))?.locked, true, "locking a template is offered to estimates that use it");
  assert.equal(templateChanged({ ...solstice, documentTemplates: [locked] }, { ...framingFrom(template), edited: true })?.locked, true, "even to estimates that edited their copy");
  assert.equal(mergeCatalog({ ...solstice, documentTemplates: [{ ...template, locked: undefined }] }, defaultCatalog).documentTemplates[0].locked, false, "unlocked unless the catalog says so");
});

test("introduction and closing survive a save and reload, and junk is cleaned", () => {
  const estimate = { ...base, framing: { ...framingFrom(template), edited: true } };
  const back = parseEstimateExport(JSON.parse(JSON.stringify(estimateExport(solstice, estimate))), emptyEstimate());
  assert.deepEqual(back.framing, estimate.framing);
  assert.deepEqual(mergeEstimate({ framing: { source: "custom", templateId: "x", introduction: "Mine", closing: 7, edited: true } }, emptyEstimate()).framing, { source: "custom", templateId: "", templateName: "", introduction: "Mine", closing: "", edited: false, locked: false });
  assert.equal(mergeEstimate({ framing: { source: "nope", introduction: "x" } }, emptyEstimate()).framing.introduction, "", "an unknown source is none");
});

test("templates in the catalog: merged, removed, and checked", () => {
  const catalog = mergeCatalog({ ...solstice, documentTemplates: [template, { id: "empty", name: "Empty", enabled: false }, "junk"] }, defaultCatalog);
  assert.deepEqual(catalog.documentTemplates.map((item) => [item.id, item.enabled]), [["purpose", true], ["empty", false]]);
  assert.deepEqual(removeFromCatalog(catalog, { documentTemplates: ["purpose"] }).documentTemplates.map((item) => item.id), ["empty"]);
  const text = lintCatalog(catalog, defaultCatalog).map((m) => m.text).join("\n");
  assert.match(text, /"purpose": \{unknown\} is not a placeholder/);
  assert.match(text, /"empty": no introduction and no closing/);
});
