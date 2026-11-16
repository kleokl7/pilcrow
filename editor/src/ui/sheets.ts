import type { DraftRow } from "../bridge";
import { displayName, h } from "./dom";
import { noteRow } from "./home";

export interface Sheet {
  el: HTMLElement;
  /** False for the conflict question: it only goes away when it is answered. */
  dismissable: boolean;
  close(): void;
}

/** Sheets stack on top of the screen. The app owns the stack so that Back can close the top one. */
export class Sheets {
  private stack: Sheet[] = [];
  constructor(private root: HTMLElement) {}

  open(content: HTMLElement, dismissable = true): Sheet {
    const scrim = h("div", { class: "pc-scrim" });
    const panel = h("div", { class: "pc-sheet", role: "dialog" }, content);
    const el = h("div", { class: "pc-sheet-layer" }, scrim, panel);
    const sheet: Sheet = {
      el,
      dismissable,
      close: () => {
        el.remove();
        this.stack = this.stack.filter((s) => s !== sheet);
      },
    };
    if (dismissable) scrim.addEventListener("click", sheet.close);
    this.root.append(el);
    this.stack.push(sheet);
    return sheet;
  }

  top(): Sheet | undefined {
    return this.stack[this.stack.length - 1];
  }

  closeAll(includeLocked = true) {
    for (const sheet of [...this.stack]) if (includeLocked || sheet.dismissable) sheet.close();
  }
}

export function menu(items: { label: string; run(): void }[], close: () => void): HTMLElement {
  const list = h("div", { class: "pc-menu" });
  for (const item of items) {
    const button = h("button", { type: "button", class: "pc-menu-item" }, item.label);
    button.addEventListener("click", () => {
      close();
      item.run();
    });
    list.append(button);
  }
  return list;
}

export function conflictQuestion(answer: (choice: "mine" | "theirs" | "copy") => void): HTMLElement {
  const choice = (label: string, value: "mine" | "theirs" | "copy") => {
    const button = h("button", { type: "button", class: "pc-btn quiet" }, label);
    button.addEventListener("click", () => answer(value));
    return button;
  };
  return h("div", { class: "pc-question" },
    h("p", {}, "This note changed on another device after you opened it."),
    choice("Keep mine", "mine"),
    choice("Load theirs", "theirs"),
    choice("Save mine as a copy", "copy"),
  );
}

/** A recent note that can no longer be opened: usually one that came from "Open with", once the app was closed. */
export function lostNote(name: string, on: { find(): void; forget(): void }): HTMLElement {
  const find = h("button", { type: "button", class: "pc-btn primary" }, "Find it in Drive");
  find.addEventListener("click", on.find);
  const forget = h("button", { type: "button", class: "pc-btn quiet" }, "Remove from the list");
  forget.addEventListener("click", on.forget);
  return h("div", { class: "pc-question" },
    h("p", {}, `Pilcrow can no longer open ${displayName(name)}.`),
    h("p", { class: "pc-question-more" }, "Notes opened from the Drive app are lent to Pilcrow until it closes. Find this one once in the picker and Pilcrow will keep access."),
    find,
    forget,
  );
}

export function draftList(drafts: DraftRow[], onTap: (id: string) => void): HTMLElement {
  const list = h("div", { class: "pc-drafts" }, h("h2", {}, "Recent drafts"));
  if (!drafts.length) list.append(h("p", { class: "pc-empty" }, "No drafts. Pilcrow keeps a copy here of everything you type, for seven days."));
  for (const draft of drafts) {
    list.append(noteRow({
      name: draft.name,
      second: draft.saved ? "Saved to Drive" : "Not saved to Drive",
      unsaved: !draft.saved,
      at: draft.updatedAt,
      onTap: () => onTap(draft.id),
    }));
  }
  return list;
}

export function draftText(name: string, text: string, on: { copy(): void; remove(): void }): HTMLElement {
  const copy = h("button", { type: "button", class: "pc-btn primary" }, "Copy all");
  copy.addEventListener("click", on.copy);
  const remove = h("button", { type: "button", class: "pc-btn quiet" }, "Delete");
  remove.addEventListener("click", on.remove);
  return h("div", { class: "pc-draft" },
    h("h2", {}, displayName(name)),
    h("pre", { class: "pc-draft-text" }, text),
    h("div", { class: "pc-draft-actions" }, copy, remove),
  );
}
