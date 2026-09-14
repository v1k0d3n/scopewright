"use client";

import { useEffect, useState } from "react";

const PREFIX = "scopewright:";

/**
 * useState that survives a page refresh.
 *
 * The first render always uses `initial` so server and client markup match;
 * the stored value is applied in an effect, and every later change is written
 * back. `merge` lets callers upgrade older stored shapes with new defaults.
 */
export function usePersistentState<T>(key: string, initial: T, merge?: (stored: unknown, initial: T) => T) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  // Captured once: callers may pass a fresh `initial` object on every render.
  const [config] = useState(() => ({ initial, merge }));
  useEffect(() => {
    // Hydration: the stored value can only be read on the client, after the
    // first render, so a synchronous setState here is intentional.
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const raw = window.localStorage.getItem(PREFIX + key);
      if (raw !== null) {
        const stored = JSON.parse(raw) as unknown;
        setValue(config.merge ? config.merge(stored, config.initial) : (stored as T));
      }
    } catch {
      /* corrupt or unavailable storage: keep the defaults */
    }
    setLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [key, config]);
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* quota exceeded or private mode: the app keeps working in memory */
    }
  }, [key, value, loaded]);
  return [value, setValue, loaded] as const;
}

export function clearPersistentState(key: string) {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

export type SyncStatus = "loading" | "synced" | "saving" | "local" | "error" | "readonly";

/**
 * State shared by everyone who opens the workspace.
 *
 * Loads from the server's /api/workspace/<key> on mount and writes back,
 * debounced, on every change. localStorage is kept as a cache so the page
 * renders something useful before the fetch returns and keeps working if the
 * API is unreachable (for example a static preview); in that case status is
 * "local" and changes stay in this browser only.
 */
export function useSharedState<T>(key: string, initial: T, merge: (stored: unknown, initial: T) => T) {
  const [value, setValue] = useState<T>(initial);
  const [status, setStatus] = useState<SyncStatus>("loading");
  const [config] = useState(() => ({ initial, merge }));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const raw = window.localStorage.getItem(PREFIX + key);
      if (raw !== null) setValue(config.merge(JSON.parse(raw), config.initial));
    } catch {
      /* no cache */
    }
    fetch(`/api/workspace/${key}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { value: unknown | null };
        if (cancelled) return;
        // The server is the source of truth: a missing document means defaults,
        // even if this browser cached an older value.
        setValue(body.value !== null && body.value !== undefined ? config.merge(body.value, config.initial) : config.initial);
        setStatus("synced");
      })
      .catch(() => {
        if (!cancelled) setStatus("local");
      });
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      cancelled = true;
    };
  }, [key, config]);

  useEffect(() => {
    if (!dirty) return;
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
    if (status === "local" || status === "loading") return;
    const timer = window.setTimeout(() => {
      fetch(`/api/workspace/${key}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(value) })
        .then((response) => setStatus(response.ok ? "synced" : response.status === 401 || response.status === 403 ? "readonly" : "error"))
        .catch(() => setStatus("error"));
    }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value, dirty]);

  const update = (next: T) => {
    setDirty(true);
    setValue(next);
    if (status === "synced" || status === "error" || status === "readonly") setStatus("saving");
  };
  return [value, update, status] as const;
}
