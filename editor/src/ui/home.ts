import type { RecentNote } from "../bridge";
import { ICON_MORE, PILCROW, clockTime, displayName, h, relativeTime, svg } from "./dom";

export interface HomeHandlers {
  onOpen(): void;
  onNew(): void;
  onRecent(id: string): void;
  onMenu(): void;
}

/** One row of a list of notes: name, a second line, a time. Used on Home and in the drafts sheet. */
export function noteRow(opts: { name: string; second: string; unsaved?: boolean; at: number; onTap(): void }): HTMLElement {
  const row = h("button", { type: "button", class: "pc-note" },
    h("span", { class: "pc-note-text" },
      h("span", { class: "pc-note-name" }, displayName(opts.name)),
      h("span", { class: opts.unsaved ? "pc-note-place unsaved" : "pc-note-place" }, opts.second),
    ),
    h("time", {}, relativeTime(opts.at)),
  );
  row.addEventListener("click", opts.onTap);
  return row;
}

export function renderHome(recents: RecentNote[], on: HomeHandlers): HTMLElement {
  const more = h("button", { type: "button", class: "pc-iconbtn", "aria-label": "More" }, svg(ICON_MORE));
  more.addEventListener("click", on.onMenu);

  const list = h("div", { class: "pc-home-list" });
  if (recents.length) {
    list.append(h("h2", {}, "Recently opened"));
    for (const note of recents) {
      list.append(noteRow({
        name: note.name,
        second: note.unsavedAt !== null ? `Unsaved changes from ${clockTime(note.unsavedAt)}` : note.place,
        unsaved: note.unsavedAt !== null,
        at: note.openedAt,
        onTap: () => on.onRecent(note.id),
      }));
    }
  } else {
    list.append(h("p", { class: "pc-empty" }, "No notes yet. Open one from Drive to start."));
  }

  const open = h("button", { type: "button", class: "pc-btn primary" }, "Open from Drive");
  open.addEventListener("click", on.onOpen);
  const create = h("button", { type: "button", class: "pc-btn quiet" }, "New note");
  create.addEventListener("click", on.onNew);

  return h("div", { class: "pc-screen pc-home" },
    h("header", { class: "pc-home-head" }, h("div", { class: "pc-brand" }, svg(PILCROW), "Pilcrow"), more),
    list,
    h("div", { class: "pc-home-actions" }, open, create),
  );
}
