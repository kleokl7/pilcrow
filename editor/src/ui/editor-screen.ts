import { openSearchPanel } from "@codemirror/search";
import type { SaveStateName } from "../bridge";
import { type DocKind, type PilcrowEditor, type ViewMode, createEditor } from "../editor/setup";
import { renderCsv } from "../views/csv";
import { type PageView, createPageView } from "../views/page";
import { renderSvg } from "../views/svg";
import { ICON_BACK, ICON_MORE, PILCROW, clockTime, displayName, h, svg } from "./dom";
import { createToolbar } from "./toolbar";

export interface EditorScreenOptions {
  name: string;
  kind: DocKind;
  text: string;
  mode: ViewMode;
  lineNumbers: boolean;
  readOnly: boolean;
  notice: string | null;
  draftOfferAt: number | null;
  onBack(): void;
  onMenu(): void;
  /** Markdown only: the view the user chose, to remember. */
  onMode(mode: ViewMode): void;
  onChange(text: string): void;
  onRetry(): void;
  onDraftAnswer(restore: boolean): void;
  onOpenUrl(url: string): void;
  /** HTML only: asks native to serve this page. The answer comes to showPage with the same ref. */
  onPreparePage(ref: string, html: string): void;
}

export interface EditorScreen {
  el: HTMLElement;
  editor: PilcrowEditor;
  setSaveState(state: SaveStateName): void;
  toggleMode(): void;
  /** What the menu calls the other view: "Show Markdown source", "Show table"… */
  otherViewLabel(): string;
  /** Native has the page for `ref` ready at `url`. */
  showPage(ref: string, url: string, scripts: boolean): void;
  /** Sends a change that is still waiting. */
  flushChanges(): void;
  find(): void;
  destroy(): void;
}

const STATE_TEXT: Record<SaveStateName, string> = {
  saved: "Saved to Drive",
  saving: "Saving…",
  failed: "Not saved. Tap to retry",
  conflict: "Not saved",
};

const VIEW_NAME: Record<Exclude<DocKind, "markdown">, string> = { html: "page", svg: "picture", csv: "table" };

export function renderEditorScreen(opts: EditorScreenOptions): EditorScreen {
  const markdown = opts.kind === "markdown";
  const back = h("button", { type: "button", class: "pc-iconbtn", "aria-label": "Back" }, svg(ICON_BACK));
  back.addEventListener("click", opts.onBack);

  const state = h("button", { type: "button", class: "pc-state" }, opts.readOnly ? "Read-only" : STATE_TEXT.saved);
  let saveState: SaveStateName = "saved";
  state.addEventListener("click", () => {
    if (saveState === "failed") opts.onRetry();
  });

  // Markdown starts in the view the user chose last. Other files start in their own view: page, picture or table.
  let viewing = !markdown;
  const pressed = () => String(markdown ? opts.mode === "source" : !viewing);
  const marks = h("button", { type: "button", class: "pc-marks", "aria-label": markdown ? "Show Markdown source" : "Show source", "aria-pressed": pressed() }, svg(PILCROW));
  const more = h("button", { type: "button", class: "pc-iconbtn", "aria-label": "More" }, svg(ICON_MORE));
  more.addEventListener("click", opts.onMenu);

  const host = h("div", { class: "pc-editor-host" });
  const el = h("div", { class: "pc-screen pc-editor-screen" },
    h("header", { class: "pc-appbar" }, back, h("div", { class: "pc-title" }, h("div", { class: "pc-name" }, displayName(opts.name)), state), marks, more),
  );

  if (opts.notice) el.append(h("div", { class: "pc-noticebar" }, opts.notice));

  if (opts.draftOfferAt !== null) {
    const offer = h("div", { class: "pc-offer" }, h("span", {}, `Restore unsaved changes from ${clockTime(opts.draftOfferAt)}?`));
    const answer = (label: string, restore: boolean) => {
      const button = h("button", { type: "button", class: restore ? "pc-offer-yes" : "pc-offer-no" }, label);
      button.addEventListener("click", () => {
        offer.remove();
        opts.onDraftAnswer(restore);
      });
      return button;
    };
    offer.append(answer("Discard", false), answer("Restore", true));
    el.append(offer);
  }

  el.append(host);

  const editor = createEditor({
    parent: host,
    doc: opts.text,
    mode: opts.mode,
    kind: opts.kind,
    lineNumbers: opts.lineNumbers,
    readOnly: opts.readOnly,
    onChange: opts.onChange,
    onOpenUrl: opts.onOpenUrl,
  });
  // Lets tests and the WebView inspector reach the editor from the DOM.
  (editor.view.dom as unknown as { pilcrowView: unknown }).pilcrowView = editor.view;

  if (!opts.readOnly) el.append(createToolbar({ editor, formatting: markdown }));

  // ---- The view of a file that is not Markdown ----
  const view = h("div", { class: "pc-view" });
  let page: PageView | null = null;
  let pageRef = 0;
  if (!markdown) host.append(view);

  const renderView = () => {
    const text = editor.getText();
    if (opts.kind === "html") {
      page = createPageView();
      view.replaceChildren(page.el);
      opts.onPreparePage(`p${++pageRef}`, text);
      return;
    }
    page = null;
    try {
      view.replaceChildren(opts.kind === "svg" ? renderSvg(text) : renderCsv(text, opts.name));
    } catch {
      // A file this view cannot handle must not take the screen down with it: the source still works.
      view.replaceChildren(h("p", { class: "pc-empty" }, "This file could not be shown. The ¶ button shows its source."));
    }
  };

  const setViewing = (on: boolean) => {
    viewing = on;
    el.classList.toggle("pc-viewing", on);
    marks.setAttribute("aria-pressed", pressed());
    if (on) {
      // The view shows what is in the editor, typed changes included; they are on their way to Drive first.
      editor.flush();
      renderView();
    } else {
      page = null;
      view.replaceChildren();
    }
  };
  if (viewing) setViewing(true);

  const toggleMode = () => {
    if (!markdown) return setViewing(!viewing);
    const next: ViewMode = editor.getMode() === "source" ? "formatted" : "source";
    editor.setMode(next);
    opts.mode = next;
    marks.setAttribute("aria-pressed", pressed());
    opts.onMode(next);
  };
  marks.addEventListener("click", toggleMode);

  return {
    el,
    editor,
    setSaveState(next) {
      saveState = next;
      state.textContent = STATE_TEXT[next];
      state.classList.toggle("unsaved", next === "failed" || next === "conflict");
    },
    toggleMode,
    otherViewLabel() {
      if (markdown) return editor.getMode() === "source" ? "Show formatted note" : "Show Markdown source";
      return viewing ? "Show source" : `Show ${VIEW_NAME[opts.kind as keyof typeof VIEW_NAME]}`;
    },
    showPage(ref, url, scripts) {
      if (page && viewing && ref === `p${pageRef}`) page.show(url, scripts);
    },
    flushChanges: () => editor.flush(),
    find() {
      // Search works on the text, so the page, picture or table gives way to the source.
      if (viewing) setViewing(false);
      openSearchPanel(editor.view);
    },
    destroy: () => editor.destroy(),
  };
}
