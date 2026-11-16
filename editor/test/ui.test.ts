import { createFakeNative, type NativeEvent } from "../src/bridge";
import { mountApp } from "../src/ui/app";

const HOUR = 60 * 60 * 1000;

function setup() {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById("app")!;
  const log: string[] = [];
  mountApp(root, createFakeNative(log));
  const send = (event: NativeEvent) => (window as unknown as { pilcrow: { dispatch(json: string): void } }).pilcrow.dispatch(JSON.stringify(event));
  const button = (label: string) =>
    [...root.querySelectorAll("button")].find((b) => b.textContent!.trim() === label || b.getAttribute("aria-label") === label) as HTMLButtonElement;
  const text = () => root.textContent!;
  return { root, log, send, button, text };
}

const home = (recents: Extract<NativeEvent, { type: "home" }>["recents"] = []): NativeEvent => ({ type: "home", recents });
const settings = (over: Partial<Extract<NativeEvent, { type: "settings" }>> = {}): NativeEvent => ({
  type: "settings", viewMode: "formatted", lineNumbers: false, ...over,
});
const doc = (over: Partial<Extract<NativeEvent, { type: "document" }>> = {}): NativeEvent => ({
  type: "document", token: "t1", name: "Weekly review.md", text: "# Title\n\nbody", readOnly: false, notice: null, draftOfferAt: null, ...over,
});

afterEach(() => vi.useRealTimers());

test("the app tells native when it is ready", () => {
  const { log } = setup();
  expect(log).toEqual(["ready()"]);
});

test("home lists recents and shows unsaved changes in the caret colour", () => {
  const { root, send } = setup();
  const at = new Date(2026, 10, 16, 14, 2).getTime();
  send(home([
    { id: "id1", name: "Quick note.md", place: "Drive", openedAt: Date.now() - 2 * HOUR, unsavedAt: null, lost: false },
    { id: "id2", name: "Content calendar.md", place: "Drive", openedAt: Date.now() - 30 * HOUR, unsavedAt: at, lost: false },
  ]));
  const rows = [...root.querySelectorAll(".pc-note")];
  expect(rows.length).toBe(2);
  expect(rows[0].querySelector(".pc-note-name")!.textContent).toBe("Quick note");
  expect(rows[0].querySelector(".pc-note-place")!.textContent).toBe("Drive");
  expect(rows[0].querySelector("time")!.textContent).toBe("2 h ago");
  const unsaved = rows[1].querySelector(".pc-note-place")!;
  expect(unsaved.textContent).toBe("Unsaved changes from 14:02");
  expect(unsaved.classList.contains("unsaved")).toBe(true);
});

test("empty home invites to open a note", () => {
  const { send, text } = setup();
  send(home());
  expect(text()).toContain("No notes yet. Open one from Drive to start.");
});

test("buttons call the bridge", () => {
  const { root, log, send, button } = setup();
  send(home([{ id: "id1", name: "A.md", place: "Drive", openedAt: Date.now(), unsavedAt: null, lost: false }]));
  button("Open from Drive").click();
  button("New note").click();
  (root.querySelector(".pc-note") as HTMLButtonElement).click();
  expect(log).toEqual(["ready()", "openPicker()", "createNote()", 'openRecent("id1")']);
});

test("document event opens the editor with the stored view mode", () => {
  const { send, button, root } = setup();
  send(settings({ viewMode: "source" }));
  send(doc());
  expect(root.querySelector(".pc-name")!.textContent).toBe("Weekly review");
  expect(button("Show Markdown source").getAttribute("aria-pressed")).toBe("true");
  expect(root.querySelector(".cm-editor")!.classList.contains("pc-source")).toBe(true);
});

test("the pilcrow button switches mode and tells native", () => {
  const { send, button, log, root } = setup();
  send(home());
  send(doc());
  expect(button("Show Markdown source").getAttribute("aria-pressed")).toBe("false");
  button("Show Markdown source").click();
  expect(log).toContain('setViewMode("source")');
  expect(button("Show Markdown source").getAttribute("aria-pressed")).toBe("true");
  expect(root.querySelector(".cm-content")!.textContent).toContain("# Title");
});

test("save state line follows native", () => {
  const { send, root, log } = setup();
  send(home());
  send(doc());
  const state = () => root.querySelector(".pc-state") as HTMLElement;
  expect(state().textContent).toBe("Saved to Drive");
  send({ type: "saveState", state: "saving" });
  expect(state().textContent).toBe("Saving…");
  send({ type: "saveState", state: "failed" });
  expect(state().textContent).toBe("Not saved. Tap to retry");
  expect(state().classList.contains("unsaved")).toBe(true);
  state().click();
  expect(log).toContain("retrySave()");
});

test("conflict sheet offers exactly three choices", () => {
  const { send, root, log, button } = setup();
  send(home());
  send(doc());
  send({ type: "saveState", state: "conflict" });
  const sheet = root.querySelector(".pc-sheet")!;
  expect(sheet.textContent).toContain("This note changed on another device after you opened it.");
  expect([...sheet.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Keep mine", "Load theirs", "Save mine as a copy"]);
  button("Load theirs").click();
  expect(log).toContain('resolveConflict("theirs")');
  send({ type: "back" });
  expect(root.querySelector(".pc-sheet")).not.toBeNull();
  send({ type: "saveState", state: "saved" });
  expect(root.querySelector(".pc-sheet")).toBeNull();
});

test("read-only document hides the toolbar and shows the notice", () => {
  const { send, root, text } = setup();
  send(home());
  send(doc({ readOnly: true, notice: "This file is larger than 5 MB, so it opens read-only." }));
  expect(root.querySelector(".pc-toolbar")).toBeNull();
  expect(text()).toContain("This file is larger than 5 MB, so it opens read-only.");
});

test("an editable document has the toolbar", () => {
  const { send, root } = setup();
  send(home());
  send(doc());
  expect(root.querySelector(".pc-toolbar")).not.toBeNull();
});

test("draft offer answers native", () => {
  const { send, log, button, text, root } = setup();
  send(home());
  send(doc({ draftOfferAt: new Date(2026, 10, 16, 9, 5).getTime() }));
  expect(text()).toContain("Restore unsaved changes from 09:05?");
  button("Restore").click();
  expect(log).toContain("answerDraftOffer(true)");
  expect(root.querySelector(".pc-offer")).toBeNull();
});

test("back closes a sheet before leaving the editor, and leaves the app from home", () => {
  const { send, root, log, button } = setup();
  send(home());
  send(doc());
  button("More").click();
  expect(root.querySelector(".pc-sheet")).not.toBeNull();
  send({ type: "back" });
  expect(root.querySelector(".pc-sheet")).toBeNull();
  expect(root.querySelector(".cm-editor")).not.toBeNull();
  send({ type: "back" });
  expect(log).toContain("closeDocument()");
  send(home());
  expect(root.querySelector(".cm-editor")).toBeNull();
  send({ type: "back" });
  expect(log[log.length - 1]).toBe("exitApp()");
});

test("typing reports docChanged with the full text", () => {
  vi.useFakeTimers();
  const { send, root, log } = setup();
  send(home());
  send(doc({ text: "abc" }));
  const view = (root.querySelector(".cm-editor") as unknown as { pilcrowView: import("@codemirror/view").EditorView }).pilcrowView;
  view.dispatch({ changes: { from: 3, insert: "x" } });
  vi.advanceTimersByTime(250);
  expect(log).toContain('docChanged("t1", "abcx")');
});

const viewOf = (root: HTMLElement) => (root.querySelector(".cm-editor") as unknown as { pilcrowView: import("@codemirror/view").EditorView }).pilcrowView;

test("back sends what was just typed before it closes the note", () => {
  vi.useFakeTimers();
  const { send, root, log, button } = setup();
  send(home());
  send(doc({ text: "abc" }));
  viewOf(root).dispatch({ changes: { from: 3, insert: " last words" } });
  button("Back").click();
  expect(log.slice(-2)).toEqual(['docChanged("t1", "abc last words")', "closeDocument()"]);
  viewOf(root).dispatch({ changes: { from: 0, insert: "more " } });
  send({ type: "back" });
  expect(log.slice(-2)).toEqual(['docChanged("t1", "more abc last words")', "closeDocument()"]);
});

test("the last words of a note that is being replaced carry that note's token", () => {
  vi.useFakeTimers();
  const { send, root, log } = setup();
  send(home());
  send(doc({ token: "t1", text: "note A" }));
  viewOf(root).dispatch({ changes: { from: 6, insert: " plus" } });
  send(doc({ token: "t2", name: "B.md", text: "note B" }));
  expect(log).toContain('docChanged("t1", "note A plus")');
  viewOf(root).dispatch({ changes: { from: 6, insert: "!" } });
  vi.advanceTimersByTime(250);
  expect(log[log.length - 1]).toBe('docChanged("t2", "note B!")');
});

test("typed text is sent at once when the app leaves the screen", () => {
  vi.useFakeTimers();
  const { send, root, log } = setup();
  send(home());
  send(doc({ text: "abc" }));
  viewOf(root).dispatch({ changes: { from: 3, insert: "x" } });
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  expect(log[log.length - 1]).toBe('docChanged("t1", "abcx")');
});

test("the menu opens drafts, and a draft can be copied or deleted", () => {
  const { send, root, log, button } = setup();
  send(home());
  button("More").click();
  button("Recent drafts").click();
  expect(log).toContain("requestDrafts()");
  send({ type: "drafts", drafts: [{ id: "d1", name: "Ideas.md", updatedAt: Date.now() - HOUR, saved: false }] });
  (root.querySelector(".pc-sheet .pc-note") as HTMLButtonElement).click();
  expect(log).toContain('readDraft("d1")');
  send({ type: "draftText", id: "d1", name: "Ideas.md", text: "my lost words" });
  expect(root.querySelector(".pc-sheet")!.textContent).toContain("my lost words");
  button("Copy all").click();
  expect(log).toContain('copyText("my lost words")');
  button("Delete").click();
  expect(log).toContain('discardDraft("d1")');
});

test("a notice shows and goes away", () => {
  vi.useFakeTimers();
  const { send, root } = setup();
  send(home());
  send({ type: "notice", message: "Drive did not keep access to this note. Pick it again." });
  expect(root.querySelector(".pc-toast")!.textContent).toBe("Drive did not keep access to this note. Pick it again.");
  vi.advanceTimersByTime(4000);
  expect(root.querySelector(".pc-toast")).toBeNull();
});

test("a note the app can no longer reach says so on home", () => {
  const { root, send } = setup();
  send(home([{ id: "id1", name: "Quick note.md", place: "Drive", openedAt: Date.now(), unsavedAt: null, lost: true }]));
  expect(root.querySelector(".pc-note-place")!.textContent).toBe("No access. Tap to find it again");
});

test("unsaved changes outrank lost access on home", () => {
  const { root, send } = setup();
  const at = new Date(2026, 10, 16, 14, 2).getTime();
  send(home([{ id: "id1", name: "Quick note.md", place: "Drive", openedAt: Date.now(), unsavedAt: at, lost: true }]));
  expect(root.querySelector(".pc-note-place")!.textContent).toBe("Unsaved changes from 14:02");
});

test("a lost note explains itself, then finds the note again or takes it off the list", () => {
  const { root, send, log, button } = setup();
  send(home());
  send({ type: "lost", id: "id1", name: "Quick note.md" });
  const sheet = root.querySelector(".pc-sheet")!;
  expect(sheet.textContent).toContain("Quick note");
  expect([...sheet.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Find it in Drive", "Remove from the list"]);
  button("Find it in Drive").click();
  expect(log[log.length - 1]).toBe('findAgain("id1")');
  expect(root.querySelector(".pc-sheet")).toBeNull();
  send({ type: "lost", id: "id1", name: "Quick note.md" });
  button("Remove from the list").click();
  expect(log[log.length - 1]).toBe('forgetRecent("id1")');
  send({ type: "lost", id: "id1", name: "Quick note.md" });
  send({ type: "back" });
  expect(root.querySelector(".pc-sheet")).toBeNull();
});

test("line numbers follow the stored setting", () => {
  const { send, root } = setup();
  send(settings({ lineNumbers: true }));
  send(doc());
  expect(root.querySelector(".cm-editor")!.classList.contains("pc-lines")).toBe(true);
});

test("the menu turns line numbers on and off and tells native", () => {
  const { send, root, log, button } = setup();
  send(settings());
  send(doc());
  const editor = () => root.querySelector(".cm-editor")!;
  expect(editor().classList.contains("pc-lines")).toBe(false);
  button("More").click();
  button("Show line numbers").click();
  expect(log[log.length - 1]).toBe("setLineNumbers(true)");
  expect(editor().classList.contains("pc-lines")).toBe(true);
  button("More").click();
  button("Hide line numbers").click();
  expect(log[log.length - 1]).toBe("setLineNumbers(false)");
  expect(editor().classList.contains("pc-lines")).toBe(false);
  send(home());
  send(doc({ token: "t2" }));
  expect(editor().classList.contains("pc-lines")).toBe(false);
});
