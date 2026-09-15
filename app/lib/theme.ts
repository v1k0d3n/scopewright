import { builtInThemes, defaultBranding, fontOptions } from "./defaults.ts";
import { sameColors } from "./theme-pack.ts";
import { bool, color, id, imageDataUrl, list, objectOrNull, oneOf, record, text } from "./sanitize.ts";
import type { Branding } from "./types.ts";

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Blend a color toward white by `amount` (0..1). */
export function tint(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `#${rgb.map((c) => clamp(c + (255 - c) * amount).toString(16).padStart(2, "0")).join("")}`;
}

/** Blend a color toward black by `amount` (0..1). */
export function shade(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `#${rgb.map((c) => clamp(c * (1 - amount)).toString(16).padStart(2, "0")).join("")}`;
}

/** Pick black or white text for a background. */
export function contrastInk(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#ffffff";
  const [r, g, b] = rgb.map((c) => c / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.6 ? "#151515" : "#ffffff";
}

export const fontStack = (fontId: string) => (fontOptions.find((font) => font.id === fontId) ?? fontOptions.find((font) => font.id === "system") ?? fontOptions[0]).stack;

/** CSS custom properties derived from a Branding, applied to the document root. */
export function themeVariables(branding: Branding): Record<string, string> {
  const c = branding.colors;
  return {
    "--brand": c.primary,
    "--brand-strong": c.accent,
    "--brand-ink": contrastInk(c.primary),
    "--brand-soft": tint(c.primary, 0.86),
    "--brand-tint": tint(c.primary, 0.94),
    "--brand-deep": shade(c.primary, 0.4),
    "--ink": c.ink,
    "--muted": c.muted,
    "--muted-soft": tint(c.muted, 0.35),
    "--paper": c.paper,
    "--surface": c.surface,
    "--line": c.line,
    "--line-soft": tint(c.line, 0.5),
    "--sidebar": c.sidebar,
    "--sidebar-ink": c.sidebarInk,
    "--sidebar-muted": tint(c.sidebar, 0.6),
    "--sidebar-line": tint(c.sidebar, 0.15),
    "--font-heading": fontStack(branding.fonts.heading),
    "--font-body": fontStack(branding.fonts.body),
  };
}

/**
 * Build a Branding from untrusted input (a stored document, an API body, or
 * a theme pack). Anything malformed falls back to the default for that field;
 * see sanitize.ts for why colors, images, and fonts are strict.
 */
export function mergeBranding(stored: unknown): Branding {
  const s = record(stored);
  const c = record(s.colors);
  const fonts = record(s.fonts);
  const doc = record(s.document);
  const fontIds = fontOptions.map((font) => font.id);
  const colorKeys = Object.keys(defaultBranding.colors) as (keyof Branding["colors"])[];
  const colors = Object.fromEntries(colorKeys.map((key) => [key, color(c[key], defaultBranding.colors[key])])) as Branding["colors"];
  return {
    orgName: text(s.orgName, 120, defaultBranding.orgName),
    workspaceName: text(s.workspaceName, 120, defaultBranding.workspaceName),
    tagline: text(s.tagline, 160, defaultBranding.tagline),
    logo: imageDataUrl(s.logo),
    favicon: imageDataUrl(s.favicon),
    initials: text(s.initials, 4, defaultBranding.initials),
    colors,
    schemes: list(s.schemes, (item, index) => {
      const scheme = objectOrNull(item);
      if (!scheme || !scheme.colors) return null;
      const sc = record(scheme.colors);
      return { id: id(scheme.id, `scheme-${index}`), name: text(scheme.name, 60, `Theme ${index + 1}`), colors: Object.fromEntries(colorKeys.map((key) => [key, color(sc[key], colors[key])])) as Branding["colors"] };
    }).slice(0, 50),
    fonts: { heading: oneOf(fonts.heading, fontIds, defaultBranding.fonts.heading), body: oneOf(fonts.body, fontIds, defaultBranding.fonts.body) },
    document: { footer: text(doc.footer, 200, defaultBranding.document.footer), confidentiality: text(doc.confidentiality, 200, defaultBranding.document.confidentiality), showLogo: bool(doc.showLogo, defaultBranding.document.showLogo) },
  };
}


/** The saved or built-in theme whose colors are currently in use, if any. */
export const activeTheme = (branding: Branding) => [...branding.schemes, ...builtInThemes].find((theme) => sameColors(theme.colors, branding.colors));
export const isBuiltIn = (id: string) => builtInThemes.some((theme) => theme.id === id);
