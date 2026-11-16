import { createEditor } from "../src/editor/setup";

const base = { parent: document.body, readOnly: false, onChange() {}, onOpenUrl() {} };

test("switching mode keeps text and selection", () => {
  const ed = createEditor({ ...base, doc: "# a\n\n**b**", mode: "formatted" });
  ed.view.dispatch({ selection: { anchor: 7 } });
  ed.setMode("source");
  expect(ed.getText()).toBe("# a\n\n**b**");
  expect(ed.view.state.selection.main.head).toBe(7);
  expect(ed.getMode()).toBe("source");
  ed.destroy();
});

test("the editor works in lf and never re-joins with crlf", () => {
  const ed = createEditor({ ...base, doc: "a\nb", mode: "source" });
  ed.view.dispatch({ changes: { from: 3, insert: "\nc" } });
  expect(ed.getText()).toBe("a\nb\nc");
  ed.destroy();
});

test("readOnly blocks edits", () => {
  const ed = createEditor({ ...base, doc: "a", mode: "source", readOnly: true });
  expect(ed.view.state.readOnly).toBe(true);
  ed.destroy();
});

test("a change is reported at most 250 ms after it was typed, also while typing goes on", () => {
  vi.useFakeTimers();
  const calls: string[] = [];
  const ed = createEditor({ ...base, doc: "a", mode: "source", onChange: (t) => calls.push(t) });
  ed.view.dispatch({ changes: { from: 1, insert: "b" } });
  vi.advanceTimersByTime(100);
  ed.view.dispatch({ changes: { from: 2, insert: "c" } });
  vi.advanceTimersByTime(149);
  expect(calls).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(calls).toEqual(["abc"]);
  ed.view.dispatch({ changes: { from: 3, insert: "d" } });
  ed.destroy();
  expect(calls).toEqual(["abc", "abcd"]);
  vi.useRealTimers();
});

test("flush reports a pending change at once and only once", () => {
  vi.useFakeTimers();
  const calls: string[] = [];
  const ed = createEditor({ ...base, doc: "a", mode: "source", onChange: (t) => calls.push(t) });
  ed.view.dispatch({ changes: { from: 1, insert: "b" } });
  ed.flush();
  expect(calls).toEqual(["ab"]);
  ed.flush();
  vi.advanceTimersByTime(1000);
  expect(calls).toEqual(["ab"]);
  ed.destroy();
  vi.useRealTimers();
});

test("setDoc replaces the text without reporting a change", () => {
  vi.useFakeTimers();
  const calls: string[] = [];
  const ed = createEditor({ ...base, doc: "a", mode: "source", onChange: (t) => calls.push(t) });
  ed.setDoc("fresh");
  vi.advanceTimersByTime(500);
  expect(ed.getText()).toBe("fresh");
  expect(calls).toEqual([]);
  ed.destroy();
  vi.useRealTimers();
});
