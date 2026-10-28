"use client";

import type { Ref } from "react";
import { SECTION_LIMITS, unknownPlaceholders } from "../lib/estimate";
import type { CustomBlock } from "../lib/types";

export type SectionContent = { title: string; blocks: CustomBlock[] };

type Props = {
  value: SectionContent;
  onChange: (value: SectionContent) => void;
  /** Shown but not editable, as for a section copied from a locked template. */
  readOnly?: boolean;
  titleRef?: Ref<HTMLInputElement>;
};

const move = <T,>(items: T[], from: number, to: number) => { if (to < 0 || to >= items.length) return items; const next = [...items]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; };

/** A custom section's title, then its text and tables in order. Shared by the estimate's editor and the catalog's section templates. */
export function SectionFields({ value, onChange, readOnly = false, titleRef }: Props) {
  const { title, blocks } = value;
  const setBlocks = (next: CustomBlock[]) => onChange({ title, blocks: next });
  const full = blocks.length >= SECTION_LIMITS.blocks;
  const setBlock = (index: number, block: CustomBlock) => setBlocks(blocks.map((item, at) => (at === index ? block : item)));
  const unknown = unknownPlaceholders([title, ...blocks.flatMap((block) => (block.kind === "text" ? [block.text] : [...block.columns, ...block.rows.flat()]))].join("\n"));
  return (
    // A disabled fieldset turns off every input and button inside it at once.
    <fieldset className="section-fields" disabled={readOnly}>
      <label>Title<input ref={titleRef} value={title} maxLength={SECTION_LIMITS.title} placeholder="e.g. Contacts" onChange={(event) => onChange({ title: event.target.value, blocks })} /></label>
      {blocks.map((block, index) => (
        <section className="section-block" key={index}>
          <header>
            <b>{block.kind === "text" ? "Text" : "Table"}</b>
            {!readOnly && (
              <div className="row-actions">
                <button type="button" className="icon" aria-label="Move up" disabled={index === 0} onClick={() => setBlocks(move(blocks, index, index - 1))}>↑</button>
                <button type="button" className="icon" aria-label="Move down" disabled={index === blocks.length - 1} onClick={() => setBlocks(move(blocks, index, index + 1))}>↓</button>
                <button type="button" className="remove-block" aria-label={`Remove this ${block.kind === "text" ? "text" : "table"}`} onClick={() => setBlocks(blocks.filter((_, at) => at !== index))}>Remove</button>
              </div>
            )}
          </header>
          {block.kind === "text"
            ? <TextBlock block={block} onChange={(next) => setBlock(index, next)} />
            : <TableBlock block={block} readOnly={readOnly} onChange={(next) => setBlock(index, next)} />}
        </section>
      ))}
      {blocks.length === 0 && <p className="modal-note">Nothing written yet. Add text or a table.</p>}
      {unknown.length > 0 && <p className="modal-note needs-answer">Not a placeholder, so it prints as typed: {unknown.map((name) => `{${name}}`).join(" ")}</p>}
      {!readOnly && (
        <div className="section-editor-add">
          <button type="button" className="secondary" disabled={full} onClick={() => setBlocks([...blocks, { kind: "text", text: "" }])}>+ Text</button>
          <button type="button" className="secondary" disabled={full} onClick={() => setBlocks([...blocks, { kind: "table", columns: ["", ""], rows: [["", ""]] }])}>+ Table</button>
          {full && <small>A section holds up to {SECTION_LIMITS.blocks} blocks.</small>}
        </div>
      )}
    </fieldset>
  );
}

function TextBlock({ block, onChange }: { block: Extract<CustomBlock, { kind: "text" }>; onChange: (block: CustomBlock) => void }) {
  return (
    <label className="section-text">Text
      <textarea rows={6} maxLength={SECTION_LIMITS.text} value={block.text} onChange={(event) => onChange({ ...block, text: event.target.value })} />
      <small>Leave a blank line between paragraphs. Start a line with “- ” for a bullet or “1. ” for a numbered list; indent it two spaces to put it under the line above.</small>
    </label>
  );
}

function TableBlock({ block, readOnly, onChange }: { block: Extract<CustomBlock, { kind: "table" }>; readOnly: boolean; onChange: (block: CustomBlock) => void }) {
  const { columns, rows } = block;
  const setCell = (row: number, column: number, value: string) => onChange({ ...block, rows: rows.map((cells, at) => (at === row ? cells.map((cell, index) => (index === column ? value : cell)) : cells)) });
  const removeColumn = (column: number) => onChange({ kind: "table", columns: columns.filter((_, index) => index !== column), rows: rows.map((cells) => cells.filter((_, index) => index !== column)) });
  return (
    <div className="section-table">
      <div className="section-table-scroll">
        <table>
          <thead>
            {!readOnly && columns.length > 1 && (
              <tr className="column-actions">
                {columns.map((_, index) => <th key={index}><button type="button" className="icon" aria-label={`Remove column ${index + 1}`} onClick={() => removeColumn(index)}>×</button></th>)}
                <th aria-hidden="true" />
              </tr>
            )}
            <tr>
              {columns.map((column, index) => <th key={index}><input aria-label={`Column ${index + 1} heading`} placeholder={`Column ${index + 1}`} maxLength={SECTION_LIMITS.heading} value={column} onChange={(event) => onChange({ ...block, columns: columns.map((item, at) => (at === index ? event.target.value : item)) })} /></th>)}
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, row) => (
              <tr key={row}>
                {cells.map((cell, column) => <td key={column}><input aria-label={`Row ${row + 1}, ${columns[column] || `column ${column + 1}`}`} maxLength={SECTION_LIMITS.cell} value={cell} onChange={(event) => setCell(row, column, event.target.value)} /></td>)}
                {!readOnly && <td><button type="button" className="icon" aria-label={`Remove row ${row + 1}`} onClick={() => onChange({ ...block, rows: rows.filter((_, at) => at !== row) })}>×</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && <div className="section-editor-add">
        <button type="button" className="secondary" disabled={rows.length >= SECTION_LIMITS.rows} onClick={() => onChange({ ...block, rows: [...rows, columns.map(() => "")] })}>+ Row</button>
        <button type="button" className="secondary" disabled={columns.length >= SECTION_LIMITS.columns} onClick={() => onChange({ kind: "table", columns: [...columns, ""], rows: rows.map((cells) => [...cells, ""]) })}>+ Column</button>
      </div>}
    </div>
  );
}
