/**
 * Explain what is wrong with a catalog file, in words a person or a language
 * model can act on. Used by `npm run catalog:check` and by the import dialog.
 * Pure: no I/O.
 */
import { mergeCatalog } from "./estimate.ts";
import { phases } from "./types.ts";
import type { Catalog } from "./types.ts";

export type LintMessage = { level: "error" | "warning"; text: string };

const TOP_LEVEL = ["format", "version", "exportedAt", "catalog", "$schema"];
const SECTIONS = ["products", "installation", "prerequisites", "groups", "solutions"];
const OPTIONAL_SECTIONS = ["outOfScope"];

/** Structural problems that prevent import or signal the wrong shape. */
export function lintCatalogFile(data: unknown): LintMessage[] {
  const out: LintMessage[] = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) return [{ level: "error", text: "The file must be a JSON object." }];
  const d = data as Record<string, unknown>;
  const unknownTop = Object.keys(d).filter((key) => !TOP_LEVEL.includes(key));
  if (!d.catalog || typeof d.catalog !== "object") {
    out.push({ level: "error", text: 'Missing the top-level "catalog" object. The file must be { "format": "scopewright-catalog", "version": 1, "catalog": { products, installation, prerequisites, groups, solutions } }.' });
    if (unknownTop.length) out.push({ level: "error", text: `Unexpected top-level keys: ${unknownTop.join(", ")}. Scopewright has no notion of these; see docs/authoring.md, "Common mistakes".` });
    return out;
  }
  if (unknownTop.length) out.push({ level: "warning", text: `Ignored top-level keys: ${unknownTop.join(", ")}.` });
  if (d.format !== "scopewright-catalog") out.push({ level: "warning", text: `"format" should be "scopewright-catalog" (found ${JSON.stringify(d.format)}).` });
  const c = d.catalog as Record<string, unknown>;
  for (const key of SECTIONS) if (!(key in c)) out.push({ level: "error", text: `catalog.${key} is missing (use [] or {} when empty).` });
  for (const key of Object.keys(c)) if (!SECTIONS.includes(key) && !OPTIONAL_SECTIONS.includes(key)) out.push({ level: "warning", text: `catalog.${key} is not a Scopewright section and will be ignored.` });
  if (!Array.isArray(c.products)) out.push({ level: "error", text: "catalog.products must be an array of products." });
  if (c.installation && (typeof c.installation !== "object" || Array.isArray(c.installation))) out.push({ level: "error", text: "catalog.installation must be an object keyed by product id, not a list." });
  if (c.prerequisites && (typeof c.prerequisites !== "object" || Array.isArray(c.prerequisites))) out.push({ level: "error", text: "catalog.prerequisites must be an object keyed by product id (each product lists what the customer provides), not a flat list." });
  if (c.outOfScope !== undefined && !Array.isArray(c.outOfScope)) out.push({ level: "error", text: 'catalog.outOfScope must be an array of { "id", "label" } items.' });
  if (c.groups && !Array.isArray(c.groups)) out.push({ level: "error", text: "catalog.groups must be an array of deliverable groups, each with tasks." });
  return out;
}

/** Semantic advice on a catalog that already has the right shape. */
export function lintCatalog(raw: unknown, initial: Catalog): LintMessage[] {
  const out: LintMessage[] = [];
  const c = (raw ?? {}) as Partial<Catalog> & Record<string, unknown>;
  const merged = mergeCatalog(raw, initial);
  const ids = new Set(merged.products.map((p) => p.id));
  const rawProducts = Array.isArray(c.products) ? (c.products as Record<string, unknown>[]) : [];
  const rawIds = rawProducts.map((p) => p?.id).filter((v): v is string => typeof v === "string");
  const dupes = rawIds.filter((v, i) => rawIds.indexOf(v) !== i);
  if (dupes.length) out.push({ level: "error", text: `Duplicate product ids: ${[...new Set(dupes)].join(", ")}.` });
  for (const p of rawProducts) {
    if (!p || typeof p !== "object") { out.push({ level: "error", text: `products contains a non-object entry (${JSON.stringify(p)}); it will be dropped.` }); continue; }
    for (const key of ["id", "name", "short", "portfolio", "mark"]) if (typeof p[key] !== "string") out.push({ level: "error", text: `Product ${JSON.stringify(p.id ?? "?")}: "${key}" must be a string.` });
    if (typeof p.hours !== "number") out.push({ level: "warning", text: `Product ${JSON.stringify(p.id)}: "hours" missing or not a number; treated as 0.` });
    for (const dep of Array.isArray(p.requires) ? p.requires : []) if (typeof dep !== "string" || !rawIds.includes(dep)) out.push({ level: "error", text: `Product ${JSON.stringify(p.id)} requires ${JSON.stringify(dep)}, which is not a product id; dropped.` });
    for (const key of Object.keys(p)) if (!["id", "name", "short", "portfolio", "mark", "hours", "description", "requires"].includes(key)) out.push({ level: "warning", text: `Product ${JSON.stringify(p.id)}: unknown field "${key}" ignored.` });
  }
  for (const [section, value] of [["installation", c.installation], ["prerequisites", c.prerequisites]] as const) {
    for (const key of Object.keys((value ?? {}) as object)) if (!ids.has(key)) out.push({ level: "error", text: `catalog.${section}.${key}: no product with id "${key}"; section dropped.` });
  }
  for (const [productId, fields] of Object.entries(merged.installation)) for (const field of fields) {
    if (field.choices.length < 2) out.push({ level: "warning", text: `${productId} / "${field.label}": a question should offer at least two choices.` });
    if (field.choices.every((ch) => ch.hours === 0)) out.push({ level: "warning", text: `${productId} / "${field.label}": every choice is 0 hours, so the question changes nothing.` });
  }
  const rawGroups = Array.isArray(c.groups) ? (c.groups as Record<string, unknown>[]) : [];
  for (const g of rawGroups) {
    if (!g || typeof g !== "object") continue;
    if (typeof g.productId !== "string") out.push({ level: "error", text: `Group ${JSON.stringify(g.id)}: "productId" is required ("" for engagement-wide groups).` });
    else if (g.productId && !ids.has(g.productId)) out.push({ level: "error", text: `Group ${JSON.stringify(g.id)}: productId "${g.productId}" is not a product; treated as engagement-wide.` });
    for (const t of Array.isArray(g.tasks) ? (g.tasks as Record<string, unknown>[]) : []) {
      if (t && typeof t === "object" && typeof t.phase === "string" && !(phases as readonly string[]).includes(t.phase)) out.push({ level: "error", text: `Task ${JSON.stringify(t.id)}: phase "${t.phase}" is not one of ${phases.join(", ")}; treated as Deployment.` });
      if (t && typeof t === "object" && typeof t.hours !== "number") out.push({ level: "warning", text: `Task ${JSON.stringify(t.id)}: "hours" missing or not a number; treated as 0.` });
    }
  }
  for (const s of Array.isArray(c.solutions) ? (c.solutions as Record<string, unknown>[]) : []) {
    for (const pid of Array.isArray(s?.products) ? s.products : []) if (!ids.has(pid as string)) out.push({ level: "error", text: `Solution ${JSON.stringify(s.id)}: product "${pid}" does not exist; dropped.` });
  }
  for (const p of merged.products) {
    const has = (merged.installation[p.id]?.length ?? 0) + (merged.prerequisites[p.id]?.length ?? 0) + merged.groups.filter((g) => g.productId === p.id).length;
    if (!has) out.push({ level: "warning", text: `Product "${p.id}" has no installation questions, prerequisites, or deliverable groups; it will estimate at ${p.hours}h with nothing to show.` });
  }
  const seen = new Set<string>();
  const visit = (id: string, trail: string[]) => { if (trail.includes(id)) { out.push({ level: "error", text: `Circular requires: ${[...trail, id].join(" → ")}.` }); return; } if (seen.has(id)) return; seen.add(id); for (const dep of merged.products.find((p) => p.id === id)?.requires ?? []) visit(dep, [...trail, id]); };
  for (const p of merged.products) visit(p.id, []);
  return out;
}
