import { h } from "../ui/dom";

/**
 * The picture view of an SVG file. It is drawn as an image, which is the safe way to show SVG: scripts in it never
 * run and it loads nothing from anywhere else.
 */
export function renderSvg(text: string): HTMLElement {
  const img = h("img", { class: "pc-svg-img", alt: "", src: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text) });
  const el = h("div", { class: "pc-svg" }, img);
  img.addEventListener("error", () => el.replaceChildren(h("p", { class: "pc-empty" }, "This picture could not be drawn. Its source may have a mistake.")));
  return el;
}
