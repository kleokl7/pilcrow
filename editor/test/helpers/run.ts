import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownLanguage } from "../../src/editor/setup";

/**
 * Runs a command on a document written with "|" for the cursor, or "[" and "]" around a selection
 * (written as "⟦" and "⟧" so Markdown brackets stay usable), and returns the result in the same notation.
 */
export function run(command: (view: EditorView) => boolean, spec: string): string {
  let doc = spec;
  let selection: EditorSelection;
  const open = spec.indexOf("⟦");
  if (open >= 0) {
    const close = spec.indexOf("⟧") - 1;
    doc = spec.replace("⟦", "").replace("⟧", "");
    selection = EditorSelection.single(open, close);
  } else {
    const at = spec.indexOf("|");
    doc = spec.slice(0, at) + spec.slice(at + 1);
    selection = EditorSelection.single(at);
  }
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection, extensions: [markdownLanguage()] }) });
  command(view);
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  view.destroy();
  return from === to ? text.slice(0, from) + "|" + text.slice(from) : text.slice(0, from) + "⟦" + text.slice(from, to) + "⟧" + text.slice(to);
}
