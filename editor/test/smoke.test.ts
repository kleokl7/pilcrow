import { EditorState } from "@codemirror/state";

test("codemirror state works under vitest", () => {
  expect(EditorState.create({ doc: "# hi" }).doc.toString()).toBe("# hi");
});
