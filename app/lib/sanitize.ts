/**
 * Sanitizers for everything that enters the app from a file or the API.
 *
 * Imported catalogs, estimates, and theme packs are data, never code, and
 * the app has no HTML injection sinks. What still needs guarding is the set
 * of values that reach the browser as something other than text:
 *
 *  - theme colors become CSS custom properties (a "color" containing url()
 *    would make every visitor fetch that URL: a tracking pixel);
 *  - logo and favicon become <img src> and <link rel=icon> (a remote URL
 *    would do the same);
 *  - font choices become font-family values.
 *
 * So colors must be 6-digit hex, images must be inline data URLs of known
 * image types, fonts must be one of the built-in options, and every string
 * is capped. Numbers must be finite. Anything else is dropped or replaced.
 */

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const DATA_IMAGE = /^data:image\/(png|jpeg|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=\s]+$/;
export const MAX_IMAGE_CHARS = 600_000; // ~450 KB decoded
export const MAX_TEXT = 4_000;
export const MAX_ID = 120;
export const MAX_LIST = 2_000;

export const text = (value: unknown, max = MAX_TEXT, fallback = ""): string => (typeof value === "string" ? value.slice(0, max) : fallback);
export const id = (value: unknown, fallback: string): string => (typeof value === "string" && /^[A-Za-z0-9_.:-]{1,120}$/.test(value) ? value : fallback);
export const hours = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(value, 100_000) : 0);
export const bool = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);
export const list = <T>(value: unknown, map: (item: unknown, index: number) => T | null): T[] => (Array.isArray(value) ? value.slice(0, MAX_LIST).map(map).filter((item): item is T => item !== null) : []);
export const color = (value: unknown, fallback: string): string => (typeof value === "string" && HEX_COLOR.test(value.trim()) ? value.trim().toLowerCase() : fallback);
export const imageDataUrl = (value: unknown): string => (typeof value === "string" && value.length <= MAX_IMAGE_CHARS && DATA_IMAGE.test(value) ? value : "");
export const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback);
/** The object itself, or null for anything that is not a plain object (used to drop junk list entries). */
export const objectOrNull = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
export const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
