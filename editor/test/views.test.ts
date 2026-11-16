import { createFakeNative, type NativeEvent, nativeFromWindow } from "../src/bridge";
import { mountApp } from "../src/ui/app";

function setup() {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById("app")!;
  const log: string[] = [];
  mountApp(root, createFakeNative(log));
  const send = (event: NativeEvent) => (window as unknown as { pilcrow: { dispatch(json: string): void } }).pilcrow.dispatch(JSON.stringify(event));
  const button = (label: string) =>
    [...root.querySelectorAll("button")].find((b) => b.textContent!.trim() === label || b.getAttribute("aria-label") === label) as HTMLButtonElement;
  send({ type: "settings", viewMode: "formatted", lineNumbers: false });
  return { root, log, send, button };
}

const doc = (kind: "html" | "svg" | "csv", name: string, text: string): NativeEvent => ({
  type: "document", token: "t1", name, kind, text, readOnly: false, notice: null, draftOfferAt: null,
});
const viewOf = (root: HTMLElement) => (root.querySelector(".cm-editor") as unknown as { pilcrowView: import("@codemirror/view").EditorView }).pilcrowView;
const showing = (root: HTMLElement) => root.querySelector(".pc-editor-screen")!.classList.contains("pc-viewing");

test("an HTML note opens as a page, served by native, in a sandboxed frame", () => {
  const { root, log, send } = setup();
  send(doc("html", "Garden plan.html", "<h1>Plan</h1>"));
  expect(showing(root)).toBe(true);
  expect(log[log.length - 1]).toBe('preparePage("p1", "<h1>Plan</h1>")');
  expect(root.querySelector("iframe")).toBeNull();
  send({ type: "page", ref: "p1", url: "https://page.pilcrow.invalid/abc/", scripts: true });
  const frame = root.querySelector("iframe")!;
  expect(frame.getAttribute("src")).toBe("https://page.pilcrow.invalid/abc/");
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-forms allow-popups");
  expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
});

test("a page without scripts gets a sandbox that allows none", () => {
  const { root, send } = setup();
  send(doc("html", "a.html", "<p>x</p>"));
  send({ type: "page", ref: "p1", url: "https://page.pilcrow.invalid/abc/", scripts: false });
  expect(root.querySelector("iframe")!.getAttribute("sandbox")).toBe("allow-forms allow-popups");
});

test("an answer for an older page is ignored", () => {
  const { root, send, button } = setup();
  send(doc("html", "a.html", "<p>x</p>"));
  button("Show source").click();
  button("Show source").click();
  send({ type: "page", ref: "p1", url: "https://page.pilcrow.invalid/old/", scripts: true });
  expect(root.querySelector("iframe")).toBeNull();
  send({ type: "page", ref: "p2", url: "https://page.pilcrow.invalid/new/", scripts: true });
  expect(root.querySelector("iframe")!.getAttribute("src")).toBe("https://page.pilcrow.invalid/new/");
});

test("the source of an HTML note is edited and saved, and the page shows the edit", () => {
  vi.useFakeTimers();
  const { root, log, send, button } = setup();
  send(doc("html", "a.html", "<p>x</p>"));
  button("Show source").click();
  expect(showing(root)).toBe(false);
  expect(root.querySelector(".cm-editor")!.classList.contains("pc-source")).toBe(true);
  viewOf(root).dispatch({ changes: { from: 8, insert: "<p>y</p>" } });
  button("Show source").click();
  expect(log).toContain('docChanged("t1", "<p>x</p><p>y</p>")');
  expect(log[log.length - 1]).toBe('preparePage("p2", "<p>x</p><p>y</p>")');
  expect(log.some((l) => l.startsWith("setViewMode"))).toBe(false);
  vi.useRealTimers();
});

test("source views of other files have undo and redo but no Markdown formatting", () => {
  const { root, send, button } = setup();
  send(doc("csv", "a.csv", "a,b\n1,2"));
  button("Show source").click();
  const labels = [...root.querySelectorAll(".pc-toolbar button")].map((b) => b.getAttribute("aria-label"));
  expect(labels).toEqual(["Undo", "Redo"]);
});

test("an SVG note is drawn as a picture, which runs nothing", () => {
  const { root, send } = setup();
  send(doc("svg", "Logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>'));
  const img = root.querySelector(".pc-view img") as HTMLImageElement;
  expect(img.getAttribute("src")!.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
  expect(decodeURIComponent(img.getAttribute("src")!.split(",").slice(1).join(","))).toContain("<circle");
});

test("a CSV note is shown as a table", () => {
  const { root, send } = setup();
  send(doc("csv", "Trip.csv", "Item,Cost\nTent,120"));
  expect([...root.querySelectorAll(".pc-view th")].map((c) => c.textContent)).toEqual(["Item", "Cost"]);
});

test("the menu names the view to switch to, and find switches to the source", () => {
  const { root, send, button } = setup();
  send(doc("csv", "Trip.csv", "Item,Cost\nTent,120"));
  button("More").click();
  expect(root.querySelector(".pc-sheet")!.textContent).toContain("Show source");
  button("Find in note").click();
  expect(showing(root)).toBe(false);
  button("More").click();
  expect(root.querySelector(".pc-sheet")!.textContent).toContain("Show table");
});

test("the web app talks to Android with one JSON message per call", () => {
  const sent: string[] = [];
  (window as unknown as { PilcrowNative?: unknown }).PilcrowNative = { postMessage: (m: string) => sent.push(m) };
  const native = nativeFromWindow()!;
  native.openRecent("id1");
  native.preparePage("p1", "<p>x</p>");
  expect(sent.map((m) => JSON.parse(m))).toEqual([
    { call: "openRecent", args: ["id1"] },
    { call: "preparePage", args: ["p1", "<p>x</p>"] },
  ]);
  delete (window as unknown as { PilcrowNative?: unknown }).PilcrowNative;
});

test("a file that cannot be drawn says so and keeps its source", async () => {
  const csv = await import("../src/views/csv");
  const spy = vi.spyOn(csv, "renderCsv").mockImplementation(() => {
    throw new Error("boom");
  });
  const { root, send, button } = setup();
  send(doc("csv", "Trip.csv", "a,b"));
  expect(root.querySelector(".pc-view")!.textContent).toBe("This file could not be shown. The ¶ button shows its source.");
  button("Show source").click();
  expect(root.querySelector(".cm-content")!.textContent).toBe("a,b");
  spy.mockRestore();
});
