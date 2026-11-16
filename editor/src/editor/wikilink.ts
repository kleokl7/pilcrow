import type { MarkdownConfig } from "@lezer/markdown";
import { styleTags, tags as t } from "@lezer/highlight";

const OPEN = 91; // [
const CLOSE = 93; // ]
const NEWLINE = 10;

/**
 * Obsidian-style [[target]] and [[target|alias]].
 * A wikilink never spans lines and never nests another "[".
 */
export const Wikilink: MarkdownConfig = {
  defineNodes: [{ name: "Wikilink" }, { name: "WikilinkMark" }],
  props: [styleTags({ WikilinkMark: t.processingInstruction, Wikilink: t.link })],
  parseInline: [
    {
      name: "Wikilink",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== OPEN || cx.char(pos + 1) !== OPEN) return -1;
        for (let i = pos + 2; i < cx.end; i++) {
          const ch = cx.char(i);
          if (ch === NEWLINE || ch === OPEN) return -1;
          if (ch === CLOSE) {
            if (cx.char(i + 1) !== CLOSE || i === pos + 2) return -1;
            return cx.addElement(
              cx.elt("Wikilink", pos, i + 2, [cx.elt("WikilinkMark", pos, pos + 2), cx.elt("WikilinkMark", i, i + 2)]),
            );
          }
        }
        return -1;
      },
    },
  ],
};
