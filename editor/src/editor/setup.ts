import { Annotation, Compartment, EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { html } from "@codemirror/lang-html";
import { deleteMarkupBackward, markdown, markdownLanguage as gfm } from "@codemirror/lang-markdown";
import { xml } from "@codemirror/lang-xml";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { search, searchKeymap } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";
import { blockPreview } from "./blocks";
import { continueList, deleteHiddenMarkBackward } from "./commands";
import { livePreview } from "./inline";
import { lineNumbers } from "./lines";
import { type MarksMode, focusTracking } from "./reveal";
import { Wikilink } from "./wikilink";

export type ViewMode = "formatted" | "source";

/** What a note is. Markdown is edited formatted or as source; the others are shown by their own view, and edited as source. */
export type DocKind = "markdown" | "html" | "svg" | "csv";

export interface PilcrowEditor {
  view: EditorView;
  setMode(mode: ViewMode): void;
  getMode(): ViewMode;
  setLineNumbers(on: boolean): void;
  getLineNumbers(): boolean;
  setDoc(text: string): void;
  getText(): string;
  /** Reports a change that is still waiting, now. Call before anything that ends or replaces the note. */
  flush(): void;
  focus(): void;
  destroy(): void;
}

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  mode: ViewMode;
  /** Markdown when left out. Any other kind is always shown as source. */
  kind?: DocKind;
  /** Numbers in the left margin. Off when left out. */
  lineNumbers?: boolean;
  readOnly: boolean;
  onChange: (text: string) => void;
  onOpenUrl: (url: string) => void;
}

/** "hide" is the design. "dim" is the fallback if a phone keyboard misbehaves next to hidden marks (spec, Risk 2). */
export const MARKS_MODE: MarksMode = "hide";

/** The longest a change waits before it is reported. Not a pause: it counts from the first unreported keystroke. */
export const CHANGE_DEBOUNCE_MS = 250;

/** GitHub-flavoured Markdown, with YAML frontmatter and [[wikilinks]]. */
export function markdownLanguage(): Extension {
  // addKeymap: false — the package's own Enter binding outranks ours and keeps empty list items; setup.ts binds the keys.
  return yamlFrontmatter({ content: markdown({ base: gfm, extensions: [Wikilink], completeHTMLTags: false, addKeymap: false }) });
}

export const modeCompartment = new Compartment();
const linesCompartment = new Compartment();

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

const codeHighlight = HighlightStyle.define([
  { tag: [t.tagName, t.angleBracket], class: "pc-tok-tag" },
  { tag: [t.attributeName, t.propertyName], class: "pc-tok-attr" },
  { tag: [t.attributeValue, t.string], class: "pc-tok-string" },
  { tag: [t.comment, t.blockComment, t.lineComment], class: "pc-tok-comment" },
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword], class: "pc-tok-keyword" },
  { tag: [t.number, t.bool, t.null, t.atom, t.processingInstruction, t.documentMeta], class: "pc-tok-dim" },
]);

/** HTML, SVG and CSV: the text as stored, in the source view's type, coloured by its own language. */
function codeMode(): Extension {
  return [EditorView.editorAttributes.of({ class: "pc-source pc-code" }), syntaxHighlighting(codeHighlight)];
}

function language(kind: DocKind): Extension {
  if (kind === "html") return html();
  if (kind === "svg") return xml();
  if (kind === "csv") return [];
  return markdownLanguage();
}

function formattedMode(opts: EditorOptions): Extension {
  return [
    EditorView.editorAttributes.of({ class: MARKS_MODE === "dim" ? "pc-formatted pc-dim" : "pc-formatted" }),
    focusTracking,
    livePreview({ marks: MARKS_MODE, onOpenUrl: opts.onOpenUrl }),
    blockPreview({ marks: MARKS_MODE }),
    // Only where marks are hidden: in Source view Backspace must delete one character.
    MARKS_MODE === "hide" ? Prec.high(keymap.of([{ key: "Backspace", run: deleteHiddenMarkBackward }])) : [],
  ];
}

export function createEditor(opts: EditorOptions): PilcrowEditor {
  const kind = opts.kind ?? "markdown";
  let mode: ViewMode = kind === "markdown" ? opts.mode : "source";
  let numbered = opts.lineNumbers ?? false;
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

  const modeExtension = (m: ViewMode) => (kind !== "markdown" ? codeMode() : m === "source" ? sourceMode() : formattedMode(opts));
  // Enter continues a list and Backspace removes list marks: only in Markdown.
  const markdownKeys = kind === "markdown" ? [{ key: "Enter", run: continueList }, { key: "Backspace", run: deleteMarkupBackward }] : [];

  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        language(kind),
        search({ top: true }),
        keymap.of([
          ...markdownKeys,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        EditorState.readOnly.of(opts.readOnly),
        EditorView.editable.of(!opts.readOnly),
        modeCompartment.of(modeExtension(mode)),
        linesCompartment.of(numbered ? lineNumbers() : []),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          if (update.transactions.every((tr) => tr.annotation(external))) return;
          // Not restarted by later keystrokes: during steady typing the text still leaves every 250 ms.
          if (timer === null) timer = setTimeout(report, CHANGE_DEBOUNCE_MS);
        }),
      ],
    }),
  });

  return {
    view,
    setMode(next) {
      if (next === mode || kind !== "markdown") return;
      mode = next;
      view.dispatch({ effects: modeCompartment.reconfigure(modeExtension(next)) });
    },
    getMode: () => mode,
    setLineNumbers(on) {
      if (on === numbered) return;
      numbered = on;
      view.dispatch({ effects: linesCompartment.reconfigure(on ? lineNumbers() : []) });
    },
    getLineNumbers: () => numbered,
    setDoc(text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: 0 },
        annotations: external.of(true),
      });
    },
    getText: () => view.state.doc.toString(),
    flush,
    focus: () => view.focus(),
    destroy() {
      flush();
      view.destroy();
    },
  };
}
