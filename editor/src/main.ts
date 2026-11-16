import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/400-italic.css";
import "@fontsource/atkinson-hyperlegible-next/600.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "@fontsource/atkinson-hyperlegible-mono/400.css";
import "@fontsource/atkinson-hyperlegible-mono/600.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/editor.css";
import { type NativeApi, type NativeEvent, createFakeNative, nativeFromWindow } from "./bridge";
import type { ViewMode } from "./editor/setup";
import { SAMPLE_NOTE } from "./sample";
import { mountApp } from "./ui/app";

const params = new URLSearchParams(location.search);
const root = document.getElementById("app")!;

/**
 * A pretend Android side, for the browser: ?demo shows Home with sample notes,
 * ?demo&screen=editor|source|conflict|drafts jumps to that state, &theme=light|dark forces a theme.
 */
function demoNative(): NativeApi {
  const HOUR = 60 * 60 * 1000;
  const now = Date.now();
  let viewMode: ViewMode = params.get("screen") === "source" ? "source" : "formatted";
  const send = (event: NativeEvent) => (window as unknown as { pilcrow: { dispatch(json: string): void } }).pilcrow.dispatch(JSON.stringify(event));
  const home = () =>
    send({
      type: "home",
      viewMode,
      recents: [
        { id: "1", name: "Quick note.md", place: "Drive", openedAt: now - 12 * 60 * 1000, unsavedAt: null },
        { id: "2", name: "Weekly review.md", place: "Drive", openedAt: now - 2 * HOUR, unsavedAt: null },
        { id: "3", name: "Content calendar.md", place: "Drive", openedAt: now - 26 * HOUR, unsavedAt: now - 20 * HOUR },
        { id: "4", name: "Reading list.md", place: "Drive", openedAt: now - 13 * 24 * HOUR, unsavedAt: null },
        { id: "5", name: "Ideas for the newsletter.md", place: "Drive", openedAt: now - 19 * 24 * HOUR, unsavedAt: null },
      ],
    });
  const open = (text = SAMPLE_NOTE, name = "Weekly review.md") => send({ type: "document", name, text, readOnly: false, notice: null, draftOfferAt: null });
  const drafts = () => send({ type: "drafts", drafts: [{ id: "d1", name: "Content calendar.md", updatedAt: now - 20 * HOUR, saved: false }, { id: "d2", name: "Weekly review.md", updatedAt: now - 2 * HOUR, saved: true }] });

  return {
    ...createFakeNative([]),
    ready() {
      home();
      const screen = params.get("screen");
      if (screen === "editor" || screen === "source" || screen === "conflict") {
        open();
        const view = (document.querySelector(".cm-editor") as unknown as { pilcrowView?: { dispatch(spec: unknown): void; focus(): void } } | null)?.pilcrowView;
        if (screen === "editor") {
          view?.dispatch({ selection: { anchor: SAMPLE_NOTE.indexOf("This week") + 9 } });
          view?.focus();
        }
      }
      if (screen === "conflict") send({ type: "saveState", state: "conflict" });
      if (screen === "drafts") drafts();
    },
    openPicker: () => open(),
    openRecent: () => open(),
    createNote: () => open("", "Untitled.md"),
    closeDocument: home,
    docChanged() {
      send({ type: "saveState", state: "saving" });
      setTimeout(() => send({ type: "saveState", state: "saved" }), 600);
    },
    setViewMode(mode) {
      viewMode = mode;
    },
    resolveConflict: () => send({ type: "saveState", state: "saved" }),
    retrySave: () => send({ type: "saveState", state: "saved" }),
    requestDrafts: drafts,
    readDraft: (id) => send({ type: "draftText", id, name: "Content calendar.md", text: "| Post | Status |\n| ---- | ------ |\n| Launch thread | Draft |\n" }),
  };
}

const theme = params.get("theme");
if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);

const native = nativeFromWindow() ?? (params.has("demo") ? demoNative() : null);
if (native) mountApp(root, native);
else root.textContent = "Pilcrow runs inside its Android app. Add ?demo to the address to try it in a browser.";
