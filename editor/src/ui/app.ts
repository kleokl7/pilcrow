import { type NativeApi, type NativeEvent, type RecentNote, installDispatcher } from "../bridge";
import type { ViewMode } from "../editor/setup";
import { h } from "./dom";
import { type EditorScreen, renderEditorScreen } from "./editor-screen";
import { renderHome } from "./home";
import { type Sheet, Sheets, conflictQuestion, draftList, draftText, menu } from "./sheets";

/** How long a one-line notice stays on screen. */
const NOTICE_MS = 4000;

/** Builds the whole interface inside `root` and connects it to the Android side. */
export function mountApp(root: HTMLElement, native: NativeApi): void {
  const stage = root.appendChild(h("div", { class: "pc-stage" }));
  const sheets = new Sheets(root);
  let viewMode: ViewMode = "formatted";
  let recents: RecentNote[] = [];
  let screen: EditorScreen | null = null;
  let conflict: Sheet | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  const show = (el: HTMLElement) => stage.replaceChildren(el);

  const openDrafts = () => native.requestDrafts();

  /** Nothing typed may still be waiting in the editor when the note is closed. */
  const closeDocument = () => {
    screen?.flushChanges();
    native.closeDocument();
  };

  // The app is leaving the screen: Android may stop this page at any moment.
  const flushIfHidden = () => {
    if (document.visibilityState === "hidden") screen?.flushChanges();
  };
  document.addEventListener("visibilitychange", flushIfHidden);
  window.addEventListener("pagehide", () => screen?.flushChanges());

  const showHome = () => {
    screen?.destroy();
    screen = null;
    conflict = null;
    sheets.closeAll();
    show(renderHome(recents, {
      onOpen: () => native.openPicker(),
      onNew: () => native.createNote(),
      onRecent: (id) => native.openRecent(id),
      onMenu: () => {
        const sheet = sheets.open(menu([{ label: "Recent drafts", run: openDrafts }], () => sheet.close()));
      },
    }));
  };

  const showDocument = (event: Extract<NativeEvent, { type: "document" }>) => {
    screen?.destroy();
    conflict = null;
    sheets.closeAll();
    const current = renderEditorScreen({
      name: event.name,
      text: event.text,
      mode: viewMode,
      readOnly: event.readOnly,
      notice: event.notice,
      draftOfferAt: event.draftOfferAt,
      onBack: closeDocument,
      onMenu: () => {
        const sheet = sheets.open(menu([
          { label: "Find in note", run: () => current.find() },
          { label: current.editor.getMode() === "source" ? "Show formatted note" : "Show Markdown source", run: () => current.toggleMode() },
          { label: "Recent drafts", run: openDrafts },
        ], () => sheet.close()));
      },
      onMode: (mode) => {
        viewMode = mode;
        native.setViewMode(mode);
      },
      // The token is fixed here, so a change that leaves late still names the note it was typed in.
      onChange: (text) => native.docChanged(event.token, text),
      onRetry: () => native.retrySave(),
      onDraftAnswer: (restore) => native.answerDraftOffer(restore),
      onOpenUrl: (url) => native.openUrl(url),
    });
    screen = current;
    show(current.el);
  };

  const toast = (message: string) => {
    root.querySelector(".pc-toast")?.remove();
    if (toastTimer) clearTimeout(toastTimer);
    const el = root.appendChild(h("div", { class: "pc-toast", role: "status" }, message));
    toastTimer = setTimeout(() => el.remove(), NOTICE_MS);
  };

  installDispatcher((event) => {
    switch (event.type) {
      case "home":
        viewMode = event.viewMode;
        recents = event.recents;
        showHome();
        break;
      case "document":
        showDocument(event);
        break;
      case "saveState":
        screen?.setSaveState(event.state);
        if (event.state === "conflict") {
          conflict ??= sheets.open(conflictQuestion((choice) => native.resolveConflict(choice)), false);
        } else if (conflict) {
          conflict.close();
          conflict = null;
        }
        break;
      case "drafts": {
        sheets.closeAll(false);
        sheets.open(draftList(event.drafts, (id) => native.readDraft(id)));
        break;
      }
      case "draftText": {
        sheets.closeAll(false);
        const sheet = sheets.open(draftText(event.name, event.text, {
          copy: () => native.copyText(event.text),
          remove: () => {
            native.discardDraft(event.id);
            sheet.close();
          },
        }));
        break;
      }
      case "notice":
        toast(event.message);
        break;
      case "back": {
        const top = sheets.top();
        if (top) {
          if (top.dismissable) top.close();
        } else if (screen) {
          closeDocument();
        } else {
          native.exitApp();
        }
        break;
      }
    }
  });

  native.ready();
}
