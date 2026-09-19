"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { acquire, lockedByOther, release, RENEW_MINUTES } from "./locks.ts";
import { sourceById, sources } from "./registry.ts";
import type { SourcesConfig } from "./server-config.ts";
import { NotConnectedError } from "./types.ts";
import type { DocumentRef, LockInfo, SourceContext, SourceProvider } from "./types.ts";

const SOURCE_KEY = "scopewright:source";
const ACTIVE_KEY = "scopewright:active-document";
const TOKEN_KEY = "scopewright:lock-token";

/** The saved estimate this tab has open, if any. */
export type ActiveDocument = { sourceId: string; id: string; name: string; revision: string };

export type LibraryState = "loading" | "needs-connect" | "ready";

/** One token per tab, kept across reloads so a refresh does not lock you out of your own document. */
function lockToken(): string {
  try {
    const existing = window.sessionStorage.getItem(TOKEN_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem(TOKEN_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: the choice lasts for this page only */
  }
}

/**
 * The estimate library: which source is selected, what it holds, and which
 * document is open here. Knows nothing about any particular source.
 */
export function useLibrary(owner: string) {
  const [offered, setOffered] = useState<SourceProvider[]>([sources[0]]);
  const [context, setContext] = useState<SourceContext>({ config: {} });
  const [provider, setProvider] = useState<SourceProvider>(sources[0]);
  const [state, setState] = useState<LibraryState>("loading");
  const [documents, setDocuments] = useState<DocumentRef[]>([]);
  const [active, setActiveState] = useState<ActiveDocument | null>(null);
  const [error, setError] = useState("");
  const token = useRef("");
  // The same token, as state, for rendering "open here" against each row's lock.
  const [tokenValue, setTokenValue] = useState("");
  const ownerRef = useRef(owner);
  useEffect(() => { ownerRef.current = owner; }, [owner]);

  const setActive = useCallback((next: ActiveDocument | null) => { setActiveState(next); writeJson(ACTIVE_KEY, next); }, []);
  const fail = (problem: unknown) => setError(problem instanceof Error ? problem.message : String(problem));

  const refresh = useCallback(async (from: SourceProvider) => {
    const found = await from.list();
    setDocuments(found.sort((a, b) => b.updatedAt - a.updatedAt));
  }, []);

  const switchTo = useCallback(async (next: SourceProvider, ctx: SourceContext) => {
    setProvider(next);
    setError("");
    setDocuments([]);
    setState("loading");
    writeJson(SOURCE_KEY, next.id);
    try {
      if (await next.resume(ctx)) { await refresh(next); setState("ready"); } else setState("needs-connect");
    } catch (problem) {
      fail(problem);
      setState("needs-connect");
    }
  }, [refresh]);

  // Start-up: learn what the deployment offers, then restore the last source and open document.
  useEffect(() => {
    token.current = lockToken();
    let cancelled = false;
    fetch("/api/workspace/sources", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<SourcesConfig>) : null))
      .catch(() => null)
      .then((settings) => {
        if (cancelled) return;
        setTokenValue(token.current);
        const ctx = { config: settings?.config ?? {} };
        const allowed = sources.filter((source) => (!settings?.enabled || settings.enabled.includes(source.id)) && source.configured(ctx));
        const usable = (source: SourceProvider) => allowed.includes(source) && source.unavailable(ctx) === null;
        setContext(ctx);
        setOffered(allowed.length ? allowed : [sources[0]]);
        const remembered = readJson<ActiveDocument>(ACTIVE_KEY);
        const wanted = sourceById(remembered?.sourceId ?? readJson<string>(SOURCE_KEY) ?? "browser");
        const start = usable(wanted) ? wanted : sources[0];
        if (remembered && remembered.sourceId === start.id) setActiveState(remembered);
        else if (remembered) writeJson(ACTIVE_KEY, null);
        void switchTo(start, ctx);
      });
    return () => { cancelled = true; };
  }, [switchTo]);

  // Hold the lock while a document is open. Losing it (someone took over after it lapsed) is reported, not hidden.
  useEffect(() => {
    if (!active || state !== "ready" || provider.id !== active.sourceId) return;
    const renew = () => acquire(provider, active.id, ownerRef.current, token.current, Date.now())
      .then((other) => { if (other) setError(`${other.owner} now has “${active.name}” open. Your changes cannot be saved over theirs; export a copy if you need to keep them.`); })
      // A missed renewal is retried on the next tick, but a lapsed session needs the user.
      .catch((problem) => { if (problem instanceof NotConnectedError) { setError(`${problem.message} Until then “${active.name}” is not held for you.`); setState("needs-connect"); } });
    void renew();
    const timer = window.setInterval(renew, RENEW_MINUTES * 60_000);
    return () => window.clearInterval(timer);
  }, [active, provider, state]);

  /** A source that says it cannot work here is never asked to connect, whichever path leads to it. */
  const usableOrThrow = (target: SourceProvider) => { const reason = target.unavailable(context); if (reason) throw new Error(reason); };

  const connect = async () => {
    setError("");
    try {
      usableOrThrow(provider);
      await provider.connect(context);
      await refresh(provider);
      setState("ready");
    } catch (problem) {
      // Closing the picker is not an error worth showing.
      if (!(problem instanceof DOMException && problem.name === "AbortError")) fail(problem);
    }
  };

  const disconnect = async () => {
    if (active?.sourceId === provider.id) { await release(provider, active.id, token.current, Date.now()).catch(() => {}); setActive(null); }
    await provider.disconnect().catch(() => {});
    setDocuments([]);
    setState("needs-connect");
  };

  /** Move to another location in the same source. The open document, if it lives here, is closed first: it belongs to the place being left. */
  const relocate = async (move: () => Promise<void>) => {
    setError("");
    const leaving = active?.sourceId === provider.id ? active : null;
    try {
      usableOrThrow(provider);
      // Release first: once the provider points at the new place, the old lock can no longer be reached.
      if (leaving) await release(provider, leaving.id, token.current, Date.now()).catch(() => {});
      await move();
      if (leaving) setActive(null);
      await refresh(provider);
      setState("ready");
    } catch (problem) {
      // Still in the old place (the picker was cancelled, or the move failed): hold the document again.
      if (leaving) await acquire(provider, leaving.id, ownerRef.current, token.current, Date.now()).catch(() => {});
      if (!(problem instanceof DOMException && problem.name === "AbortError")) fail(problem);
    }
  };
  const changeLocation = () => relocate(async () => { await provider.changeLocation?.(context); });
  const createFolder = (name: string) => relocate(async () => {
    await ready(provider);
    await provider.createFolder?.(name);
  });

  /** Resolves to the payload, or to the lock that blocks opening. */
  const open = async (doc: DocumentRef): Promise<{ payload: unknown } | { blockedBy: LockInfo }> => {
    setError("");
    const other = await acquire(provider, doc.id, ownerRef.current, token.current, Date.now());
    if (other) { await refresh(provider).catch(() => {}); return { blockedBy: other }; }
    const held = active?.sourceId === provider.id && active.id === doc.id;
    const body = await provider.read(doc.id).catch(async (problem) => {
      if (!held) await release(provider, doc.id, token.current, Date.now()).catch(() => {});
      await refresh(provider).catch(() => {});
      throw problem;
    });
    if (active && (active.id !== doc.id || active.sourceId !== provider.id)) await release(sourceById(active.sourceId), active.id, token.current, Date.now()).catch(() => {});
    setActive({ sourceId: provider.id, id: doc.id, name: doc.name, revision: body.revision });
    await refresh(provider).catch(() => {});
    return { payload: body.payload };
  };

  // A folder permission or a cloud session can lapse while the page is open; saves run from a click, so reconnecting is allowed.
  const ready = async (target: SourceProvider) => { usableOrThrow(target); if (!(await target.resume(context))) await target.connect(context); };

  const adopt = async (target: SourceProvider, written: { id: string; name: string; revision: string; notice?: string }, takeLock: boolean) => {
    const saved = { sourceId: target.id, id: written.id, name: written.name, revision: written.revision };
    if (takeLock) {
      // The file is written; whether it is ours to keep editing depends on the lock. A failure here is reported, not swallowed.
      const other = await acquire(target, written.id, ownerRef.current, token.current, Date.now());
      if (other) { if (target.id === provider.id) await refresh(provider).catch(() => {}); throw new Error(`“${written.name}” was saved, but ${other.owner} opened it at the same moment, so it is not open here. Use Save as with another name to keep working.`); }
    }
    setActive(saved);
    if (written.notice) setError(written.notice);
    if (target.id === provider.id) { setState("ready"); await refresh(provider).catch(() => {}); }
    return saved;
  };

  /** Save: write the open document back to where it lives. */
  const save = async (payload: unknown) => {
    if (!active) throw new Error("This estimate has not been saved anywhere yet. Use Save as.");
    setError("");
    const target = sourceById(active.sourceId);
    await ready(target);
    return adopt(target, await target.write(active.id, active.name, payload, active.revision), false);
  };

  /**
   * Save as: write to a named file in the selected source. A file of that name
   * is replaced, after `confirmReplace` agrees, never duplicated; one that
   * someone else has open is left alone.
   */
  const saveAs = async (name: string, payload: unknown, confirmReplace: (existing: DocumentRef) => boolean) => {
    setError("");
    await ready(provider);
    const existing = (await provider.list()).find((doc) => doc.name.toLowerCase() === name.toLowerCase());
    const mine = existing && active?.sourceId === provider.id && active.id === existing.id;
    if (existing && !mine) {
      if (lockedByOther(existing.lock, token.current, Date.now())) throw new Error(`${existing.lock!.owner} has “${existing.name}” open, so it cannot be replaced. Choose another name.`);
      if (!confirmReplace(existing)) throw new DOMException("Cancelled", "AbortError");
    }
    // Replacing a file: hold it before writing, so nobody can open it in between.
    if (existing && !mine) {
      const other = await acquire(provider, existing.id, ownerRef.current, token.current, Date.now());
      if (other) throw new Error(`${other.owner} has “${existing.name}” open, so it cannot be replaced. Choose another name.`);
    }
    const written = await provider.write(existing?.id ?? null, name, payload, null).catch(async (problem) => {
      if (existing && !mine) await release(provider, existing.id, token.current, Date.now()).catch(() => {});
      throw problem;
    });
    if (active && !mine) await release(sourceById(active.sourceId), active.id, token.current, Date.now()).catch(() => {});
    return adopt(provider, written, true);
  };

  /** Stop editing the open document and free it for others. */
  const close = async () => {
    if (!active) return;
    await release(sourceById(active.sourceId), active.id, token.current, Date.now()).catch(() => {});
    setActive(null);
    if (state === "ready") await refresh(provider).catch(() => {});
  };

  const remove = async (doc: DocumentRef) => {
    setError("");
    try {
      const lock = await provider.readLock(doc.id);
      if (lockedByOther(lock, token.current, Date.now())) { await refresh(provider).catch(() => {}); throw new Error(`${lock!.owner} has “${doc.name}” open, so it cannot be deleted.`); }
      await provider.remove(doc.id);
      if (active?.id === doc.id && active.sourceId === provider.id) setActive(null);
      await refresh(provider);
    } catch (problem) { fail(problem); }
  };

  return {
    offered, context, provider, state, documents, active, error, token: tokenValue,
    select: (id: string) => switchTo(sourceById(id), context),
    reload: () => refresh(provider).catch(fail),
    connect, disconnect, changeLocation, createFolder, open, save, saveAs, close, remove, setError,
  };
}

export type Library = ReturnType<typeof useLibrary>;
