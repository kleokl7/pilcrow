import { nodes } from "./helpers/tree";

test("wikilink with alias", () => {
  const n = nodes("see [[Content calendar|the calendar]] now");
  expect(n).toContain("Wikilink@4-37");
  expect(n.filter((x) => x.startsWith("WikilinkMark"))).toEqual(["WikilinkMark@4-6", "WikilinkMark@35-37"]);
});

test("unclosed [[ is plain text", () => {
  expect(nodes("a [[b c").some((x) => x.startsWith("Wikilink"))).toBe(false);
});

test("wikilink does not span lines", () => {
  expect(nodes("[[a\nb]]").some((x) => x.startsWith("Wikilink"))).toBe(false);
});

test("frontmatter is not parsed as a heading", () => {
  const n = nodes("---\ntype: review\n---\n\n# Title\n");
  expect(n.some((x) => x.startsWith("SetextHeading"))).toBe(false);
  expect(n.some((x) => x.startsWith("Frontmatter"))).toBe(true);
  expect(n.some((x) => x.startsWith("ATXHeading1"))).toBe(true);
});

test("gfm table and task list parse", () => {
  const n = nodes("- [ ] a\n\n| a | b |\n| - | - |\n| 1 | 2 |\n");
  expect(n.some((x) => x.startsWith("TaskMarker"))).toBe(true);
  expect(n.some((x) => x.startsWith("Table@"))).toBe(true);
});
