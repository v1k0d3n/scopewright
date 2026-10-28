"use client";

import { useEffect, useRef } from "react";
import { MAX_COLUMNS, MAX_ROWS, PLACEHOLDERS, unknownPlaceholders } from "../lib/estimate";
import { useDialogFocus } from "../lib/useDialogFocus";
import type { CustomBlock, CustomSection } from "../lib/types";

type Props = { section: CustomSection; onChange: (section: CustomSection) => void; onDelete: () => void; onClose: () => void };

const placeholderList = PLACEHOLDERS.map((name) => `{${name}}`).join(" ");

const move = <T,>(items: T[], from: number, to: number) => { if (to < 0 || to >= items.length) return items; const next = [...items]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; };

/** Writes one custom section: a title, then text and tables in order. Changes apply as they are typed. */
export function CustomSectionEditor({ section, onChange, onDelete, onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLInputElement>(null);
  useDialogFocus(dialog);
  useEffect(() => { title.current?.focus(); }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  const setBlocks = (blocks: CustomBlock[]) => onChange({ ...section, blocks });
  const setBlock = (index: number, block: CustomBlock) => setBlocks(section.blocks.map((item, at) => (at === index ? block : item)));
  const unknown = unknownPlaceholders([section.title, ...section.blocks.flatMap((block) => (block.kind === "text" ? [block.text] : [...block.columns, ...block.rows.flat()]))].join("\n"));
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialog} className="modal section-editor" role="dialog" aria-modal="true" aria-labelledby="section-editor-title">
        <h2 id="section-editor-title">Custom section</h2>
        <label>Title<input ref={title} value={section.title} placeholder="e.g. Contacts" onChange={(event) => onChange({ ...section, title: event.target.value })} /></label>
        <p className="modal-note">Written for this estimate. {placeholderList} are filled in from the estimate when the document is printed.</p>
        {section.blocks.map((block, index) => (
          <section className="section-block" key={index}>
            <header>
              <b>{block.kind === "text" ? "Text" : "Table"}</b>
              <div className="row-actions">
                <button type="button" className="icon" aria-label="Move up" disabled={index === 0} onClick={() => setBlocks(move(section.blocks, index, index - 1))}>↑</button>
                <button type="button" className="icon" aria-label="Move down" disabled={index === section.blocks.length - 1} onClick={() => setBlocks(move(section.blocks, index, index + 1))}>↓</button>
                <button type="button" className="link" onClick={() => setBlocks(section.blocks.filter((_, at) => at !== index))}>Remove</button>
              </div>
            </header>
            {block.kind === "text"
              ? <TextBlock block={block} onChange={(next) => setBlock(index, next)} />
              : <TableBlock block={block} onChange={(next) => setBlock(index, next)} />}
          </section>
        ))}
        {section.blocks.length === 0 && <p className="modal-note">Nothing written yet. Add text or a table.</p>}
        {unknown.length > 0 && <p className="modal-note needs-answer">Not a placeholder, so it prints as typed: {unknown.map((name) => `{${name}}`).join(" ")}</p>}
        <div className="section-editor-add">
          <button type="button" className="secondary" onClick={() => setBlocks([...section.blocks, { kind: "text", text: "" }])}>+ Text</button>
          <button type="button" className="secondary" onClick={() => setBlocks([...section.blocks, { kind: "table", columns: ["", ""], rows: [["", ""]] }])}>+ Table</button>
        </div>
        <div className="modal-actions">
          <button type="button" className="destructive-outline modal-aside" onClick={onDelete}>Delete section</button>
          <button type="button" className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function TextBlock({ block, onChange }: { block: Extract<CustomBlock, { kind: "text" }>; onChange: (block: CustomBlock) => void }) {
  return (
    <label className="section-text">Text
      <textarea rows={6} value={block.text} onChange={(event) => onChange({ ...block, text: event.target.value })} />
      <small>Leave a blank line between paragraphs. Start a line with “- ” to make a list.</small>
    </label>
  );
}

function TableBlock({ block, onChange }: { block: Extract<CustomBlock, { kind: "table" }>; onChange: (block: CustomBlock) => void }) {
  const { columns, rows } = block;
  const setCell = (row: number, column: number, value: string) => onChange({ ...block, rows: rows.map((cells, at) => (at === row ? cells.map((cell, index) => (index === column ? value : cell)) : cells)) });
  const removeColumn = (column: number) => onChange({ kind: "table", columns: columns.filter((_, index) => index !== column), rows: rows.map((cells) => cells.filter((_, index) => index !== column)) });
  return (
    <div className="section-table">
      <div className="section-table-scroll">
        <table>
          <thead>
            {columns.length > 1 && (
              <tr className="column-actions">
                {columns.map((_, index) => <th key={index}><button type="button" className="icon" aria-label={`Remove column ${index + 1}`} onClick={() => removeColumn(index)}>×</button></th>)}
                <th aria-hidden="true" />
              </tr>
            )}
            <tr>
              {columns.map((column, index) => <th key={index}><input aria-label={`Column ${index + 1} heading`} placeholder={`Column ${index + 1}`} value={column} onChange={(event) => onChange({ ...block, columns: columns.map((item, at) => (at === index ? event.target.value : item)) })} /></th>)}
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, row) => (
              <tr key={row}>
                {cells.map((cell, column) => <td key={column}><input aria-label={`Row ${row + 1}, ${columns[column] || `column ${column + 1}`}`} value={cell} onChange={(event) => setCell(row, column, event.target.value)} /></td>)}
                <td><button type="button" className="icon" aria-label={`Remove row ${row + 1}`} onClick={() => onChange({ ...block, rows: rows.filter((_, at) => at !== row) })}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="section-editor-add">
        <button type="button" className="secondary" disabled={rows.length >= MAX_ROWS} onClick={() => onChange({ ...block, rows: [...rows, columns.map(() => "")] })}>+ Row</button>
        <button type="button" className="secondary" disabled={columns.length >= MAX_COLUMNS} onClick={() => onChange({ kind: "table", columns: [...columns, ""], rows: rows.map((cells) => [...cells, ""]) })}>+ Column</button>
      </div>
    </div>
  );
}
