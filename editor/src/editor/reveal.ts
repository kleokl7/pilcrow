import { type EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

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

export const setFocused = StateEffect.define<boolean>();

/** Whether the editor has the keyboard focus. A note that was just opened has a cursor position but nobody is editing it. */
export const focusField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setFocused)) value = effect.value;
    return value;
  },
});

/** Keeps focusField in step with the real focus. */
export const focusTracking: Extension = [focusField, EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing))];

/** False while nobody is editing: then nothing is revealed and no line is "the cursor line". True when focus is not tracked. */
export function selectionActive(state: EditorState): boolean {
  return state.field(focusField, false) ?? true;
}

/** True when any selection range touches [from, to], edges included. */
export function selectionTouches(state: EditorState, from: number, to: number): boolean {
  if (!selectionActive(state)) return false;
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

/** True when the syntax of this node should be shown raw because the cursor is working on it. */
export function revealedAt(state: EditorState, node: NodeRange): boolean {
  if (HEAD_ONLY.test(node.name)) {
    if (!selectionActive(state)) return false;
    const head = state.selection.main.head;
    return head >= node.from && head <= node.to;
  }
  if (LINE_BLOCKS.test(node.name)) {
    return selectionTouches(state, state.doc.lineAt(node.from).from, state.doc.lineAt(node.to).to);
  }
  return selectionTouches(state, node.from, node.to);
}
