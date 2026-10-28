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
import type { Catalog, CustomBlock, CustomSection, Estimate, PrerequisiteStatus, SectionPlacement } from "./types.ts";
import type { EstimateBreakdown } from "./estimate.ts";
import { TO_BE_DECIDED, calculate, defaultTitle, fillPlaceholders, outOfScopeLines, paragraphs, placeholderValues, statusLabel } from "./estimate.ts";

/** A piece of inline content. Plain text prints as written; the others are styled on the page. */
export type Span = string | { strong: string } | { note: string } | { hours: number } | { status: PrerequisiteStatus; label: string };

export type TableRow = { cells: Span[][]; total?: boolean };

/** Bullets, or numbers from `start`. An item may hold one list of its own (`nested[i]` belongs to `items[i]`). */
export type ListBlock = { kind: "list"; items: Span[][]; ordered?: boolean; start?: number; nested?: (ListBlock | undefined)[] };

export type Block =
  /** Placeholder copy stands in for something not written yet. */
  | { kind: "paragraph"; content: Span[]; placeholder?: boolean }
  | ListBlock
  /** Columns may be empty for a table without a header. A numeric table's last column holds figures. */
  | { kind: "table"; columns: string[]; rows: TableRow[]; numeric?: boolean }
  /** A titled part of a section, such as one product. */
  | { kind: "group"; title: Span[]; blocks: Block[] };

export type DocumentSection = {
  /** A built-in SectionId or a custom section's id. */
  id: string;
  title: string;
  /** Written for this estimate rather than generated from it. */
  custom: boolean;
  blocks: Block[];
  /** The lines printed under the section's heading in the copied text. */
  text: string[];
};

export type ScopeDocumentModel = {
  title: string;
  customer: string;
  sections: DocumentSection[];
};

type Context = { catalog: Catalog; estimate: Estimate; breakdown: EstimateBreakdown; showHours: boolean; fill: (value: string) => string };

type SectionDefinition = {
  id: string;
  title: string;
  /** Left out of this document when false, whatever the layout says; `omitted` says why. */
  include?: (context: Context) => boolean;
  omitted?: string;
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
    omitted: "Nothing is out of scope yet",
    blocks: ({ catalog, estimate }) => [{ kind: "list", items: outOfScopeLines(catalog, estimate).map((line) => [line]) }],
    text: ({ catalog, estimate }) => [...outOfScopeLines(catalog, estimate).map((line) => `- ${line}`), ""],
  },
  {
    id: "effort",
    title: "EFFORT SUMMARY",
    include: ({ showHours }) => showHours,
    omitted: "Hours are hidden",
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

/**
 * Every section in the order the estimate prints them. A built-in section the
 * saved layout does not mention (one added by a later release, say) goes back
 * in after the section it follows by default; a custom section goes last.
 */
export function sectionLayout(saved: SectionPlacement[] = [], customSections: CustomSection[] = []): SectionPlacement[] {
  const known = new Set<string>([...builtInSections.map((section) => section.id), ...customSections.map((section) => section.id)]);
  const layout = saved.filter((item, index) => known.has(item.id) && saved.findIndex((other) => other.id === item.id) === index);
  builtInSections.forEach((section, index) => {
    if (layout.some((item) => item.id === section.id)) return;
    const earlier = builtInSections.slice(0, index).map((other) => other.id);
    layout.splice(layout.findLastIndex((item) => earlier.includes(item.id)) + 1, 0, { id: section.id, hidden: false });
  });
  for (const section of customSections) if (!layout.some((item) => item.id === section.id)) layout.push({ id: section.id, hidden: false });
  return layout;
}

/** A section as the layout editor lists it: hidden by the architect, or left out because it has nothing to print. */
export type SectionOutline = { id: string; title: string; hidden: boolean; omitted: string | null; custom: boolean };

export function documentOutline(catalog: Catalog, estimate: Estimate, breakdown = calculate(catalog, estimate)): SectionOutline[] {
  const context = contextFor(catalog, estimate, breakdown, "");
  return placed(estimate).map(({ item, section, custom }) => ({ id: item.id, title: section.title, hidden: item.hidden, omitted: (section.include?.(context) ?? true) ? null : section.omitted ?? "Nothing to print", custom }));
}

/** Each section in the layout with what it prints. */
function placed(estimate: Estimate) {
  const customSections = estimate.customSections ?? [];
  return sectionLayout(estimate.sectionLayout, customSections).map((item) => {
    const custom = customSections.find((section) => section.id === item.id);
    return { item, section: custom ? customDefinition(custom) : builtInSections.find((section) => section.id === item.id)!, custom: Boolean(custom) };
  });
}

const contextFor = (catalog: Catalog, estimate: Estimate, breakdown: EstimateBreakdown, orgName: string): Context => {
  const values = placeholderValues(estimate, breakdown, orgName);
  return { catalog, estimate, breakdown, showHours: estimate.options?.showHours ?? true, fill: (value) => fillPlaceholders(value, values) };
};

/** Printed as the heading of a custom section that has no title. */
export const UNTITLED_SECTION = "Untitled section";

/** A custom section drawn from what was written for it. Its text is new, so it is derived from its blocks. */
function customDefinition(section: CustomSection): SectionDefinition {
  return {
    id: section.id,
    title: section.title.trim() || UNTITLED_SECTION,
    blocks: ({ fill }) => {
      const blocks = section.blocks.flatMap((block) => customBlocks(block, fill));
      return blocks.length ? blocks : [placeholder("Nothing written in this section yet.")];
    },
    text: ({ fill }) => section.blocks.map((block) => customText(block, fill)).filter((lines) => lines.length).flatMap((lines) => [...lines, ""]),
  };
}

/** A list line: its indent, then "-", "*", or "•" for a bullet, or "1." or "1)" for a number. */
const LIST_ITEM = /^([ \t]*)(?:[-*•]|(\d{1,3})[.)])\s+(.*)$/;

/**
 * Text as paragraphs and lists. A single line break stays inside its
 * paragraph; a run of list lines is a list, and a line indented by two spaces
 * or a tab belongs to a list under the item above it.
 */
function customBlocks(block: CustomBlock, fill: (value: string) => string): Block[] {
  if (block.kind === "table") {
    const columns = block.columns.map(fill);
    return [{ kind: "table", columns: columns.some((column) => column.trim()) ? columns : [], rows: block.rows.map((row) => ({ cells: row.map((cell) => [fill(cell)]) })) }];
  }
  return paragraphs(fill(block.text)).flatMap((paragraph) => {
    const out: Block[] = [];
    for (const line of paragraph.split("\n")) {
      const last = out.at(-1);
      const match = LIST_ITEM.exec(line);
      if (match) {
        const [, indent, number, content] = match;
        const ordered = number !== undefined;
        const item = [content.trim()];
        const fresh = (): ListBlock => (ordered ? { kind: "list", items: [item], ordered, start: Number(number) } : { kind: "list", items: [item] });
        if (indent.replace(/\t/g, "  ").length >= 2 && last?.kind === "list") {
          const at = last.items.length - 1;
          const nested = (last.nested ??= []);
          if (nested[at]) nested[at].items.push(item); else nested[at] = fresh();
        } else if (last?.kind === "list" && Boolean(last.ordered) === ordered) last.items.push(item);
        else out.push(fresh());
      } else if (last?.kind === "paragraph") last.content.push(`\n${line}`);
      else out.push({ kind: "paragraph", content: [line] });
    }
    return out;
  });
}

function customText(block: CustomBlock, fill: (value: string) => string): string[] {
  if (block.kind === "table") return [...(block.columns.some((column) => column.trim()) ? [block.columns.map(fill).join(" | ")] : []), ...block.rows.map((row) => `- ${row.map(fill).join(" | ")}`.trimEnd())];
  return paragraphs(fill(block.text)).flatMap((paragraph, index) => (index ? ["", ...paragraph.split("\n")] : paragraph.split("\n")));
}

/** Everything the scope document prints, in order. */
export function scopeDocument(catalog: Catalog, estimate: Estimate, orgName: string, breakdown = calculate(catalog, estimate)): ScopeDocumentModel {
  const context = contextFor(catalog, estimate, breakdown, orgName);
  const sections = placed(estimate)
    .filter(({ item, section }) => !item.hidden && (section.include?.(context) ?? true))
    // Built-in titles are already capitals; a custom title is written as people type it.
    .map(({ section, custom }) => ({ id: section.id, title: context.fill(section.title).toUpperCase(), custom, blocks: section.blocks(context), text: section.text(context) }));
  return { title: estimate.title || defaultTitle(breakdown), customer: estimate.customer, sections };
}

/** The scope document as plain text, for pasting into email or a ticket. */
export function documentText(document: ScopeDocumentModel, orgName: string): string {
  const lines = [`${document.customer || "Customer"} — ${document.title}`, `Prepared by ${orgName}`, ""];
  document.sections.forEach((section, index) => lines.push(`${index + 1}. ${section.title}`, ...section.text));
  // A section's text ends with a blank line, except where it prints nothing at all; the document never ends with one.
  while (lines.at(-1) === "") lines.pop();
  return lines.join("\n");
}

/** Plain-text rendering of the scope document. */
export const scopeText = (catalog: Catalog, estimate: Estimate, orgName: string) => documentText(scopeDocument(catalog, estimate, orgName), orgName);
