import { type EditorState, type Extension, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { type MarksMode, selectionTouches } from "./reveal";

export type Align = "left" | "center" | "right" | null;
export interface ParsedTable {
  header: string[];
  align: Align[];
  rows: string[][];
}

/** Splits one table line into trimmed cells. "\|" is a literal pipe. */
function cells(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const out: string[] = [];
  let cell = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && text[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (text[i] === "|") {
      out.push(cell.trim());
      cell = "";
    } else {
      cell += text[i];
    }
  }
  out.push(cell.trim());
  return out;
}

/** Reads a GitHub-flavoured Markdown table. Rows are padded or cut to the width of the header. */
export function parseTable(src: string): ParsedTable {
  const lines = src.split("\n").filter((l) => l.trim() !== "");
  const header = cells(lines[0] ?? "");
  const width = header.length;
  const fit = (row: string[]) => Array.from({ length: width }, (_, i) => row[i] ?? "");
  const align = fit(cells(lines[1] ?? "")).map((d): Align => {
    const left = d.startsWith(":");
    const right = d.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : null;
  });
  return { header, align, rows: lines.slice(2).map((l) => fit(cells(l))) };
}

/** Number of top-level keys in a YAML frontmatter block. */
export function countProperties(frontmatter: string): number {
  return frontmatter.split("\n").filter((l) => /^[^\s#-][^:]*:/.test(l)).length;
}

const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[\[(.+?)\]\]|\[(.+?)\]\((.+?)\)/g;

/** A table cell as DOM: bold, italic, code, links and wikilinks are styled; anything else stays as typed. */
export function renderInline(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const el = (tag: string, content: string, cls?: string) => {
    const node = document.createElement(tag);
    node.textContent = content;
    if (cls) node.className = cls;
    return node;
  };
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    fragment.append(text.slice(last, m.index));
    if (m[1] !== undefined) fragment.append(el("strong", m[1]));
    else if (m[2] !== undefined) fragment.append(el("em", m[2]));
    else if (m[3] !== undefined) fragment.append(el("code", m[3], "pc-code"));
    else if (m[4] !== undefined) fragment.append(el("span", m[4].includes("|") ? m[4].slice(m[4].indexOf("|") + 1) : m[4], "pc-wikilink"));
    else fragment.append(el("span", m[5], "pc-link"));
    last = m.index + m[0].length;
  }
  fragment.append(text.slice(last));
  return fragment;
}

/** Puts the cursor into the source that a block widget stands for, which reveals it. */
function revealOnTap(dom: HTMLElement, view: EditorView, offset: (from: number) => number) {
  dom.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const from = view.posAtDOM(dom);
    view.dispatch({ selection: { anchor: Math.min(offset(from), view.state.doc.length) }, scrollIntoView: true });
    if (!view.state.readOnly) view.focus();
  });
}

class TableWidget extends WidgetType {
  readonly kind = "table";
  constructor(readonly source: string) {
    super();
  }
  eq(other: TableWidget) {
    return other.source === this.source;
  }
  toDOM(view: EditorView) {
    const { header, align, rows } = parseTable(this.source);
    const wrap = document.createElement("div");
    wrap.className = "pc-table-wrap";
    const table = wrap.appendChild(document.createElement("table"));
    table.className = "pc-table";
    const row = (tag: "th" | "td", values: string[]) => {
      const tr = document.createElement("tr");
      values.forEach((value, i) => {
        const cell = tr.appendChild(document.createElement(tag));
        cell.append(renderInline(value));
        if (align[i]) cell.style.textAlign = align[i]!;
      });
      return tr;
    };
    table.appendChild(document.createElement("thead")).appendChild(row("th", header));
    const body = table.appendChild(document.createElement("tbody"));
    rows.forEach((r) => body.appendChild(row("td", r)));
    // The first cell's text starts after "| ".
    revealOnTap(wrap, view, (from) => from + (this.source.match(/^\|?\s*/)?.[0].length ?? 0));
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

class PropertiesWidget extends WidgetType {
  readonly kind = "properties";
  constructor(readonly source: string) {
    super();
  }
  eq(other: PropertiesWidget) {
    return other.source === this.source;
  }
  toDOM(view: EditorView) {
    const count = countProperties(this.source);
    const bar = document.createElement("div");
    bar.className = "pc-props";
    bar.setAttribute("role", "button");
    bar.textContent = count === 1 ? "1 property" : `${count} properties`;
    // Second line of the block: the first key.
    revealOnTap(bar, view, (from) => from + this.source.indexOf("\n") + 1);
    return bar;
  }
  ignoreEvent() {
    return true;
  }
}

function build(state: EditorState): DecorationSet {
  const doc = state.doc;
  const out: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "Document") return true;
      if (node.name === "Table" || (node.name === "Frontmatter" && node.from === 0)) {
        const from = doc.lineAt(node.from).from;
        // A Frontmatter node ends after the line break of its closing "---".
        const to = doc.lineAt(node.name === "Table" ? node.to : Math.max(node.from, node.to - 1)).to;
        if (to > from && !selectionTouches(state, from, to)) {
          const source = doc.sliceString(from, to);
          const widget = node.name === "Table" ? new TableWidget(source) : new PropertiesWidget(source);
          out.push(Decoration.replace({ kind: "block", block: true, widget }).range(from, to));
        }
      }
      return false; // only top-level blocks; nothing nested is drawn as a widget
    },
  });
  return Decoration.set(out, true);
}

/** Tables and frontmatter drawn as blocks. A state field, because CodeMirror only takes block replacements from one. */
export const blockField = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state);
    return value;
  },
  provide: (field) => [EditorView.decorations.from(field), EditorView.atomicRanges.of((view) => view.state.field(field))],
});

export function blockPreview(_opts: { marks: MarksMode }): Extension {
  return blockField;
}
