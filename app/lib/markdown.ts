/**
 * Markdown in custom section text, read into the document's own blocks.
 *
 * marked only parses; it never produces HTML. Each kind of Markdown becomes a
 * block the page, the copied text, and any later output already draw, and
 * anything without one (raw HTML, code, images) prints as plain text.
 */
import { lexer } from "marked";
import type { Token, Tokens } from "marked";
import type { Block, ListBlock, Span } from "./document.ts";

/** A list line as people type it: an indent, then "-", "*", or "•", or "1." or "1)". */
const LIST_ITEM = /^([ \t]*)([-*•]|\d{1,3}[.)])\s+(.*)$/;

/**
 * Text as Scopewright's rules read it, rewritten for Markdown. Two spaces or a
 * tab nest a list line under the one above, whatever the marker above it; a
 * list may start straight after a line of text, at any number; and a list
 * whose first line is indented, with no list above it to belong to, is
 * indented on the page. Markdown would need deeper indents after a numbered
 * item, would keep "3." after a line of text in the paragraph, and has no
 * indented lists.
 *
 * `indented` says, for each list that starts at the top level, in order,
 * whether it was typed indented.
 */
function normalize(text: string): { text: string; indented: boolean[] } {
  const out: string[] = [];
  const indented: boolean[] = [];
  let previous: "blank" | "text" | "list" = "blank";
  // The indent and marker of the list being written; null outside a list.
  let list: { base: number; kind: string; indented: boolean } | null = null;
  for (const line of text.split("\n")) {
    const item = LIST_ITEM.exec(line);
    if (!item) {
      out.push(line);
      if (line.trim() && !(previous === "list" && /^\s/.test(line))) list = null;
      previous = line.trim() ? (previous === "list" && /^\s/.test(line) ? "list" : "text") : "blank";
      continue;
    }
    if (previous === "text") out.push("");
    const indent = item[1].replace(/\t/g, "  ").length;
    if (!list) list = { base: indent, kind: "", indented: indent >= 2 };
    const level = Math.max(0, Math.floor((indent - list.base) / 2));
    const marker = item[2] === "•" ? "-" : item[2];
    // Markdown starts a new list when the marker changes kind ("-" or "*", "1." or "1)").
    const kind = /\d/.test(marker) ? marker.slice(-1) : marker;
    if (level === 0 && kind !== list.kind) { indented.push(list.indented); list.kind = kind; }
    // Four spaces a level is deeper than any marker up to "99." needs, and not deep enough to be code.
    out.push(`${"    ".repeat(level)}${marker} ${item[3]}`);
    previous = "list";
  }
  return { text: out.join("\n"), indented };
}

type Fill = (value: string) => string;

/** Inline Markdown as spans: bold and italic keep their style, everything else its text. */
function inline(tokens: Token[] | undefined, fill: Fill): Span[] {
  return (tokens ?? []).flatMap((token): Span[] => {
    switch (token.type) {
      case "strong": return [{ strong: plain(token.tokens, fill) }];
      case "em": return [{ em: plain(token.tokens, fill) }];
      case "br": return ["\n"];
      case "link": {
        const label = plain(token.tokens, fill);
        return [label === token.href ? label : `${label} (${token.href})`];
      }
      case "image": return [fill(token.text)];
      case "text": return "tokens" in token && token.tokens ? inline(token.tokens, fill) : [fill(token.text)];
      default: return [fill("text" in token && typeof token.text === "string" ? token.text : token.raw)];
    }
  });
}

const plain = (tokens: Token[] | undefined, fill: Fill) => inline(tokens, fill).map((span) => (typeof span === "string" ? span : "strong" in span ? span.strong : "em" in span ? span.em : "")).join("");

function list(token: Tokens.List, fill: Fill): ListBlock {
  const nested: (ListBlock | undefined)[] = [];
  const items = token.items.map((item, index) => {
    const content = item.tokens.filter((child) => child.type !== "list");
    const sublist = item.tokens.find((child): child is Tokens.List => child.type === "list");
    if (sublist) nested[index] = list(sublist, fill);
    // A loose list wraps each item's text in a paragraph; a tight one does not.
    return content.flatMap((child, at) => [...(at ? ["\n"] : []), ...("tokens" in child && child.tokens ? inline(child.tokens, fill) : [fill(child.raw.trim())])]);
  });
  const ordered = token.ordered ? { ordered: true, start: typeof token.start === "number" ? token.start : 1 } : {};
  return { kind: "list", items, ...ordered, ...(nested.length ? { nested } : {}) };
}

function blocks(tokens: Token[], fill: Fill): Block[] {
  return tokens.flatMap((token): Block[] => {
    switch (token.type) {
      case "space":
      case "hr": return [];
      case "heading": return [{ kind: "heading", content: inline(token.tokens, fill) }];
      case "paragraph": return [{ kind: "paragraph", content: inline(token.tokens, fill) }];
      case "list": return [list(token as Tokens.List, fill)];
      case "blockquote": return blocks(token.tokens ?? [], fill);
      case "table": {
        const table = token as Tokens.Table;
        return [{ kind: "table", columns: table.header.map((cell) => plain(cell.tokens, fill)), rows: table.rows.map((row) => ({ cells: row.map((cell) => inline(cell.tokens, fill)) })) }];
      }
      // Code, raw HTML, and anything else print as the text that was typed.
      default: return token.raw.trim() ? [{ kind: "paragraph", content: [fill(token.raw.trim())] }] : [];
    }
  });
}

/** Custom section text as blocks. Placeholders are filled after parsing, so a filled-in value is never read as Markdown. */
export function markdownBlocks(text: string, fill: Fill): Block[] {
  const normalized = normalize(text);
  let lists = 0;
  return blocks(lexer(normalized.text), fill).map((block) => (block.kind === "list" && normalized.indented[lists++] ? { ...block, indent: true } : block));
}

/** One line of custom text for the copied text: the words, without the Markdown marks around them. */
export const markdownLine = (line: string): string => line
  .replace(/^\s{0,3}#{1,6}\s+/, "")
  .replace(/\*\*(.+?)\*\*|__(.+?)__/g, "$1$2")
  .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)|(^|\W)_(?!\s)(.+?)_(?!\w)/g, "$1$3$2$4")
  .replace(/`([^`]+)`/g, "$1")
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => (label === href ? label : `${label} (${href})`));
