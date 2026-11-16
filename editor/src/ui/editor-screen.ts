import { openSearchPanel } from "@codemirror/search";
import type { SaveStateName } from "../bridge";
import { type PilcrowEditor, type ViewMode, createEditor } from "../editor/setup";
import { ICON_BACK, ICON_MORE, PILCROW, clockTime, displayName, h, svg } from "./dom";
import { createToolbar } from "./toolbar";

export interface EditorScreenOptions {
  name: string;
  text: string;
  mode: ViewMode;
  lineNumbers: boolean;
  readOnly: boolean;
  notice: string | null;
  draftOfferAt: number | null;
  onBack(): void;
  onMenu(): void;
  onMode(mode: ViewMode): void;
  onChange(text: string): void;
  onRetry(): void;
  onDraftAnswer(restore: boolean): void;
  onOpenUrl(url: string): void;
}

export interface EditorScreen {
  el: HTMLElement;
  editor: PilcrowEditor;
  setSaveState(state: SaveStateName): void;
  toggleMode(): void;
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

export function renderEditorScreen(opts: EditorScreenOptions): EditorScreen {
  const back = h("button", { type: "button", class: "pc-iconbtn", "aria-label": "Back" }, svg(ICON_BACK));
  back.addEventListener("click", opts.onBack);

  const state = h("button", { type: "button", class: "pc-state" }, opts.readOnly ? "Read-only" : STATE_TEXT.saved);
  let saveState: SaveStateName = "saved";
  state.addEventListener("click", () => {
    if (saveState === "failed") opts.onRetry();
  });

  const marks = h("button", { type: "button", class: "pc-marks", "aria-label": "Show Markdown source", "aria-pressed": String(opts.mode === "source") }, svg(PILCROW));
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
    lineNumbers: opts.lineNumbers,
    readOnly: opts.readOnly,
    onChange: opts.onChange,
    onOpenUrl: opts.onOpenUrl,
  });
  // Lets tests and the WebView inspector reach the editor from the DOM.
  (editor.view.dom as unknown as { pilcrowView: unknown }).pilcrowView = editor.view;

  if (!opts.readOnly) el.append(createToolbar({ editor }));

  const toggleMode = () => {
    const next: ViewMode = editor.getMode() === "source" ? "formatted" : "source";
    editor.setMode(next);
    marks.setAttribute("aria-pressed", String(next === "source"));
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
    flushChanges: () => editor.flush(),
    find: () => openSearchPanel(editor.view),
    destroy: () => editor.destroy(),
  };
}
