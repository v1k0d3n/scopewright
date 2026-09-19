import { parseLock } from "./locks.ts";
import type { DocumentRef, LockInfo } from "./types.ts";

/** File name for a new document: readable, safe on every filesystem, never empty. */
export function fileNameFor(customer: string, title: string): string {
  const slug = `${customer} ${title}`.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
  return `${slug || "estimate"}.json`;
}

/** Pick a name that is not taken by adding -2, -3, ... before the extension. */
export function uniqueName(wanted: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((name) => name.toLowerCase()));
  if (!used.has(wanted.toLowerCase())) return wanted;
  const stem = wanted.replace(/\.json$/i, "");
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${n}.json`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Build a list row from a stored file without trusting it. Anything that is
 * not an estimate export yields null and is left out of the list; the full
 * validation happens in parseEstimateExport when the document is opened.
 */
export function describe(id: string, name: string, payload: unknown, updatedAt: number, lock: unknown): DocumentRef | null {
  const d = payload as { format?: unknown; estimate?: unknown; summary?: { customer?: unknown; title?: unknown; totalHours?: unknown } } | null;
  if (!d || typeof d !== "object" || typeof d.format !== "string" || !d.estimate || typeof d.estimate !== "object") return null;
  const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 200) : "");
  const hours = d.summary?.totalHours;
  return { id, name, customer: text(d.summary?.customer), title: text(d.summary?.title), totalHours: typeof hours === "number" && Number.isFinite(hours) ? hours : null, updatedAt, lock: parseLock(lock) as LockInfo | null };
}
