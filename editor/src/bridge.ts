import type { ViewMode } from "./editor/setup";

/** Web → native. Kotlin implements this as window.PilcrowNative. All arguments are strings or booleans. */
export interface NativeApi {
  ready(): void;
  openPicker(): void;
  createNote(): void;
  openRecent(id: string): void;
  docChanged(text: string): void;
  closeDocument(): void;
  retrySave(): void;
  resolveConflict(choice: "mine" | "theirs" | "copy"): void;
  answerDraftOffer(restore: boolean): void;
  setViewMode(mode: ViewMode): void;
  requestDrafts(): void;
  readDraft(id: string): void;
  discardDraft(id: string): void;
  copyText(text: string): void;
  openUrl(url: string): void;
  exitApp(): void;
}

export interface RecentNote {
  id: string;
  name: string;
  place: string;
  openedAt: number;
  unsavedAt: number | null;
}
export interface DraftRow {
  id: string;
  name: string;
  updatedAt: number;
  saved: boolean;
}
export type SaveStateName = "saved" | "saving" | "failed" | "conflict";

/** Native → web. Kotlin calls window.pilcrow.dispatch(jsonString). */
export type NativeEvent =
  | { type: "home"; recents: RecentNote[]; viewMode: ViewMode }
  | { type: "document"; name: string; text: string; readOnly: boolean; notice: string | null; draftOfferAt: number | null }
  | { type: "saveState"; state: SaveStateName }
  | { type: "drafts"; drafts: DraftRow[] }
  | { type: "draftText"; id: string; name: string; text: string }
  | { type: "notice"; message: string }
  | { type: "back" };

const METHODS: (keyof NativeApi)[] = [
  "ready", "openPicker", "createNote", "openRecent", "docChanged", "closeDocument", "retrySave", "resolveConflict",
  "answerDraftOffer", "setViewMode", "requestDrafts", "readDraft", "discardDraft", "copyText", "openUrl", "exitApp",
];

/** A stand-in for the Android side that records every call as "method(arg, …)". */
export function createFakeNative(log: string[]): NativeApi {
  const api = {} as Record<string, (...args: unknown[]) => void>;
  for (const name of METHODS) {
    api[name] = (...args: unknown[]) => {
      log.push(`${name}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
    };
  }
  return api as unknown as NativeApi;
}

export function installDispatcher(handler: (event: NativeEvent) => void): void {
  (window as unknown as { pilcrow: { dispatch(json: string): void } }).pilcrow = {
    dispatch: (json) => handler(JSON.parse(json) as NativeEvent),
  };
}

export function nativeFromWindow(): NativeApi | null {
  return (window as unknown as { PilcrowNative?: NativeApi }).PilcrowNative ?? null;
}
