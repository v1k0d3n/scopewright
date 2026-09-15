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

/** The whole reusable catalog. */
export type Catalog = {
  products: Product[];
  installation: InstallationSchema;
  prerequisites: PrerequisiteSchema;
  groups: DeliverableGroup[];
  /** Solution cards at the top of the Products step; may be empty. */
  solutions: SolutionTemplate[];
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
