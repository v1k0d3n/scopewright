"use client";

import { useRef, useState } from "react";
import { builtInThemes, defaultBranding, defaultCatalog, fontOptions } from "../lib/defaults";
import { CATALOG_FORMAT, isCatalog, mergeCatalog } from "../lib/estimate";
import { activeTheme, isBuiltIn } from "../lib/theme";
import { buildThemePack, parseThemePack } from "../lib/theme-pack";
import type { Branding, Catalog } from "../lib/types";

const uid = () => `theme-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type Props = { branding: Branding; setBranding: (branding: Branding) => void; catalog: Catalog; setCatalog: (catalog: Catalog) => void };

const colorFields: { key: keyof Branding["colors"]; label: string; help: string }[] = [
  { key: "primary", label: "Primary", help: "Buttons, headings, document rules" },
  { key: "accent", label: "Accent", help: "Highlights, focus rings, progress" },
  { key: "ink", label: "Text", help: "Body text" },
  { key: "muted", label: "Muted text", help: "Secondary copy" },
  { key: "paper", label: "Background", help: "Page background" },
  { key: "surface", label: "Surface", help: "Cards and panels" },
  { key: "line", label: "Borders", help: "Dividers and outlines" },
  { key: "sidebar", label: "Sidebar", help: "Navigation background" },
  { key: "sidebarInk", label: "Sidebar text", help: "Navigation text" },
];

export function Settings({ branding, setBranding, catalog, setCatalog }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const faviconInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const themeInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const flash = (text: string) => { setMessage(text); setTimeout(() => setMessage(""), 2500); };
  const patch = (changes: Partial<Branding>) => setBranding({ ...branding, ...changes });
  const setColor = (key: keyof Branding["colors"], value: string) => patch({ colors: { ...branding.colors, [key]: value } });
  const current = activeTheme(branding);
  const applyTheme = (id: string) => { const theme = [...branding.schemes, ...builtInThemes].find((item) => item.id === id); if (theme) patch({ colors: { ...theme.colors } }); };
  const saveScheme = () => {
    const name = window.prompt("Name this color theme", current && !isBuiltIn(current.id) ? current.name : branding.orgName)?.trim();
    if (!name) return;
    const existing = branding.schemes.find((scheme) => scheme.name.toLowerCase() === name.toLowerCase());
    if (existing && !window.confirm(`Replace the colors saved as "${existing.name}"?`)) return;
    const scheme = { id: existing?.id ?? uid(), name, colors: { ...branding.colors } };
    patch({ schemes: existing ? branding.schemes.map((item) => item.id === existing.id ? scheme : item) : [...branding.schemes, scheme] });
    flash(`Saved "${name}".`);
  };
  const deleteScheme = () => {
    if (!current || isBuiltIn(current.id) || !window.confirm(`Delete the "${current.name}" theme? The colors stay applied until you change them.`)) return;
    patch({ schemes: branding.schemes.filter((scheme) => scheme.id !== current.id) });
  };

  const readImage = (file: File | undefined, field: "logo" | "favicon") => {
    if (!file) return;
    if (file.size > 400_000) { flash(`${field === "logo" ? "Logo" : "Favicon"} must be under 400 KB.`); return; }
    const reader = new FileReader();
    reader.onload = () => patch({ [field]: String(reader.result ?? "") });
    reader.readAsDataURL(file);
  };
  const download = (name: string, payload: unknown) => {
    const blob = payload instanceof Uint8Array ? new Blob([payload as BlobPart], { type: "application/zip" }) : new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), { href: url, download: name });
    link.click();
    URL.revokeObjectURL(url);
  };
  const stamp = () => new Date().toISOString().slice(0, 10);
  /** Same format the catalog page used to write, so earlier exports still import. */
  const exportCatalog = () => { download(`scopewright-catalog-${stamp()}.json`, { format: CATALOG_FORMAT, version: 1, exportedAt: new Date().toISOString(), catalog }); flash("Catalog exported."); };
  const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "theme";
  const exportTheme = () => { download(`${slug(branding.orgName)}-theme-${stamp()}.zip`, buildThemePack(branding)); flash("Theme exported."); };
  const importTheme = (file: File | undefined) => {
    if (!file) return;
    file.arrayBuffer().then((buffer) => {
      const next = parseThemePack(new Uint8Array(buffer), defaultBranding, builtInThemes);
      if (!next) { flash("Import failed: choose a theme pack (.zip with theme.json)."); return; }
      if (!window.confirm(`Apply the "${next.orgName}" theme? Colors, fonts, identity, logo, and favicon will be replaced for everyone.`)) return;
      setBranding(next);
      flash(`Applied the ${next.orgName} theme.`);
    });
  };
  const importCatalog = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as { catalog?: unknown };
        if (!isCatalog(data.catalog)) throw new Error("Unrecognized file");
        const next = mergeCatalog(data.catalog, defaultCatalog);
        if (!window.confirm(`Import ${next.products.length} products and ${next.groups.length} deliverable groups? This replaces the shared catalog for everyone.`)) return;
        setCatalog(next);
        flash("Catalog imported.");
      } catch {
        flash("Import failed: choose a catalog JSON export.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="content settings">
      <div className="title-row"><div><span className="eyebrow">SETTINGS</span><h1>Brand the workspace</h1><p>Colors, typography, and identity apply to the whole app and to every scope document you print.</p></div><div className="actions">{message && <span className="flash">{message}</span>}<button type="button" className="secondary" onClick={() => setBranding(defaultBranding)}>Reset to defaults</button></div></div>
      <div className="settings-grid">
        <section className="panel">
          <h3>Identity</h3>
          <label>Organization<input value={branding.orgName} onChange={(event) => patch({ orgName: event.target.value })} /></label>
          <label>Workspace or team name<input value={branding.workspaceName} onChange={(event) => patch({ workspaceName: event.target.value })} /></label>
          <label>Tagline<input value={branding.tagline} onChange={(event) => patch({ tagline: event.target.value })} /></label>
          <label>Sidebar initials<input maxLength={4} value={branding.initials} onChange={(event) => patch({ initials: event.target.value.toUpperCase() })} /></label>
          <div className="logo-field">
            <span>Logo</span>
            <div className="logo-preview" style={{ background: branding.colors.sidebar }}>{branding.logo ? <img src={branding.logo} alt="Logo preview" /> : <small style={{ color: branding.colors.sidebarInk }}>No logo uploaded</small>}</div>
            <div className="row-actions">
              <button type="button" className="secondary" onClick={() => fileInput.current?.click()}>Upload PNG or SVG</button>
              {branding.logo && <button type="button" className="danger" onClick={() => patch({ logo: "" })}>Remove</button>}
            </div>
            <input ref={fileInput} type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" hidden onChange={(event) => { readImage(event.target.files?.[0], "logo"); event.target.value = ""; }} />
          </div>
          <div className="logo-field favicon-field">
            <span>Favicon <small>square SVG, PNG, or ICO · 32–64 px works best</small></span>
            <div className="favicon-row">
              <div className="favicon-preview">{branding.favicon ? <img src={branding.favicon} alt="Favicon preview" /> : <img src="/favicon.svg" alt="Default favicon" />}</div>
              <div className="row-actions">
                <button type="button" className="secondary" onClick={() => faviconInput.current?.click()}>Upload SVG, PNG, or ICO</button>
                {branding.favicon && <button type="button" className="danger" onClick={() => patch({ favicon: "" })}>Use default</button>}
              </div>
            </div>
            <input ref={faviconInput} type="file" accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,.ico" hidden onChange={(event) => { readImage(event.target.files?.[0], "favicon"); event.target.value = ""; }} />
          </div>
        </section>

        <section className="panel">
          <h3>Colors</h3>
          <div className="theme-bar">
            <label className="theme-select">
              <span>Color theme</span>
              <div className="theme-select-row">
                <i className="theme-dots" aria-hidden="true"><b style={{ background: branding.colors.primary }} /><b style={{ background: branding.colors.accent }} /><b style={{ background: branding.colors.sidebar }} /></i>
                <select value={current?.id ?? ""} onChange={(event) => applyTheme(event.target.value)}>
                  {!current && <option value="">Custom (unsaved)</option>}
                  {branding.schemes.length > 0 && <optgroup label="Saved">{branding.schemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</optgroup>}
                  <optgroup label="Built-in">{builtInThemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</optgroup>
                </select>
              </div>
            </label>
            <div className="theme-actions">
              <button type="button" className="secondary" onClick={saveScheme}>{current && !isBuiltIn(current.id) ? "Save as…" : "Save theme…"}</button>
              {current && !isBuiltIn(current.id) && <button type="button" className="danger" onClick={deleteScheme}>Delete</button>}
            </div>
          </div>
          <div className="theme-chips" role="group" aria-label="Built-in color themes">
            {builtInThemes.map((theme) => (
              <button key={theme.id} type="button" className={current?.id === theme.id ? "active" : ""} onClick={() => applyTheme(theme.id)}>
                <i><b style={{ background: theme.colors.primary }} /><b style={{ background: theme.colors.accent }} /><b style={{ background: theme.colors.sidebar }} /></i>{theme.name}
              </button>
            ))}
          </div>
          <div className="color-grid">
            {colorFields.map((field) => (
              <label key={field.key} className="color-field">
                <input type="color" value={branding.colors[field.key]} onChange={(event) => setColor(field.key, event.target.value)} aria-label={field.label} />
                <span><b>{field.label}</b><small>{field.help}</small></span>
                <input className="hex" value={branding.colors[field.key]} maxLength={7} onChange={(event) => /^#[0-9a-fA-F]{0,6}$/.test(event.target.value) && setColor(field.key, event.target.value)} aria-label={`${field.label} hex`} />
              </label>
            ))}
          </div>
        </section>

        <section className="panel">
          <h3>Typography</h3>
          <label>Headings<select value={branding.fonts.heading} onChange={(event) => patch({ fonts: { ...branding.fonts, heading: event.target.value } })}>{fontOptions.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}</select></label>
          <label>Body text<select value={branding.fonts.body} onChange={(event) => patch({ fonts: { ...branding.fonts, body: event.target.value } })}>{fontOptions.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}</select></label>
          <p className="type-sample"><b>Aa</b> The quick brown fox jumps over the lazy dog. 0123456789</p>
        </section>

        <section className="panel">
          <h3>Scope document</h3>
          <label>Footer text<input value={branding.document.footer} onChange={(event) => patch({ document: { ...branding.document, footer: event.target.value } })} /></label>
          <label>Confidentiality label<input value={branding.document.confidentiality} onChange={(event) => patch({ document: { ...branding.document, confidentiality: event.target.value } })} /></label>
          <label className="check"><input type="checkbox" checked={branding.document.showLogo} onChange={(event) => patch({ document: { ...branding.document, showLogo: event.target.checked } })} />Show logo on printed documents</label>
        </section>

        <section className="panel">
          <h3>Theme pack</h3>
          <p className="panel-copy">Everything on this page as one file: a zip with <code>theme.json</code> (identity, colors, fonts, document settings) plus the logo and favicon. Hand it to another team or keep it in version control. Importing replaces the shared theme for everyone.</p>
          <div className="transfer-list">
            <div><span><b>Export theme</b><small>{branding.orgName || "Untitled"} · colors, fonts, identity, logo, favicon</small></span><button type="button" className="secondary" onClick={exportTheme}>Export .zip</button></div>
            <div><span><b>Import theme</b><small>A theme pack exported from this page</small></span><button type="button" className="primary" onClick={() => themeInput.current?.click()}>Import .zip</button></div>
          </div>
          <input ref={themeInput} type="file" accept="application/zip,.zip" hidden onChange={(event) => { importTheme(event.target.files?.[0]); event.target.value = ""; }} />
        </section>

        <section className="panel">
          <h3>Estimate catalog</h3>
          <p className="panel-copy">Products, installation questions, prerequisites, and deliverables as versioned JSON. The catalog is shared by everyone who opens this workspace; each person’s working estimate stays in their own browser.</p>
          <div className="transfer-list">
            <div><span><b>Export catalog</b><small>{catalog.products.length} products · {catalog.groups.length} deliverable groups</small></span><button type="button" className="secondary" onClick={exportCatalog}>Export .json</button></div>
            <div><span><b>Import catalog</b><small>Replaces the shared catalog</small></span><button type="button" className="primary" onClick={() => importInput.current?.click()}>Import .json</button></div>
          </div>
          <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={(event) => { importCatalog(event.target.files?.[0]); event.target.value = ""; }} />
        </section>
      </div>
    </div>
  );
}
