"use client";

import { prerequisiteKey, statusLabel } from "../lib/estimate";
import type { PrerequisiteBreakdown } from "../lib/estimate";
import { prerequisiteStatuses } from "../lib/types";
import type { CustomPrerequisite, Estimate, PrerequisiteStatus } from "../lib/types";

const uid = () => `prereq-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type Props = { estimate: Estimate; breakdown: PrerequisiteBreakdown[]; update: (patch: Partial<Estimate>) => void };

export function Prerequisites({ estimate, breakdown, update }: Props) {
  if (!breakdown.length) return <div className="empty-state"><b>No prerequisites for these products</b><span>Add prerequisites per product under Estimate Catalog → Prerequisites, or add engagement-specific ones once a product is selected.</span></div>;
  const answer = (productId: string, itemId: string, patch: Partial<{ value: string; status: PrerequisiteStatus }>) => {
    const key = prerequisiteKey(productId, itemId);
    const current = estimate.prerequisites[key] ?? { value: "", status: "pending" as PrerequisiteStatus };
    const next = { ...current, ...patch };
    if (patch.value !== undefined && patch.status === undefined && next.status === "pending" && patch.value.trim()) next.status = "provided";
    update({ prerequisites: { ...estimate.prerequisites, [key]: next } });
  };
  const setCustom = (productId: string, items: CustomPrerequisite[]) => update({ customPrerequisites: { ...estimate.customPrerequisites, [productId]: items } });
  const custom = (productId: string) => estimate.customPrerequisites[productId] ?? [];
  const addCustom = (productId: string) => setCustom(productId, [...custom(productId), { id: uid(), label: "", value: "", status: "pending" }]);
  const patchCustom = (productId: string, id: string, patch: Partial<CustomPrerequisite>) => setCustom(productId, custom(productId).map((item) => item.id === id ? { ...item, ...patch } : item));

  return (
    <div className="installation-stack">
      {breakdown.map((group) => (
        <section className="installation-frame" key={group.product.id}>
          <header>
            <i>{group.product.mark}</i>
            <span><small>{group.product.portfolio}{group.existing && " · Existing environment"}</small><b>{group.product.name}</b></span>
            <em className={group.pending ? "pending" : "complete"}>{group.pending ? `${group.pending} pending` : "All provided"}</em>
          </header>
          <div className="prereq-list">
            {group.items.filter((item) => !item.custom).map((item) => (
              <div className="prereq-row" key={item.id}>
                <span className="prereq-label"><b>{item.label}{item.required && <i title="Required">*</i>}</b>{item.help && <small>{item.help}</small>}</span>
                <input aria-label={item.label} placeholder={item.placeholder ?? "Value or note"} value={item.value} onChange={(event) => answer(group.product.id, item.id, { value: event.target.value })} />
                <select aria-label={`${item.label} status`} className={`status-${item.status}`} value={item.status} onChange={(event) => answer(group.product.id, item.id, { status: event.target.value as PrerequisiteStatus })}>
                  {prerequisiteStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="other-details">
            <div className="other-title">
              <span><b>Other prerequisites</b><small>Anything this customer must provide that the catalog does not list.</small></span>
              <button type="button" onClick={() => addCustom(group.product.id)} aria-label={`Add ${group.product.short} prerequisite`}>＋</button>
            </div>
            {custom(group.product.id).map((item) => (
              <div className="prereq-row custom" key={item.id}>
                <input aria-label="Prerequisite" placeholder="What is needed…" value={item.label} onChange={(event) => patchCustom(group.product.id, item.id, { label: event.target.value })} />
                <input aria-label="Value" placeholder="Value or note" value={item.value} onChange={(event) => patchCustom(group.product.id, item.id, { value: event.target.value, ...(item.status === "pending" && event.target.value.trim() ? { status: "provided" as const } : {}) })} />
                <select aria-label="Status" className={`status-${item.status}`} value={item.status} onChange={(event) => patchCustom(group.product.id, item.id, { status: event.target.value as PrerequisiteStatus })}>
                  {prerequisiteStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                </select>
                <button type="button" onClick={() => setCustom(group.product.id, custom(group.product.id).filter((line) => line.id !== item.id))} aria-label="Remove prerequisite">−</button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
