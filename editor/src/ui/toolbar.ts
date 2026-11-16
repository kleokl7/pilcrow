import { redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { cycleHeading, indentItem, outdentItem, toggleBold, toggleBullet, toggleItalic, toggleNumbered, toggleTaskItem } from "../editor/commands";
import type { PilcrowEditor } from "../editor/setup";

interface Button {
  label: string;
  /** Text or the inner markup of a 24 x 24 icon. */
  face: string;
  cls?: string;
  run: (view: EditorView) => boolean;
}

const icon = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

const FORMAT: Button[] = [
  { label: "Heading", face: "H", run: cycleHeading },
  { label: "Bold", face: "B", run: toggleBold },
  { label: "Italic", face: "I", cls: "pc-tb-italic", run: toggleItalic },
  { label: "Checkbox", face: icon('<rect x="4.5" y="4.5" width="15" height="15" rx="4"/><path d="M8.5 12.3l2.6 2.6 4.6-5.2"/>'), run: toggleTaskItem },
  { label: "Bullet list", face: icon('<path d="M9.5 7h10M9.5 12h10M9.5 17h10"/><path d="M5 7v.01M5 12v.01M5 17v.01" stroke-width="2.8"/>'), run: toggleBullet },
  { label: "Numbered list", face: icon('<path d="M10.5 7h9M10.5 12h9M10.5 17h9"/><path d="M4.4 5.6l1.4-.8V9M4.2 14.6c.2-1.1 2.6-1.2 2.5.2-.1.9-1.6 1.6-2.6 2.7h2.8" stroke-width="1.5"/>'), run: toggleNumbered },
  { label: "Indent", face: icon('<path d="M4 6h16M11 12h9M4 18h16M4 9.5l3 2.5-3 2.5"/>'), run: indentItem },
  { label: "Outdent", face: icon('<path d="M4 6h16M11 12h9M4 18h16M7.5 9.5l-3 2.5 3 2.5"/>'), run: outdentItem },
];
const HISTORY: Button[] = [
  { label: "Undo", face: icon('<path d="M8 5L4 9l4 4"/><path d="M4.5 9H14a5 5 0 0 1 0 10h-3"/>'), run: undo },
  { label: "Redo", face: icon('<path d="M16 5l4 4-4 4"/><path d="M19.5 9H10a5 5 0 0 0 0 10h3"/>'), run: redo },
];

/** The formatting bar that sits directly above the keyboard. */
export function createToolbar(opts: { editor: PilcrowEditor }): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "pc-toolbar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Formatting");

  const group = (buttons: Button[], cls: string) => {
    const el = bar.appendChild(document.createElement("div"));
    el.className = cls;
    for (const b of buttons) {
      const button = el.appendChild(document.createElement("button"));
      button.type = "button";
      button.className = b.cls ? `pc-tb ${b.cls}` : "pc-tb";
      button.setAttribute("aria-label", b.label);
      button.innerHTML = b.face;
      // Cancelling pointerdown keeps the focus in the editor, so the keyboard stays open.
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      // The command runs on the tap itself: a swipe along the bar starts on a button too.
      button.addEventListener("click", () => b.run(opts.editor.view));
    }
  };
  group(FORMAT, "pc-tb-scroll");
  group(HISTORY, "pc-tb-fixed");
  return bar;
}
