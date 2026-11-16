import { h } from "../ui/dom";

/** Rows past this many are left out of the table; the source view has them all. */
export const MAX_ROWS = 1000;

/** Splits CSV text into rows of cells: quoted cells may hold the delimiter, doubled quotes and line breaks (RFC 4180). */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let fieldStart = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
    } else if (c === delimiter) {
      row.push(cell);
      cell = "";
      fieldStart = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      fieldStart = true;
    } else {
      cell += c;
      fieldStart = false;
    }
  }
  if (!fieldStart || cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Tab for .tsv files; otherwise whichever of comma, semicolon and tab the first line has most of, outside quotes. */
export function delimiterFor(name: string, text: string): string {
  if (/\.(tsv|tab)$/i.test(name)) return "\t";
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "\n" || c === "\r")) break;
    else if (!quoted && c in counts) counts[c]++;
  }
  return Object.entries(counts).reduce((best, next) => (next[1] > best[1] ? next : best), [",", 0] as [string, number])[0];
}

const NUMBER = /^[-+]?[$€£¥]?\d[\d,.\s]*%?$/;

/** The table view of a CSV file: the first row as the header, numbers aligned right. Cells are always plain text. */
export function renderCsv(text: string, name: string): HTMLElement {
  const rows = parseCsv(text, delimiterFor(name, text));
  if (!rows.length) return h("div", { class: "pc-csv" }, h("p", { class: "pc-empty" }, "This file is empty."));
  const width = Math.max(...rows.map((r) => r.length));
  const [header, ...body] = rows;
  const shown = body.slice(0, MAX_ROWS);
  const numeric = Array.from({ length: width }, (_, col) => {
    const values = shown.map((r) => (r[col] ?? "").trim()).filter((v) => v !== "");
    return values.length > 0 && values.every((v) => NUMBER.test(v));
  });
  const cell = (tag: "th" | "td", value: string | undefined, col: number) => h(tag, numeric[col] ? { class: "pc-num" } : {}, value ?? "");
  const line = (tag: "th" | "td", r: string[]) => h("tr", {}, ...Array.from({ length: width }, (_, col) => cell(tag, r[col], col)));

  const table = h("table", { class: "pc-table pc-csv-table" }, h("thead", {}, line("th", header)), h("tbody", {}, ...shown.map((r) => line("td", r))));
  const el = h("div", { class: "pc-csv" }, table);
  if (body.length > shown.length) {
    const count = (n: number) => n.toLocaleString("en-US");
    el.append(h("p", { class: "pc-csv-more" }, `Showing the first ${count(shown.length)} of ${count(body.length)} rows. The source has them all.`));
  }
  return el;
}
