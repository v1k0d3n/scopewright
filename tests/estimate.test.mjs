import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { emptyEstimate } from "../app/lib/defaults.ts";

/** The fictitious Solstice pack is the reference catalog; the app itself ships empty. */
const defaultCatalog = JSON.parse(readFileSync(new URL("../packs/solstice/catalog.json", import.meta.url), "utf8")).catalog;
import { availableGroups, calculate, estimateExport, mergeCatalog, mergeEstimate, parseEstimateExport, resolveProducts, scopeText } from "../app/lib/estimate.ts";

test("foundations are added transitively and ordered before dependents", () => {
  assert.deepEqual(resolveProducts(["lakehouse"], defaultCatalog.products), ["core", "streams", "lakehouse"]);
  assert.deepEqual(resolveProducts(["vision", "sentinel"], defaultCatalog.products), ["core", "edge", "streams", "lakehouse", "insight", "vision", "sentinel"]);
  assert.deepEqual(resolveProducts(["missing"], defaultCatalog.products), []);
});

test("a changed installation choice changes the total", () => {
  const estimate = { ...emptyEstimate(), products: ["core"] };
  const first = calculate(defaultCatalog, estimate);
  const footprint = defaultCatalog.installation.core.find((field) => field.id === "footprint");
  const zones = footprint.choices.find((choice) => choice.id === "zones");
  const lab = footprint.choices[0];
  const second = calculate(defaultCatalog, { ...estimate, selections: { "core:footprint": "zones" } });
  assert.equal(second.total - first.total, zones.hours - lab.hours);
  assert.equal(second.products[0].decisions.find((d) => d.field.id === "footprint").choice.id, "zones");
});

test("an existing environment contributes no installation hours but keeps its deliverables", () => {
  const estimate = { ...emptyEstimate(), products: ["streams"], environments: { core: "existing" }, selectedTasks: ["core-monitor"] };
  const result = calculate(defaultCatalog, estimate);
  const core = result.products.find((item) => item.product.id === "core");
  assert.equal(core.foundation, true);
  assert.equal(core.hours, 0);
  assert.equal(result.deliverableHours, 3);
  assert.ok(result.products.find((item) => item.product.id === "streams").hours > 0);
});

test("deliverables are offered only for products in the engagement", () => {
  const ids = availableGroups(defaultCatalog, ["core", "sentinel"]).map((group) => group.id);
  assert.ok(ids.includes("engagement"), "unscoped groups always apply");
  assert.ok(ids.includes("sentinel-rollout"));
  assert.ok(!ids.includes("vision-usecase"), "vision deliverables are not offered without Nova Vision");
  const disabled = availableGroups({ ...defaultCatalog, groups: [{ id: "g", name: "g", category: "c", productId: "", tasks: [{ id: "t", name: "t", phase: "Planning", hours: 1, enabled: false }] }] }, []);
  assert.deepEqual(disabled, []);
});

test("scope text carries every decision and its hours", () => {
  const estimate = { ...emptyEstimate(), customer: "ACME", products: ["core"], selections: { "core:connectivity": "airgap" }, details: { core: [{ id: "x", description: "Custom DNS", hours: 2 }] }, selectedTasks: ["core-monitor"] };
  const text = scopeText(defaultCatalog, estimate, "Solstice Systems");
  assert.match(text, /^ACME — Core Proof of Concept/);
  assert.match(text, /Network connectivity: Air-gapped with mirrored registry \(4 hours\)/);
  assert.match(text, /Custom DNS \(2 hours\)/);
  assert.match(text, /2\.1\. Enable monitoring, alerting, and log forwarding/);
  assert.match(text, /Total: \d+ hours/);
});

test("prerequisites are pre-populated per product and merged with answers and additions", () => {
  const estimate = { ...emptyEstimate(), products: ["streams"], prerequisites: { "core:api-vip": { value: "10.0.0.5", status: "provided" } }, customPrerequisites: { core: [{ id: "c1", label: "Change window", value: "", status: "pending" }] } };
  const result = calculate(defaultCatalog, estimate);
  const core = result.prerequisites.find((item) => item.product.id === "core");
  assert.equal(core.items.find((item) => item.id === "api-vip").value, "10.0.0.5");
  assert.ok(core.items.some((item) => item.custom && item.label === "Change window"));
  const required = core.items.filter((item) => item.required).length;
  assert.equal(core.pending, required - 1, "everything required except the answered VIP is pending");
  assert.ok(result.prerequisites.some((item) => item.product.id === "streams"));
  assert.match(scopeText(defaultCatalog, estimate, "Solstice Systems"), /Control plane VIP: 10\.0\.0\.5 \[Provided\]/);
});

test("estimate export round-trips and rejects other files", () => {
  const estimate = { ...emptyEstimate(), customer: "ACME", products: ["edge"], selections: { "edge:provisioning": "ztp" } };
  const file = estimateExport(defaultCatalog, estimate);
  assert.equal(file.format, "scopewright-estimate");
  assert.equal(file.summary.customer, "ACME");
  const back = parseEstimateExport(JSON.parse(JSON.stringify(file)), emptyEstimate());
  assert.deepEqual(back.selections, estimate.selections);
  assert.equal(parseEstimateExport({ format: "scopewright-catalog", version: 1 }, emptyEstimate()), null);
  const upgraded = mergeEstimate({ customer: "Old", products: ["core"] }, emptyEstimate());
  assert.deepEqual(upgraded.prerequisites, {});
  assert.equal(upgraded.customer, "Old");
});

test("catalog merge fills in prerequisites for older exports", () => {
  const old = { products: defaultCatalog.products, installation: {}, groups: [] };
  assert.equal(mergeCatalog(old, defaultCatalog).prerequisites, defaultCatalog.prerequisites);
});

test("catalog merge keeps solutions from an older export and accepts an empty list", () => {
  const old = { products: defaultCatalog.products, installation: {}, groups: [] };
  assert.equal(mergeCatalog(old, defaultCatalog).solutions, defaultCatalog.solutions);
  assert.deepEqual(mergeCatalog({ ...old, solutions: [] }, defaultCatalog).solutions, []);
});
