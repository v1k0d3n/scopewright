/**
 * File formats and their versions. docs/formats.md explains the rules.
 *
 * Each file Scopewright writes says what it is ("format") and which version of
 * that format it follows. Bump a version when an older Scopewright reading the
 * new file would lose or misread something, for example a new field that its
 * tolerant reader would silently drop on the next save. Every bump adds an
 * upgrade step below, so files written by any earlier version keep opening.
 *
 * A file from a newer Scopewright is never written back by this one: an
 * estimate opens view-only, a catalog import is refused, and the server refuses
 * a catalog save from a page that is not running the current version.
 */
import pkg from "../../package.json" with { type: "json" };
import { record } from "./sanitize.ts";

export const APP_VERSION: string = pkg.version;
/** Stamped on every file this build writes, so a file can say which release wrote it. */
export const WRITTEN_BY = `Scopewright ${APP_VERSION}`;

export const CATALOG_FORMAT = "scopewright-catalog";
export const ESTIMATE_FORMAT = "scopewright-estimate";

/** 2: introduction and closing templates (documentTemplates). 3: section templates (sectionTemplates) replace them; mergeCatalog converts any it finds. */
export const CATALOG_VERSION = 3;
/** 2: the estimate's own introduction and closing (framing). 3: the order of the scope document's sections (sectionLayout) and sections written for the estimate (customSections), which replace the introduction and closing; mergeEstimate converts any it finds. */
export const ESTIMATE_VERSION = 3;

/** Older names of the estimate format; they still open. */
export const LEGACY_ESTIMATE_FORMATS = ["poc-estimate"];

type Body = Record<string, unknown>;
type Upgrade = (body: Body) => Body;

/** Step n turns a version-n catalog into version n + 1. */
export const catalogUpgrades: Record<number, Upgrade> = {
  1: (catalog) => ({ ...catalog, documentTemplates: Array.isArray(catalog.documentTemplates) ? catalog.documentTemplates : [] }),
  2: (catalog) => ({ ...catalog, sectionTemplates: Array.isArray(catalog.sectionTemplates) ? catalog.sectionTemplates : [] }),
};

/** Step n turns a version-n estimate into version n + 1. */
export const estimateUpgrades: Record<number, Upgrade> = {
  1: (estimate) => ({ ...estimate, framing: estimate.framing ?? { source: "none" } }),
  2: (estimate) => ({ ...estimate, sectionLayout: Array.isArray(estimate.sectionLayout) ? estimate.sectionLayout : [], customSections: Array.isArray(estimate.customSections) ? estimate.customSections : [] }),
};

const upgrade = (body: unknown, from: number, to: number, steps: Record<number, Upgrade>): Body => {
  let out = record(body);
  for (let version = from; version < to; version += 1) out = steps[version](out);
  return out;
};

/** A catalog body (the sections, not the file wrapper) brought up to the current version. */
export const upgradeCatalog = (body: unknown, from: number) => upgrade(body, from, CATALOG_VERSION, catalogUpgrades);
/** An estimate body brought up to the current version. */
export const upgradeEstimate = (body: unknown, from: number) => upgrade(body, from, ESTIMATE_VERSION, estimateUpgrades);

/** A file's version: a whole number from 1 up. Catalogs written before versions were checked may leave it out, which means 1. */
export function versionOf(data: unknown, missing: number | null = null): number | null {
  const version = record(data).version;
  if (version === undefined) return missing;
  return typeof version === "number" && Number.isInteger(version) && version >= 1 ? version : null;
}

/** What a file is, as far as this build can tell. "newer" files were written by a later Scopewright. */
export type FileCheck = { kind: "current"; version: number } | { kind: "newer"; version: number } | { kind: "invalid" };

const check = (version: number | null, current: number): FileCheck => (version === null ? { kind: "invalid" } : version > current ? { kind: "newer", version } : { kind: "current", version });

/** An estimate file: a known format and a version. */
export function checkEstimateFile(data: unknown): FileCheck {
  const d = record(data);
  if (typeof d.format !== "string" || !(d.format === ESTIMATE_FORMAT || LEGACY_ESTIMATE_FORMATS.includes(d.format))) return { kind: "invalid" };
  if (!d.estimate || typeof d.estimate !== "object" || Array.isArray(d.estimate)) return { kind: "invalid" };
  return check(versionOf(d), ESTIMATE_VERSION);
}

/** A catalog export file. Older files ("poc-catalog", "coe-estimator-catalog", or no format) are recognized by shape elsewhere, so only the version is checked here. */
export const checkCatalogFile = (data: unknown): FileCheck => check(versionOf(data, 1), CATALOG_VERSION);

/**
 * The shared catalog as the server stores it: the sections stay at the top
 * level, where every earlier Scopewright reads them, with format and version
 * beside them.
 */
export const catalogDocument = <T extends object>(catalog: T) => ({ format: CATALOG_FORMAT, version: CATALOG_VERSION, writtenBy: WRITTEN_BY, ...catalog });

/** The version of a stored shared catalog. One saved before versions existed has no format and is version 1. */
export const storedCatalogVersion = (stored: unknown): number | null => (record(stored).format === undefined ? 1 : versionOf(stored));

/** Shown when a page is older than the server, for example a tab left open across an update. */
export const RELOAD_OLDER = "Scopewright has been updated. Reload the page, then make your change again.";
/** Shown when a page is newer than the server, for example during an update. */
export const RELOAD_NEWER = "The server is running an older Scopewright. Wait a minute for the update to finish, then reload the page.";

/** Why the server refuses a shared catalog write, or null when it accepts it. Only the current version may be saved. */
export function catalogWriteProblem(body: unknown): string | null {
  const b = record(body);
  if (b.format !== CATALOG_FORMAT) return RELOAD_OLDER;
  const version = versionOf(b);
  if (version === null || version < CATALOG_VERSION) return RELOAD_OLDER;
  if (version > CATALOG_VERSION) return RELOAD_NEWER;
  return null;
}
