"use client";

import { lockedByOther } from "../lib/sources/locks";
import type { Library as LibraryModel } from "../lib/sources/useLibrary";
import type { DocumentRef } from "../lib/sources/types";

const when = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const clock = (time: number) => new Date(time).toLocaleTimeString(undefined, { timeStyle: "short" });

export function Library({ library, now, hasDraft, onOpen, onSaveNew, onRefresh }: { library: LibraryModel; now: number; hasDraft: boolean; onOpen: (doc: DocumentRef) => void; onSaveNew: () => void; onRefresh: () => void }) {
  const { provider, state, documents, active, error } = library;
  const needsSetup = provider.id !== "browser";
  return (
    <div className="content library">
      <div className="title-row">
        <div><span className="eyebrow">SAVED ESTIMATES</span><h1>Your estimates</h1><p>Save estimates to a place you choose and open them again later. An estimate that someone has open is locked until they close it.</p></div>
        <div className="actions"><button type="button" className="primary" disabled={!hasDraft || state === "loading"} onClick={onSaveNew}>Save current estimate here</button></div>
      </div>

      <div className="source-picker" role="radiogroup" aria-label="Where estimates are saved">
        {library.offered.map((source) => {
          const reason = source.unavailable(library.context);
          return (
            <button key={source.id} type="button" role="radio" aria-checked={source.id === provider.id} disabled={Boolean(reason)} className={source.id === provider.id ? "source-card selected" : "source-card"} onClick={() => library.select(source.id)}>
              <b>{source.label}</b>
              <span>{reason ?? source.description}</span>
            </button>
          );
        })}
      </div>

      <div className="notice"><b>Your estimates stay with you</b><span>Files go straight from this browser to the place you choose. They are never sent to or stored on the Scopewright server.</span></div>
      {error && <div className="notice notice-error" role="alert"><b>Something needs attention</b><span>{error}</span></div>}

      {state === "needs-connect" && (
        <div className="library-empty">
          <p>{provider.description}</p>
          <button type="button" className="primary" onClick={library.connect}>Connect {provider.label.toLowerCase()}</button>
        </div>
      )}

      {state === "ready" && (
        <>
          <div className="library-bar">
            <span>{provider.location()} · {documents.length} estimate{documents.length === 1 ? "" : "s"}</span>
            <span className="row-actions">
              <button type="button" className="link" onClick={onRefresh}>Refresh</button>
              {needsSetup && <button type="button" className="link" onClick={library.disconnect}>Disconnect</button>}
            </span>
          </div>
          {!documents.length && <div className="library-empty"><p>Nothing saved here yet. Build an estimate, then use “Save current estimate here”.</p></div>}
          <div className="library-list">
            {documents.map((doc) => {
              const mine = active?.id === doc.id && active.sourceId === provider.id;
              const locked = !mine && lockedByOther(doc.lock, library.token, now);
              return (
                <div key={doc.id} className={mine ? "library-row open" : "library-row"}>
                  <div>
                    <b>{doc.customer || "Untitled customer"}</b>
                    <span>{doc.title || "Untitled engagement"}</span>
                    <small>{doc.name}</small>
                  </div>
                  <span className="library-hours">{doc.totalHours === null ? "" : `${doc.totalHours}h`}</span>
                  <span className="library-when">{when(doc.updatedAt)}</span>
                  <span className={mine ? "lock-badge mine" : locked ? "lock-badge" : "lock-badge free"}>{mine ? "Open here" : locked ? `Locked by ${doc.lock!.owner} until ${clock(doc.lock!.until)}` : "Available"}</span>
                  <span className="row-actions">
                    <button type="button" className="secondary" disabled={locked || mine} onClick={() => onOpen(doc)}>{mine ? "Opened" : "Open"}</button>
                    <button type="button" className="danger" disabled={locked} onClick={() => window.confirm(`Delete “${doc.name}” from ${provider.label.toLowerCase()}? This cannot be undone.`) && library.remove(doc)}>Delete</button>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
