import { type Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** One decoration per number, made once: equal decorations let CodeMirror leave a line's DOM alone. */
const cache: Decoration[] = [];
const numbered = (n: number) => (cache[n] ??= Decoration.line({ attributes: { "data-ln": String(n) } }));

/** Puts each drawn line's number in the file on it as data-ln. The stylesheet hangs it in the left margin. */
function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  let last = 0;
  for (const { from, to } of view.visibleRanges) {
    for (let line = doc.lineAt(from); ; line = doc.line(line.number + 1)) {
      if (line.number > last) builder.add(line.from, line.from, numbered(line.number));
      last = line.number;
      if (line.to >= to || line.number >= doc.lines) break;
    }
  }
  return builder.finish();
}

const numbers = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * Line numbers in the margin the text already leaves on the left. Counted as the file counts them:
 * a wrapped line has one number, and lines drawn as a block (a table, the properties) show none.
 */
export function lineNumbers(): Extension {
  return [EditorView.editorAttributes.of({ class: "pc-lines" }), numbers];
}
