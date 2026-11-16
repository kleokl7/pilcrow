import { delimiterFor, parseCsv, renderCsv } from "../src/views/csv";

test("plain rows and cells", () => {
  expect(parseCsv("a,b,c\n1,2,3\n", ",")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
});

test("quotes hold delimiters, doubled quotes and line breaks", () => {
  expect(parseCsv('name,note\n"Smith, Ann","said ""hi""\nthen left"\n', ",")).toEqual([
    ["name", "note"],
    ["Smith, Ann", 'said "hi"\nthen left'],
  ]);
});

test("windows line endings, empty cells and a last line without a break", () => {
  expect(parseCsv("a,,c\r\n,2,\r\nx", ",")).toEqual([["a", "", "c"], ["", "2", ""], ["x"]]);
});

test("an empty file has no rows", () => {
  expect(parseCsv("", ",")).toEqual([]);
});

test("the delimiter comes from the name, or from the first line", () => {
  expect(delimiterFor("Budget.tsv", "a,b")).toBe("\t");
  expect(delimiterFor("Budget.csv", "a;b;c\n1;2;3")).toBe(";");
  expect(delimiterFor("Budget.csv", '"x;y",b\n1,2')).toBe(",");
  expect(delimiterFor("Budget.csv", "a\tb\tc")).toBe("\t");
  expect(delimiterFor("Budget.csv", "single")).toBe(",");
});

test("the table has a header row, and cells are text, never markup", () => {
  const el = renderCsv("Item,Cost\n<b>Tent</b>,120\n", "Trip.csv");
  expect([...el.querySelectorAll("th")].map((c) => c.textContent)).toEqual(["Item", "Cost"]);
  const first = el.querySelector("td")!;
  expect(first.textContent).toBe("<b>Tent</b>");
  expect(first.querySelector("b")).toBeNull();
});

test("columns of numbers line up on the right", () => {
  const el = renderCsv("Item,Cost\nTent,120\nStove,\"1,045.50\"\n", "Trip.csv");
  const cells = [...el.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.classList.contains("pc-num")));
  expect(cells).toEqual([[false, true], [false, true]]);
});

test("short rows are filled out to the widest row", () => {
  const el = renderCsv("a,b,c\n1\n", "x.csv");
  expect(el.querySelectorAll("tbody td").length).toBe(3);
});

test("a long file shows its first thousand rows and says so", () => {
  const text = "n\n" + Array.from({ length: 1500 }, (_, i) => String(i)).join("\n");
  const el = renderCsv(text, "x.csv");
  expect(el.querySelectorAll("tbody tr").length).toBe(1000);
  expect(el.textContent).toContain("Showing the first 1,000 of 1,500 rows.");
});

test("an empty file says so", () => {
  expect(renderCsv("", "x.csv").textContent).toBe("This file is empty.");
});
