import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { emptyEstimate } from "../app/lib/defaults.ts";
import { availableGroups, calculate, catalogChanges, estimateExport, mergeCatalog, mergeEstimate, parseEstimateExport, needsAttention, removeFromCatalog, resolveProducts } from "../app/lib/estimate.ts";
import { scopeText } from "../app/lib/document.ts";

/** The fictitious Solstice pack is the reference catalog; the app itself ships empty. */
const emptyCatalog = { products: [], installation: {}, prerequisites: {}, groups: [], solutions: [], outOfScope: [] };
const defaultCatalog = mergeCatalog(JSON.parse(readFileSync(new URL("../packs/solstice/catalog.json", import.meta.url), "utf8")).catalog, emptyCatalog);

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

test("a task turned off in the catalog stays in estimates that already selected it (#45)", () => {
  const group = defaultCatalog.groups.find((item) => item.tasks.some((task) => task.id === "core-monitor"));
  const catalog = { ...defaultCatalog, groups: defaultCatalog.groups.map((item) => item.id === group.id ? { ...item, tasks: item.tasks.map((task) => task.id === "core-monitor" ? { ...task, enabled: false } : task) } : item) };
  const offered = (keep) => availableGroups(catalog, ["core"], keep).flatMap((item) => item.tasks.map((task) => task.id));
  assert.ok(!offered().includes("core-monitor"), "not offered to an estimate that has not selected it");
  assert.ok(offered(["core-monitor"]).includes("core-monitor"), "still listed where it is selected, so it can be cleared");
  const estimate = { ...emptyEstimate(), products: ["core"], selectedTasks: ["core-monitor"] };
  assert.equal(calculate(catalog, estimate).deliverableHours, calculate(defaultCatalog, estimate).deliverableHours);
  assert.match(scopeText(catalog, estimate, "Org"), /Enable monitoring, alerting, and log forwarding/);
});

test("an answer removed from the catalog is never replaced by a different one (#44)", () => {
  const footprint = defaultCatalog.installation.core.find((field) => field.id === "footprint");
  const zones = footprint.choices.find((choice) => choice.id === "zones");
  const catalog = { ...defaultCatalog, installation: { ...defaultCatalog.installation, core: defaultCatalog.installation.core.map((field) => field.id === "footprint" ? { ...field, choices: field.choices.filter((choice) => choice.id !== "zones") } : field) } };
  const estimate = { ...emptyEstimate(), products: ["core"], selections: { "core:footprint": "zones" } };
  const before = calculate(defaultCatalog, estimate);
  const after = calculate(catalog, estimate);
  const core = after.products.find((item) => item.product.id === "core");
  assert.deepEqual(core.unanswered.map((field) => field.id), ["footprint"]);
  assert.ok(!core.decisions.some((decision) => decision.field.id === "footprint"), "no answer is substituted");
  assert.equal(after.unansweredQuestions, 1);
  assert.equal(before.total - after.total, zones.hours, "the removed answer's hours are not counted, and nothing else's are added");
  assert.match(scopeText(catalog, estimate, "Org"), /- Control plane footprint: To be decided/);
  // A question never answered still defaults to its first choice.
  const fresh = calculate(catalog, { ...estimate, selections: {} }).products.find((item) => item.product.id === "core");
  assert.equal(fresh.unanswered.length, 0);
  assert.equal(fresh.decisions.find((decision) => decision.field.id === "footprint").choice.id, footprint.choices[0].id);
  // An existing environment asks no installation questions, so nothing is unanswered.
  assert.equal(calculate(catalog, { ...estimate, environments: { core: "existing" } }).unansweredQuestions, 0);
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

test("hours can be hidden from the scope text, and sections stay numbered without gaps", () => {
  const base = { ...emptyEstimate(), customer: "ACME", products: ["core"], selectedTasks: ["core-monitor"], customOutOfScope: "Production hardening\n\n  Data migration  " };
  const withHours = scopeText(defaultCatalog, base, "Solstice Systems");
  assert.match(withHours, /\(\d+ hours\)/);
  assert.match(withHours, /6\. OUT OF SCOPE\n- Production hardening\n- Data migration\n/);
  assert.match(withHours, /7\. EFFORT SUMMARY/);
  assert.match(withHours, /9\. ASSUMPTIONS/);
  const without = scopeText(defaultCatalog, { ...base, options: { showHours: false } }, "Solstice Systems");
  assert.doesNotMatch(without, /hours/i);
  assert.doesNotMatch(without, /EFFORT SUMMARY/);
  assert.match(without, /2\.1\. Enable monitoring, alerting, and log forwarding \(Configuration\)/);
  assert.match(without, /7\. SUCCESS CRITERIA/);
  assert.match(without, /8\. ASSUMPTIONS/);
  const none = scopeText(defaultCatalog, { ...emptyEstimate(), products: ["core"] }, "Solstice Systems");
  assert.doesNotMatch(none, /OUT OF SCOPE/);
  assert.match(none, /6\. EFFORT SUMMARY/);
});

test("catalog out-of-scope items are chosen by id and sanitized", () => {
  const catalog = mergeCatalog({ ...defaultCatalog, outOfScope: [{ id: "perf", label: "Performance benchmarking" }, { id: "blank", label: "" }, "junk", { id: "dr", label: "Disaster recovery design" }] }, defaultCatalog);
  assert.deepEqual(catalog.outOfScope.map((item) => item.id), ["perf", "dr"]);
  const estimate = mergeEstimate({ products: ["core"], outOfScope: ["dr", "ghost", 7], customOutOfScope: "Training" }, emptyEstimate());
  assert.deepEqual(estimate.outOfScope, ["dr", "ghost"]);
  assert.equal(estimate.options.showHours, true, "older estimates default to showing hours");
  assert.match(scopeText(catalog, estimate, "X"), /OUT OF SCOPE\n- Disaster recovery design\n- Training\n/);
  // A catalog from before this section existed gets the app's default, which is none (the app ships with an empty catalog).
  assert.deepEqual(mergeCatalog({ products: [], installation: {}, prerequisites: {}, groups: [], solutions: [] }, emptyCatalog).outOfScope, []);
});

test("deleting products takes their questions, prerequisites, groups, and references with them", () => {
  const next = removeFromCatalog(defaultCatalog, { products: ["edge", "fleet"] });
  assert.deepEqual(next.products.map((product) => product.id).filter((id) => ["edge", "fleet"].includes(id)), []);
  assert.equal(next.installation.edge, undefined);
  assert.equal(next.prerequisites.fleet, undefined);
  assert.deepEqual(next.groups.filter((group) => ["edge", "fleet"].includes(group.productId)), []);
  assert.ok(next.groups.some((group) => group.productId === ""), "groups for any product stay");
  assert.deepEqual(next.products.find((product) => product.id === "vision").requires, ["insight"], "foundations drop the deleted product");
  assert.deepEqual(next.solutions.find((solution) => solution.id === "fleet").products, ["core", "conductor"], "solutions drop the deleted product but stay");
  assert.equal(defaultCatalog.products.some((product) => product.id === "edge"), true, "the input is not changed");
});

test("deleting questions and prerequisites is scoped to their product", () => {
  const [field] = defaultCatalog.installation.core;
  const [prereq] = defaultCatalog.prerequisites.core;
  const next = removeFromCatalog(defaultCatalog, { fields: [{ productId: "core", itemId: field.id }], prerequisites: [{ productId: "core", itemId: prereq.id }] });
  assert.equal(next.installation.core.length, defaultCatalog.installation.core.length - 1);
  assert.equal(next.prerequisites.core.length, defaultCatalog.prerequisites.core.length - 1);
  assert.deepEqual(next.installation.edge, defaultCatalog.installation.edge);
  assert.equal(next.products.length, defaultCatalog.products.length);
});

test("deleting solutions, groups, and out-of-scope items removes only those", () => {
  const next = removeFromCatalog(defaultCatalog, { solutions: ["vision"], groups: ["engagement"], outOfScope: defaultCatalog.outOfScope.slice(0, 1).map((item) => item.id) });
  assert.deepEqual(next.solutions.map((solution) => solution.id), ["streaming", "fleet", "zerotrust"]);
  assert.equal(next.groups.some((group) => group.id === "engagement"), false);
  assert.equal(next.groups.length, defaultCatalog.groups.length - 1);
  assert.equal(next.outOfScope.length, Math.max(0, defaultCatalog.outOfScope.length - 1));
});

test("deleting a question is exact even when ids contain a colon", () => {
  const field = (id) => ({ id, label: id, choices: [{ id: "one", label: "One", hours: 0 }] });
  const catalog = { ...emptyCatalog, products: [{ id: "a", name: "A", short: "A", portfolio: "P", mark: "A", hours: 0 }, { id: "a:b", name: "AB", short: "AB", portfolio: "P", mark: "AB", hours: 0 }], installation: { a: [field("b:c")], "a:b": [field("c")] } };
  // Joined with ":", both of these would be "a:b:c".
  const next = removeFromCatalog(catalog, { fields: [{ productId: "a:b", itemId: "c" }] });
  assert.deepEqual(next.installation["a:b"], []);
  assert.deepEqual(next.installation.a.map((item) => item.id), ["b:c"]);
});

test("catalog changes report, by section, what an opened estimate needs", () => {
  const unchanged = catalogChanges(defaultCatalog, { ...emptyEstimate(), products: ["core"], selections: { "core:footprint": "zones" }, selectedTasks: ["core-monitor"] });
  assert.deepEqual(unchanged, { removedProducts: [], unanswered: [], retiredTasks: [] });
  assert.equal(needsAttention(unchanged), false);
  const catalog = {
    ...defaultCatalog,
    installation: { ...defaultCatalog.installation, core: defaultCatalog.installation.core.map((field) => field.id === "footprint" ? { ...field, choices: field.choices.filter((choice) => choice.id !== "zones") } : field) },
    groups: defaultCatalog.groups.map((group) => ({ ...group, tasks: group.tasks.map((task) => task.id === "core-monitor" ? { ...task, enabled: false } : task) })),
  };
  const changes = catalogChanges(catalog, { ...emptyEstimate(), products: ["core", "gone"], selections: { "core:footprint": "zones" }, selectedTasks: ["core-monitor"] });
  assert.deepEqual(changes.removedProducts, ["gone"]);
  assert.deepEqual(changes.unanswered.map(({ product, field }) => `${product.id}:${field.id}`), ["core:footprint"]);
  assert.deepEqual(changes.retiredTasks.map(({ task }) => task.id), ["core-monitor"]);
  assert.equal(needsAttention(changes), true);
  // A kept task alone is reported, but asks nothing of the architect.
  assert.equal(needsAttention({ ...changes, removedProducts: [], unanswered: [] }), false);
});
