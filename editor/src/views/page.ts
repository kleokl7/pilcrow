import { h } from "../ui/dom";

export interface PageView {
  el: HTMLElement;
  /** Shows the page Android serves at `url`. `scripts` is Android's answer to whether the page may run any. */
  show(url: string, scripts: boolean): void;
}

/**
 * The page view of an HTML file. The page comes from its own address, never the app's, and the frame is sandboxed:
 * no access to the app, no navigating it away, no windows except the ones a tap on a link asks for (Android turns
 * those into the browser). The server sends the same sandbox as a header, so the browser enforces it twice.
 */
export function createPageView(): PageView {
  const el = h("div", { class: "pc-page" }, h("p", { class: "pc-empty" }, "Opening the page…"));
  return {
    el,
    show(url, scripts) {
      // A new frame each time: a changed sandbox only applies to the next page a frame loads.
      const frame = h("iframe", {
        class: "pc-page-frame",
        title: "Page",
        sandbox: scripts ? "allow-scripts allow-forms allow-popups" : "allow-forms allow-popups",
        referrerpolicy: "no-referrer",
        src: url,
      });
      el.replaceChildren(frame);
    },
  };
}
