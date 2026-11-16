import { EditorSelection, EditorState } from "@codemirror/state";
import { revealedAt } from "../src/editor/reveal";

const strong = { name: "StrongEmphasis", from: 2, to: 10 };
const at = (anchor: number, head = anchor) =>
  EditorState.create({ doc: "a **bold** z\nnext", selection: EditorSelection.single(anchor, head) });

test("an inline node is revealed when the cursor is at either edge", () => {
  expect(revealedAt(at(2), strong)).toBe(true);
  expect(revealedAt(at(10), strong)).toBe(true);
});

test("an inline node is hidden one character outside", () => {
  expect(revealedAt(at(1), strong)).toBe(false);
  expect(revealedAt(at(11), strong)).toBe(false);
});

test("a selection that overlaps the node reveals it", () => {
  expect(revealedAt(at(0, 3), strong)).toBe(true);
});

test("a heading is revealed by a cursor anywhere on its line", () => {
  const state = EditorState.create({ doc: "## Title\n\ntext", selection: { anchor: 8 } });
  expect(revealedAt(state, { name: "ATXHeading2", from: 0, to: 8 })).toBe(true);
  expect(revealedAt(EditorState.create({ doc: "## Title\n\ntext", selection: { anchor: 9 } }), { name: "ATXHeading2", from: 0, to: 8 })).toBe(false);
});

test("a list mark is revealed only when the cursor is on the mark itself", () => {
  const mark = { name: "ListMark", from: 0, to: 5 }; // "- [ ]"
  const on = (pos: number) => EditorState.create({ doc: "- [ ] todo", selection: { anchor: pos } });
  expect(revealedAt(on(5), mark)).toBe(true);
  expect(revealedAt(on(6), mark)).toBe(false);
});
