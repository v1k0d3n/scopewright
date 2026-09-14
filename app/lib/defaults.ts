import type { Branding, Catalog, ColorScheme, Estimate } from "./types";

/**
 * A fresh deployment starts with an empty catalog. Organizations import their
 * own catalog from Settings, or start from one of the packs under packs/
 * (packs/red-hat is a complete example).
 */
export const defaultCatalog: Catalog = { products: [], installation: {}, prerequisites: {}, groups: [], solutions: [] };

export const emptyEstimate = (): Estimate => ({
  customer: "",
  title: "",
  goal: "",
  products: [],
  environments: {},
  selections: {},
  details: {},
  prerequisites: {},
  customPrerequisites: {},
  selectedTasks: [],
  assumptions: "Customer provides hardware, network access, and credentials before the engagement starts.\nEstimate covers delivery work only; calendar duration depends on customer readiness.",
  successCriteria: "Agreed installation and configuration activities are completed.\nSelected deliverables are tested and validated with the customer.\nResults, decisions, and follow-up actions are documented.",
  updatedAt: 0,
});

export const fontOptions = [
  { id: "red-hat", label: "Red Hat Display", stack: '"Red Hat Display", Arial, sans-serif' },
  { id: "system", label: "System UI", stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { id: "helvetica", label: "Helvetica / Arial", stack: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { id: "georgia", label: "Georgia (serif)", stack: 'Georgia, "Times New Roman", serif' },
  { id: "mono", label: "Monospace", stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
];

/** Non-branded color themes available in every deployment. Saved themes live in Branding.schemes. */
export const builtInThemes: ColorScheme[] = [
  { id: "builtin-navy", name: "Navy", colors: { primary: "#1f3a93", accent: "#3d6be8", ink: "#161a2b", muted: "#565b6e", paper: "#f3f4f8", surface: "#ffffff", line: "#dfe2ec", sidebar: "#0f1c3f", sidebarInk: "#ffffff" } },
  { id: "builtin-forest", name: "Forest", colors: { primary: "#1f6f43", accent: "#2ea86a", ink: "#17201a", muted: "#55625a", paper: "#f3f6f4", surface: "#ffffff", line: "#dde5e0", sidebar: "#0f2a1c", sidebarInk: "#ffffff" } },
  { id: "builtin-ember", name: "Ember", colors: { primary: "#333333", accent: "#ff6a00", ink: "#1a1a1a", muted: "#5c5c5c", paper: "#f4f3f1", surface: "#ffffff", line: "#e3e1dd", sidebar: "#1c1c1c", sidebarInk: "#ffffff" } },
  { id: "builtin-plum", name: "Plum", colors: { primary: "#6b2d8a", accent: "#9b4dcc", ink: "#1d1622", muted: "#5f5567", paper: "#f6f3f8", surface: "#ffffff", line: "#e6dfeb", sidebar: "#22142b", sidebarInk: "#ffffff" } },
  { id: "builtin-slate", name: "Slate", colors: { primary: "#2f3b4a", accent: "#4f6b8a", ink: "#1a1e24", muted: "#5b636e", paper: "#f2f4f6", surface: "#ffffff", line: "#dfe3e8", sidebar: "#151a20", sidebarInk: "#ffffff" } },
];

/** Out-of-the-box brand: a fictitious sales team on the Navy theme. Organizations apply their own theme pack from Settings. */
export const defaultBranding: Branding = {
  orgName: "Company Solution Architects",
  workspaceName: "Northeast Sales",
  tagline: "Solution Architects",
  logo: "",
  favicon: "",
  initials: "NE",
  colors: { ...builtInThemes.find((theme) => theme.id === "builtin-navy")!.colors },
  schemes: [],
  fonts: { heading: "system", body: "system" },
  document: { footer: "Company Solution Architects", confidentiality: "Confidential", showLogo: true },
};
