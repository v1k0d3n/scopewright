/**
 * Markdown in custom section text, read into the document's own blocks.
 *
 * marked only parses; it never produces HTML. Each kind of Markdown becomes a
 * block the page, the copied text, and any later output already draw, and
 * anything without one (raw HTML, code, images, rules) prints as typed.
 */
import { Lexer, lexer } from "marked";
import type { Token, Tokens } from "marked";
import type { Block, ListBlock, Span } from "./document.ts";

/** A list line as people type it: an indent, then "-", "*", or "•", "1." or "1)", or a letter, "a." or "a)" (or "A."). */
const LIST_ITEM = /^([ \t]*)([-*•]|\d{1,3}[.)]|[a-zA-Z][.)])\s+(.*)$/;

/**
 * Markdown has no lettered lists, so a lettered line is handed to it as the
 * matching number ("c." as "3.") with one of these invisible marks first;
 * the list it ends up in is then drawn with letters, and the mark removed.
 */
const LETTERS = { lower: "\u2063", upper: "\u2064" } as const;

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
  // Code and raw HTML blocks are left exactly as typed, wherever Markdown says they start and end.
  const literal = literalLines(text);
  text.split("\n").forEach((line, index) => {
    if (literal.has(index)) { out.push(line); previous = "text"; list = null; return; }
    const item = LIST_ITEM.exec(line);
    if (!item) {
      out.push(line);
      if (line.trim() && !(previous === "list" && /^\s/.test(line))) list = null;
      previous = line.trim() ? (previous === "list" && /^\s/.test(line) ? "list" : "text") : "blank";
      return;
    }
    if (previous === "text") out.push("");
    const indent = item[1].replace(/\t/g, "  ").length;
    if (!list) list = { base: indent, kind: "", indented: indent >= 2 };
    const level = Math.max(0, Math.floor((indent - list.base) / 2));
    const letter = /^[a-zA-Z]/.test(item[2]) ? item[2][0] : "";
    const marker = item[2] === "•" ? "-" : letter ? `${letter.toLowerCase().charCodeAt(0) - 96}${item[2].slice(1)}` : item[2];
    const content = letter ? `${letter === letter.toLowerCase() ? LETTERS.lower : LETTERS.upper}${item[3]}` : item[3];
    // Markdown starts a new list when the marker changes kind ("-" or "*", "1." or "1)").
    const kind = /\d/.test(marker) ? marker.slice(-1) : marker;
    if (level === 0 && kind !== list.kind) { indented.push(list.indented); list.kind = kind; }
    // Four spaces a level is deeper than any marker up to "99." needs, and not deep enough to be code.
    out.push(`${"    ".repeat(level)}${marker} ${content}`);
    previous = "list";
  });
  return { text: out.join("\n"), indented };
}

/** Each top-level block Markdown reads, with the lines it spans. Its tokens' raw text, end to end, is the text itself. */
function blockLines(text: string): { token: Token; first: number; last: number }[] {
  let line = 0;
  return lexer(text).map((token) => {
    const breaks = token.raw.split("\n").length - 1;
    const range = { token, first: line, last: line + breaks - (token.raw.endsWith("\n") ? 1 : 0) };
    line += breaks;
    return range;
  });
}

/**
 * The lines to leave exactly as typed: fenced code at any depth, including
 * inside a list item or a quote, and top-level raw HTML blocks and rules. Indented code
 * is not among them, so a list line indented four spaces stays a list line.
 */
function literalLines(text: string): Set<number> {
  const lines = new Set<number>();
  let fence: { mark: string; length: number; depth: number } | null = null;
  // How many quotes deep a line is: ">> x" is two.
  const depth = (line: string) => /^(?:\s*>)*/.exec(line)![0].split(">").length - 1;
  text.split("\n").forEach((line, index) => {
    // A fence may sit in a quote ("> ```"), and the quote's marks come first.
    const marker = /^(?:\s*>)*\s*(`{3,}|~{3,})(.*)$/.exec(line);
    // A quoted fence ends with its quote, closed or not.
    if (fence && depth(line) < fence.depth) fence = null;
    if (fence) {
      lines.add(index);
      // A fence closes only on the same mark, at least as long, with nothing after it.
      if (marker && marker[1][0] === fence.mark && marker[1].length >= fence.length && !marker[2].trim() && depth(line) === fence.depth) fence = null;
    } else if (marker && !(marker[1][0] === "`" && marker[2].includes("`"))) {
      lines.add(index);
      fence = { mark: marker[1][0], length: marker[1].length, depth: depth(line) };
    }
  });
  for (const { token, first, last } of blockLines(text)) {
    if (token.type === "html" || token.type === "hr") for (let at = first; at <= last; at += 1) lines.add(at);
  }
  return lines;
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
      // Images, inline code, and raw HTML print exactly as typed.
      case "image":
      case "codespan":
      case "html": return [fill(token.raw)];
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
  // A lettered list's items begin with the mark normalize gave them; the first item decides how the list is drawn.
  const first = items[0]?.[0];
  const letters = typeof first === "string" && first[0] === LETTERS.lower ? "lower" : typeof first === "string" && first[0] === LETTERS.upper ? "upper" : null;
  for (const item of items) if (typeof item[0] === "string" && (item[0][0] === LETTERS.lower || item[0][0] === LETTERS.upper)) item[0] = item[0].slice(1);
  const ordered = token.ordered ? { ordered: true, start: typeof token.start === "number" ? token.start : 1, ...(letters ? { letters } : {}) } : {};
  return { kind: "list", items, ...ordered, ...(nested.length ? { nested } : {}) };
}

function blocks(tokens: Token[], fill: Fill): Block[] {
  return tokens.flatMap((token): Block[] => {
    switch (token.type) {
      case "space": return [];
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
  // Only a top-level list takes its indent, so a list inside a quote never takes another's.
  return lexer(normalized.text).flatMap((token) => {
    const indent = token.type === "list" && normalized.indented[lists++];
    return blocks([token], fill).map((block) => (indent && block.kind === "list" ? { ...block, indent: true } : block));
  });
}

/** A line's inline Markdown as text: bold and italic lose their marks, a link reads "text (address)", and code, images, and HTML stay as typed. */
function inlineText(tokens: Token[] | undefined): string {
  return (tokens ?? []).map((token) => {
    switch (token.type) {
      case "strong":
      case "em":
      case "del": return inlineText(token.tokens);
      case "link": { const label = inlineText(token.tokens); return label === token.href ? label : `${label} (${token.href})`; }
      case "escape": return token.text;
      case "text": return "tokens" in token && token.tokens ? inlineText(token.tokens) : token.raw;
      default: return token.raw;
    }
  }).join("");
}

const lineText = (line: string) => inlineText(Lexer.lexInline(line));

/**
 * Custom section text for the copied text: each line as typed, without
 * Markdown's marks, then placeholders filled, so a filled-in value is never
 * changed. Code, raw HTML, and rules stay exactly as typed; a heading loses
 * its "#"; a Markdown table prints like a table block. Runs of blank lines
 * outside code become one, and the text is trimmed of blank lines at its ends.
 */
export function markdownText(text: string, fill: Fill): string[] {
  const lines = text.split("\n");
  const literal = literalLines(text);
  const replaced = new Map<number, string[]>();
  for (const { token, first, last } of blockLines(text)) {
    if (literal.has(first)) continue;
    if (token.type === "heading") replaced.set(first, [inlineText(token.tokens)]);
    else if (token.type === "paragraph") {
      // Read the paragraph whole, so bold or italic that spans lines loses its marks too.
      const read = inlineText(token.tokens).split("\n");
      if (read.length !== last - first + 1) continue;
      read.forEach((value, at) => replaced.set(first + at, [value]));
      continue;
    }
    else if (token.type === "table") {
      const table = token as Tokens.Table;
      replaced.set(first, [table.header.map((cell) => inlineText(cell.tokens)).join(" | "), ...table.rows.map((row) => row.map((cell) => inlineText(cell.tokens)).join(" | "))]);
    } else continue;
    for (let at = first + 1; at <= last; at += 1) replaced.set(at, []);
  }
  const out: string[] = [];
  lines.forEach((line, index) => {
    if (replaced.has(index)) { out.push(...replaced.get(index)!.map(fill)); return; }
    if (literal.has(index)) { out.push(fill(line)); return; }
    const words = lineText(line).trimEnd();
    if (!words.trim()) { if (out.length && out.at(-1) !== "") out.push(""); return; }
    out.push(fill(words));
  });
  while (out.at(-1) === "") out.pop();
  return out;
}
