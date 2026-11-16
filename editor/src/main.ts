import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/400-italic.css";
import "@fontsource/atkinson-hyperlegible-next/600.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "@fontsource/atkinson-hyperlegible-mono/400.css";
import "@fontsource/atkinson-hyperlegible-mono/600.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/editor.css";
import { type NativeApi, type NativeEvent, type RecentNote, createFakeNative, nativeFromWindow } from "./bridge";
import type { DocKind, ViewMode } from "./editor/setup";
import { SAMPLE_CSV, SAMPLE_HTML, SAMPLE_NOTE, SAMPLE_SVG } from "./sample";
import { mountApp } from "./ui/app";

const params = new URLSearchParams(location.search);
const root = document.getElementById("app")!;

/**
 * A pretend Android side, for the browser: ?demo shows Home with sample notes,
 * ?demo&screen=editor|source|conflict|drafts|lost|html|svg|csv jumps to that state, &theme=light|dark forces a theme,
 * &lines turns line numbers on.
 */
function demoNative(): NativeApi {
  const HOUR = 60 * 60 * 1000;
  const now = Date.now();
  let viewMode: ViewMode = params.get("screen") === "source" ? "source" : "formatted";
  let lineNumbers = params.has("lines");
  const send = (event: NativeEvent) => (window as unknown as { pilcrow: { dispatch(json: string): void } }).pilcrow.dispatch(JSON.stringify(event));
  let recents: RecentNote[] = [
    { id: "1", name: "Quick note.md", place: "Drive", openedAt: now - 12 * 60 * 1000, unsavedAt: null, lost: false },
    { id: "2", name: "Weekly review.md", place: "Drive", openedAt: now - 2 * HOUR, unsavedAt: null, lost: false },
    { id: "3", name: "Content calendar.md", place: "Drive", openedAt: now - 26 * HOUR, unsavedAt: now - 20 * HOUR, lost: false },
    { id: "4", name: "Reading list.md", place: "Drive", openedAt: now - 13 * 24 * HOUR, unsavedAt: null, lost: true },
    { id: "5", name: "Ideas for the newsletter.md", place: "Drive", openedAt: now - 19 * 24 * HOUR, unsavedAt: null, lost: false },
    { id: "html", name: "Garden plan.html", place: "Drive", openedAt: now - 20 * 24 * HOUR, unsavedAt: null, lost: false },
    { id: "svg", name: "Logo.svg", place: "Drive", openedAt: now - 21 * 24 * HOUR, unsavedAt: null, lost: false },
    { id: "csv", name: "Trip budget.csv", place: "Drive", openedAt: now - 22 * 24 * HOUR, unsavedAt: null, lost: false },
  ];
  const FILES: Record<string, { name: string; kind: DocKind; text: string }> = {
    html: { name: "Garden plan.html", kind: "html", text: SAMPLE_HTML },
    svg: { name: "Logo.svg", kind: "svg", text: SAMPLE_SVG },
    csv: { name: "Trip budget.csv", kind: "csv", text: SAMPLE_CSV },
  };
  const home = () => send({ type: "home", recents });
  let opened = 0;
  const open = (text = SAMPLE_NOTE, name = "Weekly review.md", kind: DocKind = "markdown") =>
    send({ type: "document", token: `demo${++opened}`, name, kind, text, readOnly: false, notice: null, draftOfferAt: null });
  const openFile = (id: string) => open(FILES[id].text, FILES[id].name, FILES[id].kind);
  const drafts = () => send({ type: "drafts", drafts: [{ id: "d1", name: "Content calendar.md", updatedAt: now - 20 * HOUR, saved: false }, { id: "d2", name: "Weekly review.md", updatedAt: now - 2 * HOUR, saved: true }] });

  return {
    ...createFakeNative([]),
    ready() {
      send({ type: "settings", viewMode, lineNumbers });
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
      if (screen === "lost") send({ type: "lost", id: "4", name: "Reading list.md" });
      if (screen && screen in FILES) openFile(screen);
    },
    openPicker: () => open(),
    openRecent(id) {
      const recent = recents.find((r) => r.id === id);
      if (recent?.lost) send({ type: "lost", id, name: recent.name });
      else if (id in FILES) openFile(id);
      else open();
    },
    findAgain(id) {
      recents = recents.map((r) => (r.id === id ? { ...r, lost: false, openedAt: Date.now() } : r));
      open(SAMPLE_NOTE, recents.find((r) => r.id === id)?.name);
    },
    forgetRecent(id) {
      recents = recents.filter((r) => r.id !== id);
      home();
    },
    createNote: () => open("", "Untitled.md"),
    closeDocument: home,
    docChanged() {
      send({ type: "saveState", state: "saving" });
      setTimeout(() => send({ type: "saveState", state: "saved" }), 600);
    },
    setViewMode(mode) {
      viewMode = mode;
    },
    setLineNumbers(on) {
      lineNumbers = on;
    },
    // There is no page server in a browser: a test fills this address in itself (scratch Playwright scripts do).
    preparePage: (ref) => setTimeout(() => send({ type: "page", ref, url: "https://page.pilcrow.invalid/demo/", scripts: true })),
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
