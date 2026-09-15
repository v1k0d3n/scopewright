/**
 * Theme packs: a zip holding theme.json plus the logo and favicon as files.
 *
 *   theme.json   identity, colors, fonts, document settings, asset file names
 *   logo.svg     (or .png / .jpg / .webp) — optional
 *   favicon.svg  (or .png / .ico) — optional
 *
 * Pure functions over bytes so the same code runs in the browser and in tests.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { BrandColors, Branding, ColorScheme } from "./types.ts";

const colorKeys: (keyof BrandColors)[] = ["primary", "accent", "ink", "muted", "paper", "surface", "line", "sidebar", "sidebarInk"];

/** True when two color sets are identical. */
export const sameColors = (a: BrandColors, b: BrandColors) => colorKeys.every((key) => (a[key] ?? "").toLowerCase() === (b[key] ?? "").toLowerCase());

export const THEME_FORMAT = "scopewright-theme";
const LEGACY_THEME_FORMATS = ["poc-theme"];

export type ThemeManifest = {
  format: typeof THEME_FORMAT;
  version: 1;
  exportedAt: string;
  identity: Pick<Branding, "orgName" | "workspaceName" | "tagline" | "initials">;
  colors: Branding["colors"];
  /** Saved schemes; the active one is whichever matches `colors`. */
  schemes?: ColorScheme[];
  fonts: Branding["fonts"];
  document: Branding["document"];
  assets: { logo?: string; favicon?: string };
};

const extensionFor: Record<string, string> = { "image/svg+xml": "svg", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/gif": "gif" };
export const MAX_PACK_BYTES = 6_000_000;
export const MAX_ASSET_BYTES = 450_000;
const mimeFor: Record<string, string> = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", ico: "image/x-icon", gif: "image/gif" };

const decodeBase64 = (text: string): Uint8Array => {
  const binary = typeof atob === "function" ? atob(text) : Buffer.from(text, "base64").toString("binary");
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};
const encodeBase64 = (bytes: Uint8Array): string => {
  if (typeof btoa === "function") {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
};

/** Split a data URL into its bytes and media type; null for anything else. */
export function dataUrlToFile(dataUrl: string, baseName: string): { name: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  const [, mime, isBase64, payload] = match;
  const extension = extensionFor[mime] ?? "bin";
  const bytes = isBase64 ? decodeBase64(payload) : strToU8(decodeURIComponent(payload));
  return { name: `${baseName}.${extension}`, bytes };
}

export function fileToDataUrl(name: string, bytes: Uint8Array): string {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return `data:${mimeFor[extension] ?? "application/octet-stream"};base64,${encodeBase64(bytes)}`;
}

/** Build the zip bytes for a theme pack. */
export function buildThemePack(branding: Branding): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const assets: ThemeManifest["assets"] = {};
  const logo = branding.logo ? dataUrlToFile(branding.logo, "logo") : null;
  const favicon = branding.favicon ? dataUrlToFile(branding.favicon, "favicon") : null;
  if (logo) { files[logo.name] = logo.bytes; assets.logo = logo.name; }
  if (favicon) { files[favicon.name] = favicon.bytes; assets.favicon = favicon.name; }
  const manifest: ThemeManifest = {
    format: THEME_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    identity: { orgName: branding.orgName, workspaceName: branding.workspaceName, tagline: branding.tagline, initials: branding.initials },
    colors: branding.colors,
    schemes: branding.schemes,
    fonts: branding.fonts,
    document: branding.document,
    assets,
  };
  files["theme.json"] = strToU8(JSON.stringify(manifest, null, 2));
  return zipSync(files, { level: 6 });
}

/** Read a theme pack; returns a Branding merged over `base`, or null if the zip is not a theme pack. */
/** `knownThemes` (for example the built-in ones) are not re-created as org-named themes. */
export function parseThemePack(bytes: Uint8Array, base: Branding, knownThemes: ColorScheme[] = []): Branding | null {
  if (bytes.length > MAX_PACK_BYTES) return null;
  let files: Record<string, Uint8Array>;
  try {
    // Only theme.json and small image files are ever read; everything else in
    // the archive is ignored, and oversized entries are skipped before inflate.
    files = unzipSync(bytes, { filter: (file) => /(^|\/)(theme\.json|[A-Za-z0-9_-]+\.(svg|png|jpg|jpeg|webp|ico|gif))$/.test(file.name) && file.originalSize <= MAX_ASSET_BYTES });
  } catch {
    return null;
  }
  // Tolerate packs zipped with a top-level folder.
  const entry = Object.keys(files).find((name) => name === "theme.json" || name.endsWith("/theme.json"));
  if (!entry) return null;
  const prefix = entry.slice(0, -"theme.json".length);
  let manifest: Partial<ThemeManifest>;
  try {
    manifest = JSON.parse(strFromU8(files[entry])) as Partial<ThemeManifest>;
  } catch {
    return null;
  }
  if ((manifest.format !== THEME_FORMAT && !LEGACY_THEME_FORMATS.includes(manifest.format ?? "")) || manifest.version !== 1) return null;
  const asset = (name?: string) => (typeof name === "string" && /^[A-Za-z0-9_-]+\.(svg|png|jpg|jpeg|webp|ico|gif)$/.test(name) && files[prefix + name] ? fileToDataUrl(name, files[prefix + name]) : "");
  const colors = { ...base.colors, ...(manifest.colors ?? {}) };
  const schemes = (Array.isArray(manifest.schemes) ? manifest.schemes : []).filter((scheme) => scheme && scheme.id && scheme.name && scheme.colors);
  // A pack that never named its colors still gets a selectable scheme, named after the organization.
  const orgName = manifest.identity?.orgName || base.orgName;
  if (![...schemes, ...knownThemes].some((scheme) => sameColors(scheme.colors, colors))) schemes.unshift({ id: `scheme-${orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: orgName, colors });
  return {
    ...base,
    ...(manifest.identity ?? {}),
    colors,
    schemes,
    fonts: { ...base.fonts, ...(manifest.fonts ?? {}) },
    document: { ...base.document, ...(manifest.document ?? {}) },
    logo: asset(manifest.assets?.logo),
    favicon: asset(manifest.assets?.favicon),
  };
}
