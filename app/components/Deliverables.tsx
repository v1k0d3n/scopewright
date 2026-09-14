"use client";

import { phases } from "../lib/types";
import type { DeliverableGroup, Product } from "../lib/types";

export function Deliverables({ groups, products, selected, setSelected }: { groups: DeliverableGroup[]; products: Product[]; selected: string[]; setSelected: (ids: string[]) => void }) {
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  const toggleGroup = (group: DeliverableGroup) => {
    const ids = group.tasks.map((task) => task.id);
    const all = ids.every((id) => selected.includes(id));
    setSelected(all ? selected.filter((id) => !ids.includes(id)) : Array.from(new Set([...selected, ...ids])));
  };
  if (!groups.length) return <div className="empty-state"><span>＋</span><b>No deliverables are available for these products</b><p>Open the Estimate Catalog, add deliverable groups for the selected products, and turn on “Offer in workflow” for each task.</p></div>;
  const productName = (id: string) => products.find((product) => product.id === id)?.short ?? "Any product";
  return (
    <div className="capability-phases">
      {phases.map((phase, index) => {
        const inPhase = groups.map((group) => ({ ...group, tasks: group.tasks.filter((task) => task.phase === phase) })).filter((group) => group.tasks.length);
        if (!inPhase.length) return null;
        const hours = inPhase.flatMap((group) => group.tasks).filter((task) => selected.includes(task.id)).reduce((sum, task) => sum + task.hours, 0);
        return (
          <details key={phase} open={index < 3}>
            <summary><span>{phase}</span><em>{inPhase.reduce((sum, group) => sum + group.tasks.length, 0)} deliverables</em><b>{hours}h</b></summary>
            <div className="phase-body">
              {inPhase.map((group) => (
                <section key={group.id}>
                  <header>
                    <span><b>{group.scopeNumber && `${group.scopeNumber} · `}{group.name}</b><small>{group.category} · {productName(group.productId)}</small></span>
                    <button type="button" onClick={() => toggleGroup(group)}>{group.tasks.every((task) => selected.includes(task.id)) ? "Clear" : "Select all"}</button>
                  </header>
                  {group.tasks.map((task) => (
                    <label key={task.id}>
                      <input type="checkbox" checked={selected.includes(task.id)} onChange={() => toggle(task.id)} />
                      <span>{task.scopeNumber && <em className="item-number">{task.scopeNumber}</em>}{task.name}</span>
                      <strong>{task.hours}h</strong>
                    </label>
                  ))}
                </section>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}
