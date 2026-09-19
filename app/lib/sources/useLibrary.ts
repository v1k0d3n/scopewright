"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { acquire, release, RENEW_MINUTES } from "./locks.ts";
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
        setContext(ctx);
        setOffered(allowed.length ? allowed : [sources[0]]);
        const remembered = readJson<ActiveDocument>(ACTIVE_KEY);
        const wanted = sourceById(remembered?.sourceId ?? readJson<string>(SOURCE_KEY) ?? "browser");
        const start = allowed.includes(wanted) ? wanted : sources[0];
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

  const connect = async () => {
    setError("");
    try {
      await provider.connect(context);
      await refresh(provider);
      setState("ready");
    } catch (problem) {
      // Closing the picker is not an error worth showing.
      if (!(problem instanceof DOMException && problem.name === "AbortError")) fail(problem);
    }
  };

  const disconnect = async () => {
    if (active?.sourceId === provider.id) { await release(provider, active.id, token.current).catch(() => {}); setActive(null); }
    await provider.disconnect().catch(() => {});
    setDocuments([]);
    setState("needs-connect");
  };

  /** Resolves to the payload, or to the lock that blocks opening. */
  const open = async (doc: DocumentRef): Promise<{ payload: unknown } | { blockedBy: LockInfo }> => {
    setError("");
    const other = await acquire(provider, doc.id, ownerRef.current, token.current, Date.now());
    if (other) { await refresh(provider).catch(() => {}); return { blockedBy: other }; }
    const body = await provider.read(doc.id);
    if (active && (active.id !== doc.id || active.sourceId !== provider.id)) await release(sourceById(active.sourceId), active.id, token.current).catch(() => {});
    setActive({ sourceId: provider.id, id: doc.id, name: doc.name, revision: body.revision });
    await refresh(provider).catch(() => {});
    return { payload: body.payload };
  };

  /** Save over the open document, or as a new one in the selected source when `asNew`. */
  const save = async (name: string, payload: unknown, asNew: boolean) => {
    setError("");
    const target = !asNew && active ? sourceById(active.sourceId) : provider;
    // A folder permission or a cloud session can lapse while the page is open; this runs from a click, so reconnecting is allowed.
    if (!(await target.resume(context))) await target.connect(context);
    const written = await target.write(asNew ? null : active?.id ?? null, name, payload, asNew ? null : active?.revision ?? null);
    if (asNew && active) await release(sourceById(active.sourceId), active.id, token.current).catch(() => {});
    const saved = { sourceId: target.id, id: written.id, name: written.name, revision: written.revision };
    setActive(saved);
    if (asNew || !active) await acquire(target, written.id, ownerRef.current, token.current, Date.now()).catch(() => {});
    if (target.id === provider.id) { setState("ready"); await refresh(provider).catch(() => {}); }
    return saved;
  };

  /** Stop editing the open document and free it for others. */
  const close = async () => {
    if (!active) return;
    await release(sourceById(active.sourceId), active.id, token.current).catch(() => {});
    setActive(null);
    if (state === "ready") await refresh(provider).catch(() => {});
  };

  const remove = async (doc: DocumentRef) => {
    setError("");
    try {
      await provider.remove(doc.id);
      if (active?.id === doc.id && active.sourceId === provider.id) setActive(null);
      await refresh(provider);
    } catch (problem) { fail(problem); }
  };

  return {
    offered, context, provider, state, documents, active, error, token: tokenValue,
    select: (id: string) => switchTo(sourceById(id), context),
    reload: () => refresh(provider).catch(fail),
    connect, disconnect, open, save, close, remove, setError,
  };
}

export type Library = ReturnType<typeof useLibrary>;
