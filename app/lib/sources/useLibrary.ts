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

/**
 * `tab` storage (sessionStorage) survives a reload but belongs to one tab;
 * `browser` storage (localStorage) is shared by every tab. Which document is
 * open is per tab, like the lock token: shared, a second tab opening another
 * file would repoint this one on its next reload, and its Save would land in
 * the wrong file.
 */
function readJson<T>(key: string, where: "tab" | "browser" = "browser"): T | null {
  try {
    return JSON.parse((where === "tab" ? window.sessionStorage : window.localStorage).getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown, where: "tab" | "browser" = "browser") {
  try {
    const storage = where === "tab" ? window.sessionStorage : window.localStorage;
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
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
  // Bumped whenever the open document is let go. A save still in flight compares it on return and, if it moved, does not re-attach the file.
  const epoch = useRef(0);
  const ownerRef = useRef(owner);
  useEffect(() => { ownerRef.current = owner; }, [owner]);

  const setActive = useCallback((next: ActiveDocument | null) => { setActiveState(next); writeJson(ACTIVE_KEY, next, "tab"); }, []);
  const letGo = useCallback(() => { epoch.current += 1; setActive(null); }, [setActive]);
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
        // Builds before release kept this pointer in shared storage; it cannot be trusted to be this tab's, so drop it.
        writeJson(ACTIVE_KEY, null);
        const remembered = readJson<ActiveDocument>(ACTIVE_KEY, "tab");
        const wanted = sourceById(remembered?.sourceId ?? readJson<string>(SOURCE_KEY) ?? "browser");
        const start = usable(wanted) ? wanted : sources[0];
        if (remembered && remembered.sourceId === start.id) setActiveState(remembered);
        else if (remembered) writeJson(ACTIVE_KEY, null, "tab");
        void switchTo(start, ctx);
      });
    return () => { cancelled = true; };
  }, [switchTo]);

  // Hold the lock while a document is open. Losing it (someone took over after it lapsed) is reported, not hidden.
  useEffect(() => {
    if (!active) return;
    // The document's own source, not the selected one: browsing another source, or choosing one in Save as, must not let this lock lapse.
    const target = sourceById(active.sourceId);
    const selected = target.id === provider.id;
    if (selected && state !== "ready") return;
    const renew = async () => {
      try {
        if (!selected && !(await target.resume(context))) throw new NotConnectedError(`${target.label} needs reconnecting.`);
        const other = await acquire(target, active.id, ownerRef.current, token.current, Date.now());
        if (other) setError(`${other.owner} now has “${active.name}” open. Your changes cannot be saved over theirs; export a copy if you need to keep them.`);
      } catch (problem) {
        // A missed renewal is retried on the next tick, but a lapsed session needs the user.
        if (problem instanceof NotConnectedError) { setError(`${problem.message} Until then “${active.name}” is not held for you.`); if (selected) setState("needs-connect"); }
      }
    };
    void renew();
    const timer = window.setInterval(renew, RENEW_MINUTES * 60_000);
    return () => window.clearInterval(timer);
  }, [active, provider, state, context]);

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
    if (active?.sourceId === provider.id) { await release(provider, active.id, token.current, Date.now()).catch(() => {}); letGo(); }
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
      if (leaving) letGo();
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
    epoch.current += 1;
    setActive({ sourceId: provider.id, id: doc.id, name: doc.name, revision: body.revision });
    await refresh(provider).catch(() => {});
    return { payload: body.payload };
  };

  // A folder permission or a cloud session can lapse while the page is open; saves run from a click, so reconnecting is allowed.
  const ready = async (target: SourceProvider) => { usableOrThrow(target); if (!(await target.resume(context))) await target.connect(context); };

  const adopt = async (target: SourceProvider, written: { id: string; name: string; revision: string; notice?: string }, takeLock: boolean, started: number) => {
    const saved = { sourceId: target.id, id: written.id, name: written.name, revision: written.revision };
    // The user moved on (New estimate, Import, Open, ...) while this write was in flight. The file is saved, which is what
    // they asked for, but it is no longer the open document: do not re-attach it to whatever is in the builder now, and do not hold it.
    if (started !== epoch.current) {
      await release(target, written.id, token.current, Date.now()).catch(() => {});
      if (target.id === provider.id) await refresh(provider).catch(() => {});
      return saved;
    }
    if (takeLock) {
      // The file is written; whether it is ours to keep editing depends on the lock. A failure here is reported, not swallowed.
      const other = await acquire(target, written.id, ownerRef.current, token.current, Date.now());
      if (started !== epoch.current) { await release(target, written.id, token.current, Date.now()).catch(() => {}); return saved; }
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
    const started = epoch.current;
    const target = sourceById(active.sourceId);
    await ready(target);
    // Our lock may have lapsed while this tab was in the background, and someone who opened the file since has not
    // changed its revision yet. Renew the lock now; if it is theirs, stop. Being refused writes nothing, so no lock is left behind.
    const other = await acquire(target, active.id, ownerRef.current, token.current, Date.now());
    if (other) throw new Error(`${other.owner} opened “${active.name}” after your hold on it lapsed, so it was not saved over theirs. Use Save as to keep your version under another name.`);
    return adopt(target, await target.write(active.id, active.name, payload, active.revision), false, started);
  };

  /**
   * Save as: write to a named file in the selected source. A file of that name
   * is replaced, after `confirmReplace` agrees, never duplicated; one that
   * someone else has open is left alone.
   */
  const saveAs = async (name: string, payload: unknown, confirmReplace: (existing: DocumentRef) => boolean) => {
    setError("");
    const started = epoch.current;
    await ready(provider);
    const existing = (await provider.list()).find((doc) => doc.name.toLowerCase() === name.toLowerCase());
    const mine = existing && active?.sourceId === provider.id && active.id === existing.id;
    if (existing && !mine) {
      if (lockedByOther(existing.lock, token.current, Date.now())) throw new Error(`${existing.lock!.owner} has “${existing.name}” open, so it cannot be replaced. Choose another name.`);
      if (!confirmReplace(existing)) throw new DOMException("Cancelled", "AbortError");
    }
    // Replacing a file: hold it before writing, so nobody can open it in between.
    if (existing) {
      const other = await acquire(provider, existing.id, ownerRef.current, token.current, Date.now());
      if (other) throw new Error(`${other.owner} has “${existing.name}” open, so it cannot be replaced. Choose another name.`);
    }
    // Replacing another file was confirmed by the user, so it is unconditional. Writing to the one open here is an ordinary save and keeps its revision check.
    const written = await provider.write(existing?.id ?? null, name, payload, mine ? active.revision : null).catch(async (problem) => {
      if (existing && !mine) await release(provider, existing.id, token.current, Date.now()).catch(() => {});
      throw problem;
    });
    // Let go of the previous file only once the new one is really ours: if adopt throws, the old file is still open and still held.
    const previous = active && !mine ? active : null;
    const saved = await adopt(provider, written, true, started);
    if (previous && started === epoch.current) await release(sourceById(previous.sourceId), previous.id, token.current, Date.now()).catch(() => {});
    return saved;
  };

  /** Stop editing the open document and free it for others. */
  const close = async () => {
    if (!active) return;
    // Invalidate first, so a save that returns while the lock is being released already knows.
    const closing = active;
    letGo();
    await release(sourceById(closing.sourceId), closing.id, token.current, Date.now()).catch(() => {});
    if (state === "ready") await refresh(provider).catch(() => {});
  };

  const remove = async (doc: DocumentRef) => {
    setError("");
    try {
      // Enforced here as well as in the list: the builder would be left showing a file that no longer exists as saved.
      if (active?.id === doc.id && active.sourceId === provider.id) throw new Error(`“${doc.name}” is open here. Start a new estimate or open another one before deleting it.`);
      const lock = await provider.readLock(doc.id);
      if (lockedByOther(lock, token.current, Date.now())) { await refresh(provider).catch(() => {}); throw new Error(`${lock!.owner} has “${doc.name}” open, so it cannot be deleted.`); }
      await provider.remove(doc.id);
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
