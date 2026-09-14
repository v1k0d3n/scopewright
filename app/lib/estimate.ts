import type { Catalog, DeliverableGroup, Estimate, InstallationChoice, InstallationField, PrerequisiteAnswer, PrerequisiteItem, PrerequisiteStatus, Product } from "./types";

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

/** Plain-text rendering of the scope document, for pasting into email or a ticket. */
export function scopeText(catalog: Catalog, estimate: Estimate, orgName: string): string {
  const breakdown = calculate(catalog, estimate);
  const title = estimate.title || defaultTitle(breakdown);
  const lines: string[] = [`${estimate.customer || "Customer"} — ${title}`, `Prepared by ${orgName}`, ""];
  lines.push("1. GOAL", estimate.goal || "Goal to be defined.", "");
  lines.push("2. PRODUCTS IN SCOPE");
  for (const item of breakdown.products) lines.push(`- ${item.product.name}: ${item.existing ? "existing environment" : "new deployment"}${item.foundation ? " (required foundation)" : ""}`);
  lines.push("", "3. INSTALLATION SCOPE");
  for (const item of breakdown.products) {
    lines.push(item.product.name);
    if (item.existing) lines.push("- Existing environment validated; no installation effort.");
    if (item.baseHours) lines.push(`- Base work package (${item.baseHours} hours)`);
    for (const decision of item.decisions) lines.push(`- ${decision.field.label}: ${decision.choice.label} (${decision.choice.hours} hours)`);
    for (const line of estimate.details[item.product.id] ?? []) if (line.description) lines.push(`- ${line.description} (${line.hours} hours)`);
    lines.push("");
  }
  lines.push("4. PREREQUISITES");
  for (const item of breakdown.prerequisites) {
    lines.push(item.product.name);
    for (const line of item.items) lines.push(`- ${line.label}${line.required ? "" : " (optional)"}: ${line.value || "—"} [${statusLabel(line.status)}]`);
    lines.push("");
  }
  lines.push("5. DELIVERY PLAN");
  for (const item of breakdown.deliverables) {
    lines.push(`${item.group.scopeNumber ? `${item.group.scopeNumber}. ` : ""}${item.group.name}`);
    for (const task of item.tasks) lines.push(`- ${task.scopeNumber ? `${task.scopeNumber}. ` : ""}${task.name} (${task.hours} hours, ${task.phase})`);
  }
  lines.push("", "6. EFFORT SUMMARY", `Installation: ${breakdown.installationHours} hours`, `Deliverables: ${breakdown.deliverableHours} hours`, `Total: ${breakdown.total} hours (planning range ${breakdown.low}–${breakdown.high})`, "");
  lines.push("7. SUCCESS CRITERIA", ...estimate.successCriteria.split("\n").filter(Boolean).map((line) => `- ${line}`), "");
  lines.push("8. ASSUMPTIONS", ...estimate.assumptions.split("\n").filter(Boolean).map((line) => `- ${line}`));
  return lines.join("\n");
}

export const defaultTitle = (breakdown: EstimateBreakdown) => `${breakdown.products.map((item) => item.product.short).join(" + ") || "Product"} Proof of Concept`;

export const statusLabel = (status: PrerequisiteStatus) => status === "provided" ? "Provided" : status === "not-applicable" ? "Not applicable" : "Pending";

/** Fill in anything missing from an older stored catalog. */
export function mergeCatalog(stored: unknown, initial: Catalog): Catalog {
  const s = (stored ?? {}) as Partial<Catalog>;
  return {
    products: s.products ?? initial.products,
    installation: s.installation ?? initial.installation,
    prerequisites: s.prerequisites ?? initial.prerequisites,
    groups: (s.groups ?? initial.groups).map((group) => ({ ...group, productId: group.productId ?? "" })),
    solutions: Array.isArray(s.solutions) ? s.solutions : initial.solutions,
  };
}

export const isCatalog = (value: unknown): value is Catalog => {
  const c = value as Partial<Catalog> | undefined;
  return Boolean(c && Array.isArray(c.products) && c.installation && typeof c.installation === "object" && Array.isArray(c.groups));
};

/** Fill in anything missing from an older stored or imported estimate. */
export function mergeEstimate(stored: unknown, initial: Estimate): Estimate {
  const s = (stored ?? {}) as Partial<Estimate>;
  return { ...initial, ...s, prerequisites: s.prerequisites ?? {}, customPrerequisites: s.customPrerequisites ?? {}, details: s.details ?? {}, environments: s.environments ?? {}, selections: s.selections ?? {}, selectedTasks: Array.isArray(s.selectedTasks) ? s.selectedTasks : [], products: Array.isArray(s.products) ? s.products : [] };
}

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


