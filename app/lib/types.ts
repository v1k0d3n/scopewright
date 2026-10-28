/**
 * Shared data model for the POC workspace.
 *
 * Everything the Estimate Catalog manages, the New Estimate workflow consumes,
 * and the Scope Document renders is described here, so the three surfaces
 * cannot drift apart.
 */

/** A sellable product or platform that an engagement can include. */
export type Product = {
  id: string;
  name: string;
  /** Short label used in chips, summaries, and document titles. */
  short: string;
  /** Portfolio heading the product is grouped under in the Products step. */
  portfolio: string;
  /** Two- or three-letter badge. */
  mark: string;
  /** Hours for the base work package when the product is deployed new. */
  hours: number;
  /** One-line description shown under the product name. */
  description?: string;
  /** Products that must exist before this one can be deployed. */
  requires?: string[];
};

/** One answer to an installation question, with the hours it takes. */
export type InstallationChoice = { id: string; label: string; hours: number; note?: string };

/** One decision the SA must make when installing a product. */
export type InstallationField = { id: string; label: string; help?: string; choices: InstallationChoice[] };

/** Installation questions keyed by product id. */
export type InstallationSchema = Record<string, InstallationField[]>;

/** Something the customer must provide or the SA must gather before a product can be deployed. */
export type PrerequisiteItem = {
  id: string;
  label: string;
  /** What a good answer looks like, e.g. "192.168.10.5". */
  placeholder?: string;
  help?: string;
  required: boolean;
};

/** Prerequisites keyed by product id. */
export type PrerequisiteSchema = Record<string, PrerequisiteItem[]>;

export const prerequisiteStatuses = ["pending", "provided", "not-applicable"] as const;
export type PrerequisiteStatus = (typeof prerequisiteStatuses)[number];

/** The SA's answer to a catalog prerequisite. */
export type PrerequisiteAnswer = { value: string; status: PrerequisiteStatus };

/** A prerequisite the SA added for this engagement only. */
export type CustomPrerequisite = { id: string; label: string; value: string; status: PrerequisiteStatus };

export const phases = ["Planning", "Prerequisites", "Deployment", "Configuration", "Testing and Validation"] as const;
export type Phase = (typeof phases)[number];

/** A deliverable the team commits to, with the hours it takes. */
export type DeliverableTask = {
  id: string;
  name: string;
  phase: Phase;
  hours: number;
  /** Only enabled tasks are offered in the New Estimate workflow. */
  enabled: boolean;
  scopeNumber?: string;
};

/** A group of deliverables, optionally tied to a product. */
export type DeliverableGroup = {
  id: string;
  name: string;
  category: string;
  /** Product this group belongs to; empty means it applies to every engagement. */
  productId: string;
  tasks: DeliverableTask[];
  scopeNumber?: string;
};

/** Something commonly excluded from an engagement, offered as a checkbox in the Engagement step. */
export type OutOfScopeItem = { id: string; label: string };

/** Presentation choices for the scope document; saved with the estimate. */
export type ScopeOptions = {
  /** Print hours and the effort summary. Off for conversations about scope without effort. */
  showHours: boolean;
};

/** The scope document's sections, in their default order. */
export const sectionIds = ["goal", "products", "installation", "prerequisites", "delivery", "out-of-scope", "effort", "success", "assumptions"] as const;
export type SectionId = (typeof sectionIds)[number];

/** Where a section prints in the scope document, and whether it prints at all. The id is a built-in SectionId or a custom section's id. */
export type SectionPlacement = { id: string; hidden: boolean };

/**
 * Part of a custom section. Text keeps the same rules as the introduction and
 * closing: a blank line between paragraphs, and placeholders such as
 * {customer} filled in when printed. Lines starting with "- " print as a list.
 */
export type CustomBlock =
  | { kind: "text"; text: string }
  /** Every row has one cell per column. */
  | { kind: "table"; columns: string[]; rows: string[][] };

/**
 * A section written for this estimate, such as contacts or a schedule, or
 * copied from a catalog template. Like the introduction and closing, a copy
 * never changes when the template does.
 */
export type CustomSection = {
  id: string;
  title: string;
  blocks: CustomBlock[];
  /** The catalog template it was copied from; empty when written from scratch. */
  templateId: string;
  /** That template's title when it was copied, so it can be named even after the catalog drops it. */
  templateName: string;
  /** True once the copy has been changed for this estimate. Never true for a locked copy. */
  edited: boolean;
  /** Copied from a locked template: it cannot be edited in this estimate. */
  locked: boolean;
};

/** A custom section kept in the catalog so teams can reuse it, such as a contacts table. */
export type SectionTemplate = {
  id: string;
  /** Printed as the section's heading; placeholders are filled in. */
  title: string;
  /** Groups templates in the Add section list, e.g. by kind of engagement or by team. */
  category: string;
  /** When to use it, shown to the person choosing. */
  description?: string;
  blocks: CustomBlock[];
  /** Only enabled templates are offered when adding a section. */
  enabled: boolean;
  /** Estimates that pick it use it exactly as written. */
  locked: boolean;
};

/**
 * Introduction and closing wording for the scope document, kept in the catalog
 * so a team can maintain agreed wording in one place. Picking one copies its
 * wording into the estimate.
 */
export type DocumentTemplate = {
  id: string;
  name: string;
  /** When to use it, shown to the person choosing. */
  description?: string;
  /** Printed after the title, before the numbered sections. May be empty. */
  introduction: string;
  /** Printed after the last section, before the signatures. May be empty. */
  closing: string;
  /** Only enabled templates are offered in the Deliverables step. */
  enabled: boolean;
  /** Wording that must be used exactly as written: estimates that pick it cannot edit it. */
  locked: boolean;
};

/** The whole reusable catalog. */
export type Catalog = {
  products: Product[];
  installation: InstallationSchema;
  prerequisites: PrerequisiteSchema;
  groups: DeliverableGroup[];
  /** Solution cards at the top of the Products step; may be empty. */
  solutions: SolutionTemplate[];
  /** Common out-of-scope items for this workspace; may be empty. */
  outOfScope: OutOfScopeItem[];
  /** Introduction and closing templates offered in the Deliverables step; may be empty. */
  documentTemplates: DocumentTemplate[];
  /** Custom sections offered on the Scope documents page; may be empty. */
  sectionTemplates: SectionTemplate[];
};

/**
 * The estimate's own introduction and closing. The wording is copied in when a
 * template is picked, so a later catalog edit never changes a document that was
 * already sent; placeholders such as {customer} are filled in when it is printed.
 */
export type DocumentFraming = {
  /** "none" prints nothing; "template" came from the catalog; "custom" was written for this estimate. */
  source: "none" | "template" | "custom";
  /** The catalog template it was copied from, when source is "template". */
  templateId: string;
  /** That template's name when it was copied, so it can be shown even after the catalog drops it. */
  templateName: string;
  introduction: string;
  closing: string;
  /** True once the copied wording has been changed for this estimate. Never true for locked wording. */
  edited: boolean;
  /** Copied from the template: the wording cannot be edited in this estimate. */
  locked: boolean;
};

export type EnvironmentState = "new" | "existing";

/** A free-text line of extra installation work. */
export type DetailLine = { id: string; description: string; hours: number };

/** A pre-canned solution shown at the top of the Products step; one click selects its products. */
export type SolutionTemplate = { id: string; label: string; title: string; subtitle: string; products: string[] };

/** One engagement being estimated. */
export type Estimate = {
  customer: string;
  title: string;
  goal: string;
  /** Products the SA explicitly picked. Foundations are derived, not stored. */
  products: string[];
  environments: Record<string, EnvironmentState>;
  /** Selected installation choice id, keyed "productId:fieldId". */
  selections: Record<string, string>;
  details: Record<string, DetailLine[]>;
  /** Answers to catalog prerequisites, keyed "productId:itemId". */
  prerequisites: Record<string, PrerequisiteAnswer>;
  /** Engagement-specific prerequisites, keyed by product id. */
  customPrerequisites: Record<string, CustomPrerequisite[]>;
  selectedTasks: string[];
  assumptions: string;
  successCriteria: string;
  /** Ids of catalog out-of-scope items that apply to this engagement. */
  outOfScope: string[];
  /** Engagement-specific out-of-scope items, one per line. */
  customOutOfScope: string;
  options: ScopeOptions;
  framing: DocumentFraming;
  /** The order of the scope document's sections, and the ones left out. Empty means the default order with every section printed. */
  sectionLayout: SectionPlacement[];
  /** Sections written for this estimate; sectionLayout says where they print. */
  customSections: CustomSection[];
  updatedAt: number;
};

export type BrandColors = {
  primary: string;
  accent: string;
  ink: string;
  muted: string;
  paper: string;
  surface: string;
  line: string;
  sidebar: string;
  sidebarInk: string;
};

/** A named, reusable set of colors. */
export type ColorScheme = { id: string; name: string; colors: BrandColors };

/** Everything the Settings page controls. */
export type Branding = {
  orgName: string;
  workspaceName: string;
  tagline: string;
  /** Data URL of an uploaded logo, or empty. */
  logo: string;
  /** Data URL of an uploaded favicon, or empty for the built-in one. */
  favicon: string;
  initials: string;
  colors: BrandColors;
  /** Saved color schemes selectable from the Settings drop-down. */
  schemes: ColorScheme[];
  fonts: { heading: string; body: string };
  document: { footer: string; confidentiality: string; showLogo: boolean };
};
