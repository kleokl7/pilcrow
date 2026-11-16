import type { EditorState } from "@codemirror/state";

/** "hide": marks disappear away from the cursor. "dim": marks stay visible but dimmed (the keyboard fallback). */
export type MarksMode = "hide" | "dim";

export interface NodeRange {
  name: string;
  from: number;
  to: number;
}

/** Blocks whose marks are revealed by a cursor anywhere on their lines. */
const LINE_BLOCKS = /^(ATXHeading\d|SetextHeading\d|Blockquote|QuoteMark|FencedCode|CodeBlock|HorizontalRule|Table|Frontmatter)$/;
/** Marks that are revealed only when the cursor is on the mark itself. */
const HEAD_ONLY = /^(ListMark|TaskMarker)$/;

/** True when any selection range touches [from, to], edges included. */
export function selectionTouches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

/** True when the syntax of this node should be shown raw because the cursor is working on it. */
export function revealedAt(state: EditorState, node: NodeRange): boolean {
  if (HEAD_ONLY.test(node.name)) {
    const head = state.selection.main.head;
    return head >= node.from && head <= node.to;
  }
  if (LINE_BLOCKS.test(node.name)) {
    return selectionTouches(state, state.doc.lineAt(node.from).from, state.doc.lineAt(node.to).to);
  }
  return selectionTouches(state, node.from, node.to);
}
