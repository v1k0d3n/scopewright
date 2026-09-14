"use client";

import type { Product, SolutionTemplate } from "../lib/types";

export function ProductChooser({ products, selected, templates, onToggle, onTemplate }: { products: Product[]; selected: string[]; templates: SolutionTemplate[]; onToggle: (id: string) => void; onTemplate: (ids: string[]) => void }) {
  const portfolios = Array.from(new Set(products.map((product) => product.portfolio)));
  if (!products.length) return <div className="empty-state"><span>＋</span><b>No products in the catalog yet</b><p>Open Estimate catalog → Products to add the products and services your team delivers, or import a catalog from Settings.</p></div>;
  // Only offer solutions whose products all still exist in the catalog.
  const usable = templates.filter((template) => template.products.length > 0 && template.products.every((id) => products.some((product) => product.id === id)));
  return (
    <div className="product-chooser">
      {usable.length > 0 && (
        <>
          <div className="template-strip">
            {usable.map((template) => (
              <button key={template.id} type="button" onClick={() => onTemplate(template.products)}>
                {template.label && <span>{template.label}</span>}
                <b>{template.title}</b>
                {template.subtitle && <small>{template.subtitle}</small>}
              </button>
            ))}
          </div>
          <div className="or-divider"><span>or build by product</span></div>
        </>
      )}
      <div className="portfolio-groups">
        {portfolios.map((portfolio) => (
          <section key={portfolio}>
            <h3>{portfolio}</h3>
            <div className="product-grid">
              {products.filter((product) => product.portfolio === portfolio).map((product) => {
                const on = selected.includes(product.id);
                const requires = (product.requires ?? []).map((id) => products.find((item) => item.id === id)?.short).filter(Boolean);
                return (
                  <button key={product.id} type="button" className={on ? "selected" : ""} aria-pressed={on} onClick={() => onToggle(product.id)}>
                    <i>{product.mark}</i>
                    <span>
                      <b>{product.short}</b>
                      <small>{product.name}</small>
                      {requires.length > 0 && <small className="requires">Requires {requires.join(", ")}</small>}
                    </span>
                    <em>{on ? "✓" : "+"}</em>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
