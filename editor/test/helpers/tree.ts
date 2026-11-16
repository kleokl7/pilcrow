import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdownLanguage } from "../../src/editor/setup";

export function stateOf(doc: string, cursor = 0): EditorState {
  return EditorState.create({ doc, selection: { anchor: Math.min(cursor, doc.length) }, extensions: [markdownLanguage()] });
}

/** Every syntax node as "Name@from-to", in document order. */
export function nodes(doc: string): string[] {
  const state = stateOf(doc);
  const tree = ensureSyntaxTree(state, doc.length, 5000)!;
  const out: string[] = [];
  tree.iterate({ enter: (n) => { out.push(`${n.name}@${n.from}-${n.to}`); } });
  return out;
}
