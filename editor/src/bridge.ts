import type { DocKind, ViewMode } from "./editor/setup";

/**
 * Web → native. Each call is one message, {"call": name, "args": [...]}, posted to window.PilcrowNative, which
 * Android gives to the app's own page only (Bridge.kt). All arguments are strings or booleans.
 */
export interface NativeApi {
  ready(): void;
  openPicker(): void;
  createNote(): void;
  openRecent(id: string): void;
  /** Opens the picker to find a note the app lost access to. The file picked there takes the old entry's place. */
  findAgain(id: string): void;
  forgetRecent(id: string): void;
  /** `token` names the document the text belongs to; it comes from that document's event. */
  docChanged(token: string, text: string): void;
  closeDocument(): void;
  retrySave(): void;
  resolveConflict(choice: "mine" | "theirs" | "copy"): void;
  answerDraftOffer(restore: boolean): void;
  setViewMode(mode: ViewMode): void;
  setLineNumbers(on: boolean): void;
  requestDrafts(): void;
  readDraft(id: string): void;
  discardDraft(id: string): void;
  copyText(text: string): void;
  openUrl(url: string): void;
  exitApp(): void;
  /** An HTML page to show. Native answers with a "page" event carrying the same `ref`. */
  preparePage(ref: string, html: string): void;
}

export interface RecentNote {
  id: string;
  name: string;
  place: string;
  openedAt: number;
  unsavedAt: number | null;
  /** The app can no longer open this note without the user finding it again. */
  lost: boolean;
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
  /** Sent once, before anything else. */
  | { type: "settings"; viewMode: ViewMode; lineNumbers: boolean }
  | { type: "home"; recents: RecentNote[] }
  | { type: "document"; token: string; name: string; kind: DocKind; text: string; readOnly: boolean; notice: string | null; draftOfferAt: number | null }
  | { type: "saveState"; state: SaveStateName }
  | { type: "drafts"; drafts: DraftRow[] }
  | { type: "draftText"; id: string; name: string; text: string }
  | { type: "notice"; message: string }
  /** A recent note could not be opened because access to it has ended. */
  | { type: "lost"; id: string; name: string }
  /** Where the page for `ref` is served, and whether it may run scripts. */
  | { type: "page"; ref: string; url: string; scripts: boolean }
  | { type: "back" };

const METHODS: (keyof NativeApi)[] = [
  "ready", "openPicker", "createNote", "openRecent", "findAgain", "forgetRecent", "docChanged", "closeDocument", "retrySave",
  "resolveConflict", "answerDraftOffer", "setViewMode", "setLineNumbers", "requestDrafts", "readDraft", "discardDraft", "copyText",
  "openUrl", "exitApp", "preparePage",
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

/** The Android side, when the page runs in the app. */
export function nativeFromWindow(): NativeApi | null {
  const port = (window as unknown as { PilcrowNative?: { postMessage(message: string): void } }).PilcrowNative;
  if (!port) return null;
  const api = {} as Record<string, (...args: unknown[]) => void>;
  for (const call of METHODS) api[call] = (...args: unknown[]) => port.postMessage(JSON.stringify({ call, args }));
  return api as unknown as NativeApi;
}
