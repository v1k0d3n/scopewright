import type { Catalog, DeliverableGroup, DeliverableTask, DocumentFraming, DocumentTemplate, Estimate, InstallationChoice, InstallationField, PrerequisiteAnswer, PrerequisiteItem, PrerequisiteStatus, Product } from "./types.ts";
import { phases, prerequisiteStatuses } from "./types.ts";
import { bool, hours as num, id, list, objectOrNull, oneOf, record, text } from "./sanitize.ts";
import { CATALOG_FORMAT, CATALOG_VERSION, ESTIMATE_FORMAT, ESTIMATE_VERSION, WRITTEN_BY, checkCatalogFile, checkEstimateFile, storedCatalogVersion, upgradeCatalog, upgradeEstimate } from "./formats.ts";

export { CATALOG_FORMAT, ESTIMATE_FORMAT };

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

/** Products A–Z by short name, then full name: the order everyone sees them in, whatever order the catalog stores them in. */
export const byProductName = (a: Product, b: Product) => a.short.localeCompare(b.short, undefined, { sensitivity: "base", numeric: true }) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

export const selectionKey = (productId: string, fieldId: string) => `${productId}:${fieldId}`;

/**
 * The chosen answer for a field. A field never answered defaults to its first
 * choice; an answer the catalog no longer offers is undefined, never silently
 * replaced by a different one.
 */
export function chosen(field: InstallationField, estimate: Estimate, productId: string): InstallationChoice | undefined {
  const id = estimate.selections[selectionKey(productId, field.id)];
  if (!id) return field.choices[0];
  return field.choices.find((choice) => choice.id === id);
}

export type ProductBreakdown = {
  product: Product;
  /** True when the SA did not pick it but a selected product requires it. */
  foundation: boolean;
  existing: boolean;
  baseHours: number;
  decisions: { field: InstallationField; choice: InstallationChoice }[];
  /** Questions whose saved answer the catalog no longer offers; they need a new answer. */
  unanswered: InstallationField[];
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
  /** Installation questions across the engagement whose saved answer was removed from the catalog. */
  unansweredQuestions: number;
  deliverables: DeliverableBreakdown[];
  installationHours: number;
  deliverableHours: number;
  total: number;
  days: number;
  low: number;
  high: number;
};

/**
 * Groups offered in the Deliverables step: unscoped groups plus those tied to a product in the engagement.
 * A task turned off in the catalog is no longer offered, but stays wherever it is already selected (`keep`).
 */
export function availableGroups(catalog: Catalog, productIds: string[], keep: string[] = []): DeliverableGroup[] {
  return catalog.groups
    .filter((group) => !group.productId || productIds.includes(group.productId))
    .map((group) => ({ ...group, tasks: group.tasks.filter((task) => task.enabled || keep.includes(task.id)) }))
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
    const fields = existing ? [] : catalog.installation[id] ?? [];
    const decisions = fields.flatMap((field) => {
      const choice = chosen(field, estimate, id);
      return choice ? [{ field, choice }] : [];
    });
    const unanswered = fields.filter((field) => field.choices.length > 0 && !chosen(field, estimate, id));
    const baseHours = existing ? 0 : product.hours;
    const decisionHours = decisions.reduce((sum, item) => sum + (Number(item.choice.hours) || 0), 0);
    const detailHours = (estimate.details[id] ?? []).reduce((sum, line) => sum + (Number(line.hours) || 0), 0);
    return [{ product, foundation: !estimate.products.includes(id), existing, baseHours, decisions, decisionHours, detailHours, unanswered, hours: baseHours + decisionHours + detailHours }];
  });
  const deliverables: DeliverableBreakdown[] = availableGroups(catalog, ids, estimate.selectedTasks)
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
    unansweredQuestions: products.reduce((sum, item) => sum + item.unanswered.length, 0),
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

/** Where a saved estimate no longer matches the catalog, reported when it is opened. */
export type CatalogChanges = {
  /** Product ids the estimate picked that the catalog no longer has; they are dropped when it is opened. */
  removedProducts: string[];
  /** Installation questions whose saved answer the catalog no longer offers. */
  unanswered: { product: Product; field: InstallationField }[];
  /** Selected tasks the catalog no longer offers; they stay in the estimate. */
  retiredTasks: { group: DeliverableGroup; task: DeliverableTask }[];
};

export function catalogChanges(catalog: Catalog, estimate: Estimate): CatalogChanges {
  const known = new Set(catalog.products.map((product) => product.id));
  const breakdown = calculate(catalog, { ...estimate, products: estimate.products.filter((id) => known.has(id)) });
  return {
    removedProducts: estimate.products.filter((id) => !known.has(id)),
    unanswered: breakdown.products.flatMap((item) => item.unanswered.map((field) => ({ product: item.product, field }))),
    retiredTasks: breakdown.deliverables.flatMap((item) => item.tasks.filter((task) => !task.enabled).map((task) => ({ group: item.group, task }))),
  };
}

/** True when the architect has something to do: a product was dropped or an answer must be chosen again. Kept tasks are only reported. */
export const needsAttention = (changes: CatalogChanges) => changes.removedProducts.length > 0 || changes.unanswered.length > 0;

/** Out-of-scope lines for an estimate: chosen catalog items (in catalog order) then the free-text ones. */
export function outOfScopeLines(catalog: Catalog, estimate: Estimate): string[] {
  // Tolerate catalogs and estimates written before this section existed.
  const chosen = (catalog.outOfScope ?? []).filter((item) => (estimate.outOfScope ?? []).includes(item.id)).map((item) => item.label);
  const custom = (estimate.customOutOfScope ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  return [...chosen, ...custom];
}

/** Words a template can use; they are filled in from the estimate when the document is printed. */
export const PLACEHOLDERS = ["customer", "title", "products", "organization"] as const;
export type PlaceholderValues = Record<(typeof PLACEHOLDERS)[number], string>;

const PLACEHOLDER = /\{([^{}\s]{1,40})\}/g;

/** Placeholders in a text that Scopewright does not know; they would print as typed. */
export const unknownPlaceholders = (value: string): string[] => [...new Set([...value.matchAll(PLACEHOLDER)].map((match) => match[1]).filter((name) => !(PLACEHOLDERS as readonly string[]).includes(name)))];

/** Replace each known placeholder; anything else is left exactly as written. */
export const fillPlaceholders = (value: string, values: PlaceholderValues): string => value.replace(PLACEHOLDER, (match, name: string) => (Object.hasOwn(values, name) ? values[name as keyof PlaceholderValues] : match));

/** What each placeholder stands for in this estimate. {products} names the products the architect picked, not the foundations they pull in. */
export function placeholderValues(estimate: Estimate, breakdown: EstimateBreakdown, orgName: string): PlaceholderValues {
  const picked = breakdown.products.filter((item) => !item.foundation).map((item) => item.product.name);
  return { customer: estimate.customer || "the customer", title: estimate.title || defaultTitle(breakdown), products: new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(picked), organization: orgName };
}

/** Paragraphs are separated by a blank line; a single line break stays inside its paragraph. */
export const paragraphs = (value: string): string[] => value.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);

/** The introduction and closing as printed: placeholders filled, split into paragraphs. Empty when the estimate has none. */
export function framedText(estimate: Estimate, values: PlaceholderValues): { introduction: string[]; closing: string[] } {
  const framing = estimate.framing;
  if (!framing || framing.source === "none") return { introduction: [], closing: [] };
  return { introduction: paragraphs(fillPlaceholders(framing.introduction, values)), closing: paragraphs(fillPlaceholders(framing.closing, values)) };
}

export const noFraming: DocumentFraming = { source: "none", templateId: "", templateName: "", introduction: "", closing: "", edited: false, locked: false };

/** Copy a catalog template's wording into an estimate. */
export const framingFrom = (template: DocumentTemplate): DocumentFraming => ({ source: "template", templateId: template.id, templateName: template.name, introduction: template.introduction, closing: template.closing, edited: false, locked: template.locked });

/**
 * The catalog's template, when it now reads differently from the estimate's unedited copy (or has been locked or unlocked since).
 * An edited copy is the architect's own, so only a template that has since been locked is offered to it.
 */
export function templateChanged(catalog: Catalog, framing: DocumentFraming): DocumentTemplate | null {
  if (framing.source !== "template") return null;
  const template = (catalog.documentTemplates ?? []).find((item) => item.id === framing.templateId);
  if (!template) return null;
  if (framing.edited) return template.locked ? template : null;
  return template.introduction !== framing.introduction || template.closing !== framing.closing || template.locked !== framing.locked ? template : null;
}

/** Printed in place of an installation answer the catalog no longer offers. */
export const TO_BE_DECIDED = "To be decided";

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
  const documentTemplates = s.documentTemplates === undefined ? initial.documentTemplates ?? [] : list(s.documentTemplates, (item, index) => {
    const t = objectOrNull(item); if (!t) return null;
    return { id: id(t.id, `template-${index}`), name: text(t.name, 120, `Template ${index + 1}`), description: text(t.description, 300) || undefined, introduction: text(t.introduction, MAX_LONG), closing: text(t.closing, MAX_LONG), enabled: bool(t.enabled, true), locked: bool(t.locked, false) };
  });
  return { products, installation, prerequisites, groups, solutions, outOfScope, documentTemplates };
}

/** A question or prerequisite: its id is only unique within its product. */
export type ProductItem = { productId: string; itemId: string };
/** What to delete from a catalog. */
export type CatalogRemoval = { products?: string[]; solutions?: string[]; groups?: string[]; outOfScope?: string[]; documentTemplates?: string[]; fields?: ProductItem[]; prerequisites?: ProductItem[] };

/** Delete items by id. A deleted product takes its questions, prerequisites, and deliverable groups with it, and drops out of foundations and solutions. */
export function removeFromCatalog(catalog: Catalog, removal: CatalogRemoval): Catalog {
  const products = new Set(removal.products);
  const solutions = new Set(removal.solutions);
  const groups = new Set(removal.groups);
  const outOfScope = new Set(removal.outOfScope);
  const templates = new Set(removal.documentTemplates);
  // Ids may contain ":", so pairs are compared as pairs, never as a joined string.
  const perProduct = <T extends { id: string }>(schema: Record<string, T[]>, drop: ProductItem[] = []) => Object.fromEntries(Object.entries(schema).filter(([productId]) => !products.has(productId)).map(([productId, items]) => [productId, items.filter((item) => !drop.some((pair) => pair.productId === productId && pair.itemId === item.id))]));
  return {
    products: catalog.products.filter((product) => !products.has(product.id)).map((product) => ({ ...product, requires: (product.requires ?? []).filter((dep) => !products.has(dep)) })),
    installation: perProduct(catalog.installation, removal.fields),
    prerequisites: perProduct(catalog.prerequisites, removal.prerequisites),
    groups: catalog.groups.filter((group) => !groups.has(group.id) && !products.has(group.productId)),
    solutions: catalog.solutions.filter((solution) => !solutions.has(solution.id)).map((solution) => ({ ...solution, products: solution.products.filter((id) => !products.has(id)) })),
    outOfScope: catalog.outOfScope.filter((item) => !outOfScope.has(item.id)),
    documentTemplates: (catalog.documentTemplates ?? []).filter((item) => !templates.has(item.id)),
  };
}

/** The shared catalog as the server or the browser cache holds it, upgraded from an earlier version. One from a newer version is read as far as this one understands it. */
export function readStoredCatalog(stored: unknown, initial: Catalog): Catalog {
  const version = storedCatalogVersion(stored) ?? CATALOG_VERSION;
  return mergeCatalog(version < CATALOG_VERSION ? upgradeCatalog(stored, version) : stored, initial);
}

/** True when the stored shared catalog was written by a newer Scopewright. */
export const isNewerStoredCatalog = (stored: unknown) => (storedCatalogVersion(stored) ?? 0) > CATALOG_VERSION;

/**
 * A catalog export file, upgraded. Refused (with the reason) when it is not a
 * catalog or comes from a newer Scopewright: importing it would drop what this
 * version does not understand, for everyone.
 */
export function readCatalogFile(data: unknown, initial: Catalog): { catalog: Catalog } | { problem: string } {
  const body = (data as { catalog?: unknown } | null)?.catalog;
  if (!isCatalog(body)) return { problem: 'Not a Scopewright catalog: the file needs a top-level "catalog" object with products, installation, prerequisites, groups, and solutions. See docs/authoring.md, or run npm run catalog:check.' };
  const file = checkCatalogFile(data);
  if (file.kind === "invalid") return { problem: 'The catalog file\'s "version" must be a whole number.' };
  if (file.kind === "newer") return { problem: `This catalog was written by a newer Scopewright (catalog format ${file.version}; this one reads up to ${CATALOG_VERSION}). Update Scopewright before importing it.` };
  return { catalog: mergeCatalog(upgradeCatalog(body, file.version), initial) };
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
    framing: mergeFraming(s.framing),
    updatedAt: typeof s.updatedAt === "number" && Number.isFinite(s.updatedAt) ? s.updatedAt : 0,
  };
}
const MAX_MAP = 2_000;
const MAX_LONG = 20_000;

function mergeFraming(value: unknown): DocumentFraming {
  const f = record(value);
  const source = oneOf(f.source, ["none", "template", "custom"] as const, "none");
  if (source === "none") return noFraming;
  const locked = source === "template" && bool(f.locked, false);
  return { source, templateId: source === "template" ? id(f.templateId, "") : "", templateName: source === "template" ? text(f.templateName, 120) : "", introduction: text(f.introduction, MAX_LONG), closing: text(f.closing, MAX_LONG), edited: source === "template" && !locked && bool(f.edited, false), locked };
}

/** A portable, versioned estimate file. The summary is informational, for humans reading the JSON. */
export function estimateExport(catalog: Catalog, estimate: Estimate) {
  const breakdown = calculate(catalog, estimate);
  return {
    format: ESTIMATE_FORMAT,
    version: ESTIMATE_VERSION,
    writtenBy: WRITTEN_BY,
    exportedAt: new Date().toISOString(),
    summary: { customer: estimate.customer, title: estimate.title || defaultTitle(breakdown), products: breakdown.products.map((item) => item.product.name), totalHours: breakdown.total, pendingPrerequisites: breakdown.pendingPrerequisites },
    estimate,
  };
}

/** True for an estimate file of any version, including one from a newer Scopewright (listed, but opened view-only). */
export function isEstimateExport(data: unknown): data is { format: string; version: number; estimate: object } {
  return checkEstimateFile(data).kind !== "invalid";
}

/**
 * Open an estimate file. One from an earlier version is upgraded. One from a
 * newer Scopewright is read as far as this version understands it and marked
 * `newer`, so it is shown but never written back: saving would drop whatever
 * this version does not know about.
 */
export function readEstimateFile(data: unknown, initial: Estimate): { estimate: Estimate; newer: number | null } | null {
  const file = checkEstimateFile(data);
  if (file.kind === "invalid") return null;
  const body = (data as { estimate: unknown }).estimate;
  if (file.kind === "newer") return { estimate: mergeEstimate(body, initial), newer: file.version };
  return { estimate: mergeEstimate(upgradeEstimate(body, file.version), initial), newer: null };
}

/** An estimate file this version can edit, upgraded; null for anything else, including a file from a newer Scopewright. */
export function parseEstimateExport(data: unknown, initial: Estimate): Estimate | null {
  const file = readEstimateFile(data, initial);
  return file && file.newer === null ? file.estimate : null;
}


