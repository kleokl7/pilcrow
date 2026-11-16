import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown, markdownLanguage as gfm } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { search, searchKeymap } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";
import { Wikilink } from "./wikilink";

export type ViewMode = "formatted" | "source";

export interface PilcrowEditor {
  view: EditorView;
  setMode(mode: ViewMode): void;
  getMode(): ViewMode;
  setDoc(text: string): void;
  getText(): string;
  focus(): void;
  destroy(): void;
}

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  mode: ViewMode;
  readOnly: boolean;
  onChange: (text: string) => void;
  onOpenUrl: (url: string) => void;
}

/** How long typing must pause before the text is reported. */
export const CHANGE_DEBOUNCE_MS = 250;

/** GitHub-flavoured Markdown, with YAML frontmatter and [[wikilinks]]. */
export function markdownLanguage(): Extension {
  return yamlFrontmatter({ content: markdown({ base: gfm, extensions: [Wikilink], completeHTMLTags: false }) });
}

export const modeCompartment = new Compartment();

/** Marks a transaction that replaces the document from outside (not typed by the user). */
const external = Annotation.define<boolean>();

const sourceHighlight = HighlightStyle.define([
  { tag: [t.processingInstruction, t.atom, t.contentSeparator, t.url, t.labelName], class: "pc-tok-mark" },
  { tag: [t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], class: "pc-tok-heading" },
  { tag: t.strong, class: "pc-tok-strong" },
  { tag: t.emphasis, class: "pc-tok-em" },
  { tag: [t.meta, t.propertyName, t.definition(t.propertyName)], class: "pc-tok-dim" },
]);

function sourceMode(): Extension {
  return [EditorView.editorAttributes.of({ class: "pc-source" }), syntaxHighlighting(sourceHighlight)];
}

function formattedMode(_opts: EditorOptions): Extension {
  return [EditorView.editorAttributes.of({ class: "pc-formatted" })];
}

export function createEditor(opts: EditorOptions): PilcrowEditor {
  let mode = opts.mode;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const report = () => {
    timer = null;
    opts.onChange(view.state.doc.toString());
  };
  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      report();
    }
  };

  const modeExtension = (m: ViewMode) => (m === "source" ? sourceMode() : formattedMode(opts));

  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        markdownLanguage(),
        search({ top: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        EditorState.readOnly.of(opts.readOnly),
        EditorView.editable.of(!opts.readOnly),
        modeCompartment.of(modeExtension(mode)),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          if (update.transactions.every((tr) => tr.annotation(external))) return;
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(report, CHANGE_DEBOUNCE_MS);
        }),
      ],
    }),
  });

  return {
    view,
    setMode(next) {
      if (next === mode) return;
      mode = next;
      view.dispatch({ effects: modeCompartment.reconfigure(modeExtension(next)) });
    },
    getMode: () => mode,
    setDoc(text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: 0 },
        annotations: external.of(true),
      });
    },
    getText: () => view.state.doc.toString(),
    focus: () => view.focus(),
    destroy() {
      flush();
      view.destroy();
    },
  };
}
