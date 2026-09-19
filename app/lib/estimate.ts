import type { Catalog, DeliverableGroup, Estimate, InstallationChoice, InstallationField, PrerequisiteAnswer, PrerequisiteItem, PrerequisiteStatus, Product } from "./types.ts";
import { phases, prerequisiteStatuses } from "./types.ts";
import { bool, hours as num, id, list, objectOrNull, record, text } from "./sanitize.ts";

/** Selected products plus every foundation they transitively require, in dependency order. */
export function resolveProducts(selected: string[], products: Product[]): string[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  const ordered: string[] = [];
  const visit = (id: string, trail: string[]) => {
    if (ordered.includes(id) || trail.includes(id) || !byId.has(id)) return;
    for (const dep of byId.get(id)?.requires ?? []) visit(dep, [...trail, id]);
    ordered.push(id);
  };
  for (const id of selected) visit(id, []);
  return ordered;
}

export const selectionKey = (productId: string, fieldId: string) => `${productId}:${fieldId}`;

/** The chosen answer for a field, falling back to the first choice. */
export function chosen(field: InstallationField, estimate: Estimate, productId: string): InstallationChoice | undefined {
  const id = estimate.selections[selectionKey(productId, field.id)];
  return field.choices.find((choice) => choice.id === id) ?? field.choices[0];
}

export type ProductBreakdown = {
  product: Product;
  /** True when the SA did not pick it but a selected product requires it. */
  foundation: boolean;
  existing: boolean;
  baseHours: number;
  decisions: { field: InstallationField; choice: InstallationChoice }[];
  decisionHours: number;
  detailHours: number;
  hours: number;
};

export type PrerequisiteLine = { id: string; label: string; help?: string; placeholder?: string; required: boolean; custom: boolean; value: string; status: PrerequisiteStatus };
export type PrerequisiteBreakdown = { product: Product; existing: boolean; items: PrerequisiteLine[]; pending: number };

export type DeliverableBreakdown = { group: DeliverableGroup; tasks: DeliverableGroup["tasks"]; hours: number };

export type EstimateBreakdown = {
  products: ProductBreakdown[];
  prerequisites: PrerequisiteBreakdown[];
  pendingPrerequisites: number;
  deliverables: DeliverableBreakdown[];
  installationHours: number;
  deliverableHours: number;
  total: number;
  days: number;
  low: number;
  high: number;
};

/** Groups offered in the Deliverables step: unscoped groups plus those tied to a product in the engagement. */
export function availableGroups(catalog: Catalog, productIds: string[]): DeliverableGroup[] {
  return catalog.groups
    .filter((group) => !group.productId || productIds.includes(group.productId))
    .map((group) => ({ ...group, tasks: group.tasks.filter((task) => task.enabled) }))
    .filter((group) => group.tasks.length > 0);
}

export const prerequisiteKey = (productId: string, itemId: string) => `${productId}:${itemId}`;
const emptyAnswer: PrerequisiteAnswer = { value: "", status: "pending" };

/** Catalog prerequisites for each product in the engagement, merged with the SA's answers and additions. */
export function prerequisitesFor(catalog: Catalog, estimate: Estimate, productIds: string[]): PrerequisiteBreakdown[] {
  return productIds.flatMap((id) => {
    const product = catalog.products.find((item) => item.id === id);
    if (!product) return [];
    const fromCatalog: PrerequisiteLine[] = (catalog.prerequisites[id] ?? []).map((item: PrerequisiteItem) => {
      const answer = estimate.prerequisites[prerequisiteKey(id, item.id)] ?? emptyAnswer;
      return { id: item.id, label: item.label, help: item.help, placeholder: item.placeholder, required: item.required, custom: false, value: answer.value, status: answer.status };
    });
    const custom: PrerequisiteLine[] = (estimate.customPrerequisites[id] ?? []).map((item) => ({ id: item.id, label: item.label, required: true, custom: true, value: item.value, status: item.status }));
    const items = [...fromCatalog, ...custom];
    if (!items.length) return [];
    return [{ product, existing: estimate.environments[id] === "existing", items, pending: items.filter((item) => item.status === "pending" && item.required).length }];
  });
}

export function calculate(catalog: Catalog, estimate: Estimate): EstimateBreakdown {
  const ids = resolveProducts(estimate.products, catalog.products);
  const products: ProductBreakdown[] = ids.flatMap((id) => {
    const product = catalog.products.find((item) => item.id === id);
    if (!product) return [];
    const existing = estimate.environments[id] === "existing";
    const decisions = existing ? [] : (catalog.installation[id] ?? []).flatMap((field) => {
      const choice = chosen(field, estimate, id);
      return choice ? [{ field, choice }] : [];
    });
    const baseHours = existing ? 0 : product.hours;
    const decisionHours = decisions.reduce((sum, item) => sum + (Number(item.choice.hours) || 0), 0);
    const detailHours = (estimate.details[id] ?? []).reduce((sum, line) => sum + (Number(line.hours) || 0), 0);
    return [{ product, foundation: !estimate.products.includes(id), existing, baseHours, decisions, decisionHours, detailHours, hours: baseHours + decisionHours + detailHours }];
  });
  const deliverables: DeliverableBreakdown[] = availableGroups(catalog, ids)
    .map((group) => ({ group, tasks: group.tasks.filter((task) => estimate.selectedTasks.includes(task.id)) }))
    .filter((item) => item.tasks.length)
    .map((item) => ({ ...item, hours: item.tasks.reduce((sum, task) => sum + (Number(task.hours) || 0), 0) }));
  const prerequisites = prerequisitesFor(catalog, estimate, ids);
  const installationHours = products.reduce((sum, item) => sum + item.hours, 0);
  const deliverableHours = deliverables.reduce((sum, item) => sum + item.hours, 0);
  const total = installationHours + deliverableHours;
  return {
    products,
    prerequisites,
    pendingPrerequisites: prerequisites.reduce((sum, item) => sum + item.pending, 0),
    deliverables,
    installationHours,
    deliverableHours,
    total,
    days: Math.round((total / 8) * 10) / 10,
    low: Math.ceil(total * 0.8),
    high: Math.ceil(total * 1.2),
  };
}

export const groupHours = (group: DeliverableGroup) => group.tasks.reduce((sum, task) => sum + (Number(task.hours) || 0), 0);

/** Out-of-scope lines for an estimate: chosen catalog items (in catalog order) then the free-text ones. */
export function outOfScopeLines(catalog: Catalog, estimate: Estimate): string[] {
  // Tolerate catalogs and estimates written before this section existed.
  const chosen = (catalog.outOfScope ?? []).filter((item) => (estimate.outOfScope ?? []).includes(item.id)).map((item) => item.label);
  const custom = (estimate.customOutOfScope ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  return [...chosen, ...custom];
}

/** Plain-text rendering of the scope document, for pasting into email or a ticket. */
export function scopeText(catalog: Catalog, estimate: Estimate, orgName: string): string {
  const breakdown = calculate(catalog, estimate);
  const title = estimate.title || defaultTitle(breakdown);
  const showHours = estimate.options?.showHours ?? true;
  const h = (hours: number, extra = "") => (showHours ? ` (${hours} hours${extra})` : extra ? ` (${extra.replace(/^, /, "")})` : "");
  let n = 0;
  const section = (name: string) => `${++n}. ${name}`;
  const lines: string[] = [`${estimate.customer || "Customer"} — ${title}`, `Prepared by ${orgName}`, ""];
  lines.push(section("GOAL"), estimate.goal || "Goal to be defined.", "");
  lines.push(section("PRODUCTS IN SCOPE"));
  for (const item of breakdown.products) lines.push(`- ${item.product.name}: ${item.existing ? "existing environment" : "new deployment"}${item.foundation ? " (required foundation)" : ""}`);
  lines.push("", section("INSTALLATION SCOPE"));
  for (const item of breakdown.products) {
    lines.push(item.product.name);
    if (item.existing) lines.push("- Existing environment validated; no installation effort.");
    if (item.baseHours && showHours) lines.push(`- Base work package${h(item.baseHours)}`);
    for (const decision of item.decisions) lines.push(`- ${decision.field.label}: ${decision.choice.label}${h(decision.choice.hours)}`);
    for (const line of estimate.details[item.product.id] ?? []) if (line.description) lines.push(`- ${line.description}${h(line.hours)}`);
    lines.push("");
  }
  lines.push(section("PREREQUISITES"));
  for (const item of breakdown.prerequisites) {
    lines.push(item.product.name);
    for (const line of item.items) lines.push(`- ${line.label}${line.required ? "" : " (optional)"}: ${line.value || "—"} [${statusLabel(line.status)}]`);
    lines.push("");
  }
  lines.push(section("DELIVERY PLAN"));
  for (const item of breakdown.deliverables) {
    lines.push(`${item.group.scopeNumber ? `${item.group.scopeNumber}. ` : ""}${item.group.name}`);
    for (const task of item.tasks) lines.push(`- ${task.scopeNumber ? `${task.scopeNumber}. ` : ""}${task.name}${h(task.hours, `, ${task.phase}`)}`);
  }
  lines.push("");
  const excluded = outOfScopeLines(catalog, estimate);
  if (excluded.length) lines.push(section("OUT OF SCOPE"), ...excluded.map((line) => `- ${line}`), "");
  if (showHours) lines.push(section("EFFORT SUMMARY"), `Installation: ${breakdown.installationHours} hours`, `Deliverables: ${breakdown.deliverableHours} hours`, `Total: ${breakdown.total} hours (planning range ${breakdown.low}–${breakdown.high})`, "");
  lines.push(section("SUCCESS CRITERIA"), ...estimate.successCriteria.split("\n").filter(Boolean).map((line) => `- ${line}`), "");
  lines.push(section("ASSUMPTIONS"), ...estimate.assumptions.split("\n").filter(Boolean).map((line) => `- ${line}`));
  return lines.join("\n");
}

export const defaultTitle = (breakdown: EstimateBreakdown) => `${breakdown.products.map((item) => item.product.short).join(" + ") || "Product"} Proof of Concept`;

export const statusLabel = (status: PrerequisiteStatus) => status === "provided" ? "Provided" : status === "not-applicable" ? "Not applicable" : "Pending";

/**
 * Build a Catalog from untrusted input (a stored document, an API body, or an
 * imported file). Malformed entries are dropped; malformed fields fall back.
 * Missing sections fall back to `initial`, so older files still load.
 */
export function mergeCatalog(stored: unknown, initial: Catalog): Catalog {
  const s = record(stored);
  const products = s.products === undefined ? initial.products : list(s.products, (item, index) => {
    const p = objectOrNull(item); if (!p) return null;
    const pid = id(p.id, `product-${index}`);
    return { id: pid, name: text(p.name, 120, pid), short: text(p.short, 40, pid), portfolio: text(p.portfolio, 60, "Products"), mark: text(p.mark, 3, pid.slice(0, 2).toUpperCase()), hours: num(p.hours), description: text(p.description, 300) || undefined, requires: list(p.requires, (dep) => (typeof dep === "string" && dep !== pid ? id(dep, "") || null : null)) };
  });
  const known = new Set(products.map((product) => product.id));
  // Foundations must exist; a dangling or self reference is dropped.
  for (const product of products) product.requires = (product.requires ?? []).filter((dep) => dep !== product.id && known.has(dep));
  const perProduct = <T>(value: unknown, map: (item: unknown, index: number) => T | null): Record<string, T[]> => Object.fromEntries(Object.entries(record(value)).filter(([key]) => known.has(key)).map(([key, items]) => [key, list(items, map)]));
  const installation = s.installation === undefined ? initial.installation : perProduct<InstallationField>(s.installation, (item, index) => {
    const f = objectOrNull(item); if (!f) return null;
    const choices = list(f.choices, (choice, ci) => { const c = objectOrNull(choice); if (!c) return null; return { id: id(c.id, `choice-${ci}`), label: text(c.label, 160, `Option ${ci + 1}`), hours: num(c.hours), note: text(c.note, 300) || undefined }; });
    return choices.length ? { id: id(f.id, `field-${index}`), label: text(f.label, 160, `Question ${index + 1}`), help: text(f.help, 300) || undefined, choices } : null;
  });
  const prerequisites = s.prerequisites === undefined ? initial.prerequisites : perProduct<PrerequisiteItem>(s.prerequisites, (item, index) => {
    const r = objectOrNull(item); if (!r) return null;
    return { id: id(r.id, `prereq-${index}`), label: text(r.label, 160, `Prerequisite ${index + 1}`), placeholder: text(r.placeholder, 200) || undefined, help: text(r.help, 300) || undefined, required: bool(r.required, true) };
  });
  const groups = s.groups === undefined ? initial.groups : list(s.groups, (item, index) => {
    const g = objectOrNull(item); if (!g) return null;
    const productId = typeof g.productId === "string" && known.has(g.productId) ? g.productId : "";
    return { id: id(g.id, `group-${index}`), name: text(g.name, 160, `Group ${index + 1}`), category: text(g.category, 60, "General"), productId, scopeNumber: text(g.scopeNumber, 12) || undefined, tasks: list(g.tasks, (task, ti) => { const t = objectOrNull(task); if (!t) return null; return { id: id(t.id, `task-${index}-${ti}`), name: text(t.name, 200, `Task ${ti + 1}`), phase: (phases as readonly string[]).includes(t.phase as string) ? (t.phase as (typeof phases)[number]) : "Deployment", hours: num(t.hours), enabled: bool(t.enabled, true), scopeNumber: text(t.scopeNumber, 12) || undefined }; }) };
  });
  const solutions = s.solutions === undefined ? initial.solutions : list(s.solutions, (item, index) => {
    const sol = objectOrNull(item); if (!sol) return null;
    return { id: id(sol.id, `solution-${index}`), label: text(sol.label, 24), title: text(sol.title, 120, `Solution ${index + 1}`), subtitle: text(sol.subtitle, 200), products: list(sol.products, (pid) => (typeof pid === "string" && known.has(pid) ? pid : null)) };
  });
  const outOfScope = s.outOfScope === undefined ? initial.outOfScope : list(s.outOfScope, (item, index) => {
    const o = objectOrNull(item); if (!o) return null;
    const label = text(o.label, 200);
    return label ? { id: id(o.id, `oos-${index}`), label } : null;
  });
  return { products, installation, prerequisites, groups, solutions, outOfScope };
}

export const isCatalog = (value: unknown): value is Catalog => {
  const c = value as Partial<Catalog> | undefined;
  return Boolean(c && Array.isArray(c.products) && c.installation && typeof c.installation === "object" && Array.isArray(c.groups));
};

/** Build an Estimate from untrusted input; malformed fields fall back to `initial`. */
export function mergeEstimate(stored: unknown, initial: Estimate): Estimate {
  const s = record(stored);
  const statuses = prerequisiteStatuses as readonly string[];
  const status = (value: unknown): PrerequisiteStatus => (statuses.includes(value as string) ? (value as PrerequisiteStatus) : "pending");
  const strMap = (value: unknown, allowed: (v: unknown) => boolean) => Object.fromEntries(Object.entries(record(value)).filter(([key, v]) => key.length <= 240 && allowed(v)).slice(0, MAX_MAP));
  return {
    customer: text(s.customer, 200, initial.customer),
    title: text(s.title, 200, initial.title),
    goal: text(s.goal, MAX_LONG, initial.goal),
    products: list(s.products, (pid) => (typeof pid === "string" ? id(pid, "") || null : null)),
    environments: strMap(s.environments, (v) => v === "new" || v === "existing") as Estimate["environments"],
    selections: strMap(s.selections, (v) => typeof v === "string" && v.length <= 120) as Estimate["selections"],
    details: Object.fromEntries(Object.entries(record(s.details)).slice(0, MAX_MAP).map(([key, lines]) => [key, list(lines, (line, index) => { const l = objectOrNull(line); if (!l) return null; return { id: id(l.id, `line-${index}`), description: text(l.description, 300), hours: num(l.hours) }; })])),
    prerequisites: Object.fromEntries(Object.entries(record(s.prerequisites)).slice(0, MAX_MAP).map(([key, answer]) => { const a = record(answer); return [key, { value: text(a.value, 500), status: status(a.status) } satisfies PrerequisiteAnswer]; })),
    customPrerequisites: Object.fromEntries(Object.entries(record(s.customPrerequisites)).slice(0, MAX_MAP).map(([key, items]) => [key, list(items, (item, index) => { const c = objectOrNull(item); if (!c) return null; return { id: id(c.id, `prereq-${index}`), label: text(c.label, 200), value: text(c.value, 500), status: status(c.status) }; })])),
    selectedTasks: list(s.selectedTasks, (tid) => (typeof tid === "string" ? id(tid, "") || null : null)),
    assumptions: text(s.assumptions, MAX_LONG, initial.assumptions),
    successCriteria: text(s.successCriteria, MAX_LONG, initial.successCriteria),
    outOfScope: list(s.outOfScope, (oid) => (typeof oid === "string" ? id(oid, "") || null : null)),
    customOutOfScope: text(s.customOutOfScope, MAX_LONG),
    options: { showHours: bool(record(s.options).showHours, true) },
    updatedAt: typeof s.updatedAt === "number" && Number.isFinite(s.updatedAt) ? s.updatedAt : 0,
  };
}
const MAX_MAP = 2_000;
const MAX_LONG = 20_000;

export const ESTIMATE_FORMAT = "scopewright-estimate";
const LEGACY_ESTIMATE_FORMATS = ["poc-estimate"];
/** Older catalog files ("poc-catalog", "coe-estimator-catalog") still import; the format is checked by shape. */
export const CATALOG_FORMAT = "scopewright-catalog";

/** A portable, versioned estimate file. The summary is informational, for humans reading the JSON. */
export function estimateExport(catalog: Catalog, estimate: Estimate) {
  const breakdown = calculate(catalog, estimate);
  return {
    format: ESTIMATE_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    summary: { customer: estimate.customer, title: estimate.title || defaultTitle(breakdown), products: breakdown.products.map((item) => item.product.name), totalHours: breakdown.total, pendingPrerequisites: breakdown.pendingPrerequisites },
    estimate,
  };
}

export function parseEstimateExport(data: unknown, initial: Estimate): Estimate | null {
  const d = data as { format?: string; version?: number; estimate?: unknown } | null;
  if (!d || (d.format !== ESTIMATE_FORMAT && !LEGACY_ESTIMATE_FORMATS.includes(d.format ?? "")) || d.version !== 1 || !d.estimate || typeof d.estimate !== "object") return null;
  return mergeEstimate(d.estimate, initial);
}


