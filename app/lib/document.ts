/**
 * The scope document as plain data: an ordered list of sections. Which
 * sections print, in what order, and how they are numbered is decided here,
 * once, for the page and the copied text alike.
 *
 * Each section is drawn on the page from a few kinds of block. Its copied text
 * is written next to its blocks rather than derived from them, because a
 * document someone already produced must keep printing the same text
 * (tests/fixtures/README.md), and that text predates the blocks.
 */
import type { Catalog, Estimate, PrerequisiteStatus } from "./types.ts";
import type { EstimateBreakdown } from "./estimate.ts";
import { TO_BE_DECIDED, calculate, defaultTitle, framedText, outOfScopeLines, placeholderValues, statusLabel } from "./estimate.ts";

/** A piece of inline content. Plain text prints as written; the others are styled on the page. */
export type Span = string | { strong: string } | { note: string } | { hours: number } | { status: PrerequisiteStatus; label: string };

export type TableRow = { cells: Span[][]; total?: boolean };

export type Block =
  /** Placeholder copy stands in for something not written yet. */
  | { kind: "paragraph"; content: Span[]; placeholder?: boolean }
  | { kind: "list"; items: Span[][] }
  /** Columns may be empty for a table without a header. A numeric table's last column holds figures. */
  | { kind: "table"; columns: string[]; rows: TableRow[]; numeric?: boolean }
  /** A titled part of a section, such as one product. */
  | { kind: "group"; title: Span[]; blocks: Block[] };

export type SectionId = "goal" | "products" | "installation" | "prerequisites" | "delivery" | "out-of-scope" | "effort" | "success" | "assumptions";

export type DocumentSection = {
  id: SectionId;
  title: string;
  blocks: Block[];
  /** The lines printed under the section's heading in the copied text. */
  text: string[];
};

export type ScopeDocumentModel = {
  title: string;
  customer: string;
  /** Printed after the title, before the numbered sections. */
  introduction: string[];
  sections: DocumentSection[];
  /** Printed after the last section. */
  closing: string[];
};

type Context = { catalog: Catalog; estimate: Estimate; breakdown: EstimateBreakdown; showHours: boolean };

type SectionDefinition = {
  id: SectionId;
  title: string;
  /** Left out of this document when false. */
  include?: (context: Context) => boolean;
  blocks: (context: Context) => Block[];
  text: (context: Context) => string[];
};

const placeholder = (text: string): Block => ({ kind: "paragraph", content: [text], placeholder: true });
const trimmedLines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);
/** Hours in the copied text, optionally with more detail in the same brackets. */
const textHours = (showHours: boolean, hours: number, extra = "") => (showHours ? ` (${hours} hours${extra})` : extra ? ` (${extra.replace(/^, /, "")})` : "");

/** The sections every scope document is built from, in their default order. */
export const builtInSections: SectionDefinition[] = [
  {
    id: "goal",
    title: "GOAL",
    blocks: ({ estimate }) => [estimate.goal ? { kind: "paragraph", content: [estimate.goal] } : placeholder("Add a concise POC goal in the Engagement step.")],
    text: ({ estimate }) => [estimate.goal || "Goal to be defined.", ""],
  },
  {
    id: "products",
    title: "PRODUCTS IN SCOPE",
    blocks: ({ breakdown, showHours }) => breakdown.products.length
      ? [{
        kind: "table",
        columns: showHours ? ["Product", "Environment", "Effort"] : ["Product", "Environment"],
        numeric: showHours,
        rows: breakdown.products.map((item) => ({ cells: [
          item.foundation ? [item.product.name, { note: "required foundation" }] : [item.product.name],
          [item.existing ? "Existing" : "New deployment"],
          ...(showHours ? [[`${item.hours}h`]] : []),
        ] })),
      }]
      : [placeholder("No products selected in the Estimate Builder.")],
    text: ({ breakdown }) => [...breakdown.products.map((item) => `- ${item.product.name}: ${item.existing ? "existing environment" : "new deployment"}${item.foundation ? " (required foundation)" : ""}`), ""],
  },
  {
    id: "installation",
    title: "INSTALLATION SCOPE",
    blocks: ({ estimate, breakdown, showHours }) => {
      const hours = (value: number): Span[] => (showHours ? [{ hours: value }] : []);
      return breakdown.products.map((item) => ({
        kind: "group",
        title: [item.product.name],
        blocks: [{ kind: "list", items: [
          ...(item.existing ? [["Validate access to the existing environment. No installation effort."]] : []),
          ...(showHours && item.baseHours > 0 ? [["Base work package", ...hours(item.baseHours)]] : []),
          ...item.decisions.map((decision) => [`${decision.field.label}: `, { strong: decision.choice.label }, ...hours(decision.choice.hours)]),
          ...item.unanswered.map((field): Span[] => [`${field.label}: `, { status: "pending", label: TO_BE_DECIDED }]),
          ...(estimate.details[item.product.id] ?? []).filter((line) => line.description).map((line) => [line.description, ...hours(line.hours)]),
        ] }],
      }));
    },
    text: ({ estimate, breakdown, showHours }) => breakdown.products.flatMap((item) => [
      item.product.name,
      ...(item.existing ? ["- Existing environment validated; no installation effort."] : []),
      ...(item.baseHours && showHours ? [`- Base work package${textHours(showHours, item.baseHours)}`] : []),
      ...item.decisions.map((decision) => `- ${decision.field.label}: ${decision.choice.label}${textHours(showHours, decision.choice.hours)}`),
      ...item.unanswered.map((field) => `- ${field.label}: ${TO_BE_DECIDED}`),
      ...(estimate.details[item.product.id] ?? []).filter((line) => line.description).map((line) => `- ${line.description}${textHours(showHours, line.hours)}`),
      "",
    ]),
  },
  {
    id: "prerequisites",
    title: "PREREQUISITES",
    blocks: ({ breakdown }) => breakdown.prerequisites.length
      ? breakdown.prerequisites.map((item) => ({
        kind: "group",
        title: [item.product.name],
        blocks: [{
          kind: "table",
          columns: ["Customer provides", "Value", "Status"],
          rows: item.items.map((line) => ({ cells: [
            line.required ? [line.label] : [line.label, { note: "optional" }],
            [line.value || "—"],
            [{ status: line.status, label: statusLabel(line.status) }],
          ] })),
        }],
      }))
      : [placeholder("No prerequisites are defined for the selected products.")],
    text: ({ breakdown }) => breakdown.prerequisites.flatMap((item) => [
      item.product.name,
      ...item.items.map((line) => `- ${line.label}${line.required ? "" : " (optional)"}: ${line.value || "—"} [${statusLabel(line.status)}]`),
      "",
    ]),
  },
  {
    id: "delivery",
    title: "DELIVERY PLAN",
    blocks: ({ breakdown, showHours }) => breakdown.deliverables.length
      ? breakdown.deliverables.map((item) => ({
        kind: "group",
        title: [`${item.group.scopeNumber ? `${item.group.scopeNumber}. ` : ""}${item.group.name}`],
        blocks: [{ kind: "list", items: item.tasks.map((task) => [`${task.scopeNumber ? `${task.scopeNumber}. ` : ""}${task.name}`, { note: task.phase }, ...(showHours ? [{ hours: task.hours }] : [])]) }],
      }))
      : [placeholder("No deliverables selected in the Estimate Builder.")],
    text: ({ breakdown, showHours }) => [
      ...breakdown.deliverables.flatMap((item) => [
        `${item.group.scopeNumber ? `${item.group.scopeNumber}. ` : ""}${item.group.name}`,
        ...item.tasks.map((task) => `- ${task.scopeNumber ? `${task.scopeNumber}. ` : ""}${task.name}${textHours(showHours, task.hours, `, ${task.phase}`)}`),
      ]),
      "",
    ],
  },
  {
    id: "out-of-scope",
    title: "OUT OF SCOPE",
    include: ({ catalog, estimate }) => outOfScopeLines(catalog, estimate).length > 0,
    blocks: ({ catalog, estimate }) => [{ kind: "list", items: outOfScopeLines(catalog, estimate).map((line) => [line]) }],
    text: ({ catalog, estimate }) => [...outOfScopeLines(catalog, estimate).map((line) => `- ${line}`), ""],
  },
  {
    id: "effort",
    title: "EFFORT SUMMARY",
    include: ({ showHours }) => showHours,
    blocks: ({ breakdown }) => [{
      kind: "table",
      columns: [],
      numeric: true,
      rows: [
        { cells: [["Installation and configuration"], [`${breakdown.installationHours}h`]] },
        { cells: [["Deliverables"], [`${breakdown.deliverableHours}h`]] },
        { cells: [["Total estimated effort"], [`${breakdown.total}h`]], total: true },
        { cells: [["Planning range"], [`${breakdown.low}–${breakdown.high}h`]] },
      ],
    }],
    text: ({ breakdown }) => [`Installation: ${breakdown.installationHours} hours`, `Deliverables: ${breakdown.deliverableHours} hours`, `Total: ${breakdown.total} hours (planning range ${breakdown.low}–${breakdown.high})`, ""],
  },
  {
    id: "success",
    title: "SUCCESS CRITERIA",
    blocks: ({ estimate }) => [{ kind: "list", items: trimmedLines(estimate.successCriteria).map((line) => [line]) }],
    text: ({ estimate }) => [...estimate.successCriteria.split("\n").filter(Boolean).map((line) => `- ${line}`), ""],
  },
  {
    id: "assumptions",
    title: "ASSUMPTIONS",
    blocks: ({ estimate }) => [{ kind: "list", items: trimmedLines(estimate.assumptions).map((line) => [line]) }],
    text: ({ estimate }) => [...estimate.assumptions.split("\n").filter(Boolean).map((line) => `- ${line}`), ""],
  },
];

/** Everything the scope document prints, in order. */
export function scopeDocument(catalog: Catalog, estimate: Estimate, orgName: string, breakdown = calculate(catalog, estimate)): ScopeDocumentModel {
  const context: Context = { catalog, estimate, breakdown, showHours: estimate.options?.showHours ?? true };
  const framing = framedText(estimate, placeholderValues(estimate, breakdown, orgName));
  const sections = builtInSections
    .filter((section) => section.include?.(context) ?? true)
    .map((section) => ({ id: section.id, title: section.title, blocks: section.blocks(context), text: section.text(context) }));
  return { title: estimate.title || defaultTitle(breakdown), customer: estimate.customer, introduction: framing.introduction, sections, closing: framing.closing };
}

/** The scope document as plain text, for pasting into email or a ticket. */
export function documentText(document: ScopeDocumentModel, orgName: string): string {
  const lines = [`${document.customer || "Customer"} — ${document.title}`, `Prepared by ${orgName}`, ""];
  for (const paragraph of document.introduction) lines.push(paragraph, "");
  document.sections.forEach((section, index) => lines.push(`${index + 1}. ${section.title}`, ...section.text));
  // A section's text ends with a blank line, except where it prints nothing at all; the document never ends with one.
  while (lines.at(-1) === "") lines.pop();
  if (document.closing.length) lines.push("", ...document.closing.flatMap((paragraph, index) => (index ? ["", paragraph] : [paragraph])));
  return lines.join("\n");
}

/** Plain-text rendering of the scope document. */
export const scopeText = (catalog: Catalog, estimate: Estimate, orgName: string) => documentText(scopeDocument(catalog, estimate, orgName), orgName);
