import { type ChangeSpec, EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { insertNewlineAndIndent } from "@codemirror/commands";

type Command = (view: EditorView) => boolean;

const BULLET = /^(\s*)([-*+])[ \t]+/;
const TASK = /^(\s*)([-*+])[ \t]+\[[ xX]\][ \t]+/;
const ORDERED = /^(\s*)\d+[.)][ \t]+/;
const HEADING = /^(#{1,6})[ \t]+/;
const LIST_LINE = /^\s*([-*+]|\d+[.)])[ \t]/;

/** Rewrites the start of every selected line. `fn` returns the new prefix and how much old prefix it replaces. */
function editLineStarts(view: EditorView, fn: (text: string) => { remove: number; insert: string } | null): boolean {
  const { state } = view;
  if (state.readOnly) return false;
  const changes: ChangeSpec[] = [];
  const done = new Set<number>();
  for (const range of state.selection.ranges) {
    for (let line = state.doc.lineAt(range.from); ; line = state.doc.line(line.number + 1)) {
      if (!done.has(line.number)) {
        done.add(line.number);
        const edit = fn(line.text);
        if (edit && (edit.remove > 0 || edit.insert)) changes.push({ from: line.from, to: line.from + edit.remove, insert: edit.insert });
      }
      if (line.to >= range.to || line.number >= state.doc.lines) break;
    }
  }
  if (!changes.length) return false;
  const set = state.changes(changes);
  // Keep the cursor after the new prefix, never inside it.
  view.dispatch({ changes: set, selection: state.selection.map(set, 1), userEvent: "input.format", scrollIntoView: true });
  return true;
}

/** Paragraph → # → ## → ### → paragraph. */
export const cycleHeading: Command = (view) =>
  editLineStarts(view, (text) => {
    const current = HEADING.exec(text);
    const level = current ? current[1].length : 0;
    const next = level >= 3 ? 0 : level + 1;
    return { remove: current ? current[0].length : 0, insert: next ? "#".repeat(next) + " " : "" };
  });

/** Paragraph → task; bullet → task; task → bullet. */
export const toggleTaskItem: Command = (view) =>
  editLineStarts(view, (text) => {
    const task = TASK.exec(text);
    if (task) return { remove: task[0].length, insert: `${task[1]}${task[2]} ` };
    const bullet = BULLET.exec(text);
    if (bullet) return { remove: bullet[0].length, insert: `${bullet[1]}${bullet[2]} [ ] ` };
    const ordered = ORDERED.exec(text);
    const indent = ordered ? ordered[1] : /^\s*/.exec(text)![0];
    return { remove: ordered ? ordered[0].length : indent.length, insert: `${indent}- [ ] ` };
  });

/** Paragraph ↔ bullet item. */
export const toggleBullet: Command = (view) =>
  editLineStarts(view, (text) => {
    const item = TASK.exec(text) ?? BULLET.exec(text);
    if (item) return { remove: item[0].length, insert: item[1] };
    const ordered = ORDERED.exec(text);
    const indent = ordered ? ordered[1] : /^\s*/.exec(text)![0];
    return { remove: ordered ? ordered[0].length : indent.length, insert: `${indent}- ` };
  });

/** Paragraph ↔ numbered item. */
export const toggleNumbered: Command = (view) =>
  editLineStarts(view, (text) => {
    const ordered = ORDERED.exec(text);
    if (ordered) return { remove: ordered[0].length, insert: ordered[1] };
    const item = TASK.exec(text) ?? BULLET.exec(text);
    const indent = item ? item[1] : /^\s*/.exec(text)![0];
    return { remove: item ? item[0].length : indent.length, insert: `${indent}1. ` };
  });

export const indentItem: Command = (view) => editLineStarts(view, (text) => (LIST_LINE.test(text) ? { remove: 0, insert: "  " } : null));

export const outdentItem: Command = (view) =>
  editLineStarts(view, (text) => {
    if (!LIST_LINE.test(text)) return null;
    const lead = /^( {1,2}|\t)/.exec(text);
    return lead ? { remove: lead[0].length, insert: "" } : null;
  });

function toggleInline(mark: string, nodeName: string): Command {
  return (view) => {
    const { state } = view;
    if (state.readOnly) return false;
    const range = state.selection.main;
    const n = mark.length;

    if (!range.empty) {
      const before = state.doc.sliceString(Math.max(0, range.from - n), range.from);
      const after = state.doc.sliceString(range.to, range.to + n);
      if (before === mark && after === mark) {
        view.dispatch({
          changes: [{ from: range.from - n, to: range.from }, { from: range.to, to: range.to + n }],
          selection: EditorSelection.single(range.from - n, range.to - n),
          userEvent: "input.format",
        });
      } else {
        view.dispatch({
          changes: [{ from: range.from, insert: mark }, { from: range.to, insert: mark }],
          selection: EditorSelection.single(range.from + n, range.to + n),
          userEvent: "input.format",
        });
      }
      return true;
    }

    // Empty selection inside an existing span: remove its marks.
    for (const side of [-1, 1] as const) {
      for (let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(range.head, side); node; node = node.parent) {
        if (node.name !== nodeName) continue;
        const first = node.firstChild;
        const last = node.lastChild;
        if (!first || !last || first === last) break;
        const set = state.changes([{ from: first.from, to: first.to }, { from: last.from, to: last.to }]);
        view.dispatch({ changes: set, selection: state.selection.map(set), userEvent: "input.format" });
        return true;
      }
    }

    view.dispatch({
      changes: { from: range.head, insert: mark + mark },
      selection: EditorSelection.cursor(range.head + n),
      userEvent: "input.format",
    });
    return true;
  };
}

export const toggleBold = toggleInline("**", "StrongEmphasis");
export const toggleItalic = toggleInline("*", "Emphasis");

/**
 * In the Formatted view a heading or quote mark is hidden, so Backspace at the first visible character
 * removes the mark and leaves a paragraph.
 */
export const deleteHiddenMarkBackward: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty || state.readOnly) return false;
  const line = state.doc.lineAt(range.head);
  const mark = /^(#{1,6}[ \t]+|>[ \t]?)/.exec(line.text);
  if (!mark || range.head !== line.from + mark[0].length) return false;
  view.dispatch({ changes: { from: line.from, to: range.head }, userEvent: "delete.backward" });
  return true;
};

const EMPTY_ITEM = /^\s*([-*+]|\d+[.)])[ \t]+(\[[ xX]\][ \t]*)?$/;

/** Enter: an empty list item ends the list; inside an item it starts the next one; elsewhere it is a line break. */
export const continueList: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  if (range.empty && !state.readOnly) {
    const line = state.doc.lineAt(range.head);
    if (range.head === line.to && EMPTY_ITEM.test(line.text)) {
      view.dispatch({ changes: { from: line.from, to: line.to }, selection: EditorSelection.cursor(line.from), userEvent: "delete.backward" });
      return true;
    }
  }
  return insertNewlineContinueMarkup(view) || insertNewlineAndIndent(view);
};
