import { type EditorState, type Extension, Facet, type Range, RangeSet, StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { type MarksMode, revealedAt, selectionTouches } from "./reveal";
import { BulletWidget, CheckboxWidget, RuleWidget } from "./widgets";

export interface PreviewOptions {
  marks: MarksMode;
  onOpenUrl: (url: string) => void;
  /** Overridable for tests. Defaults to CodeMirror's own "a composition has changed the text". */
  isComposing?: (view: EditorView) => boolean;
}

interface LineInfo {
  classes: string[];
  attributes: Record<string, string>;
}

const INLINE_CLASS: Record<string, string> = {
  Emphasis: "pc-em",
  StrongEmphasis: "pc-strong",
  Strikethrough: "pc-strike",
  InlineCode: "pc-code",
};
const INLINE_MARK = /^(EmphasisMark|StrikethroughMark|CodeMark)$/;
/** At most this many lines of one selection get the active-line wash. */
const MAX_ACTIVE_LINES = 200;

/**
 * Turns Markdown syntax inside `ranges` into decorations. Pure: the same state, ranges and options
 * always give the same set. The document text is never changed.
 */
export function buildDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  opts: { marks: MarksMode },
): DecorationSet {
  const hide = opts.marks === "hide";
  const doc = state.doc;
  const out: Range<Decoration>[] = [];
  const seen = new Set<string>();
  const lines = new Map<number, LineInfo>();

  const once = (key: string) => (seen.has(key) ? false : (seen.add(key), true));
  const replace = (from: number, to: number) => {
    if (to > from && once(`r${from}-${to}`)) out.push(Decoration.replace({ kind: "replace" }).range(from, to));
  };
  const widget = (from: number, to: number, w: CheckboxWidget | BulletWidget | RuleWidget) => {
    if (once(`w${from}-${to}`)) out.push(Decoration.replace({ kind: "widget", widget: w }).range(from, to));
  };
  const mark = (from: number, to: number, cls: string, attributes?: Record<string, string>) => {
    if (to > from && once(`m${cls}${from}-${to}`)) out.push(Decoration.mark({ kind: "mark", class: cls, attributes }).range(from, to));
  };
  /** Hide a mark, or dim it when it is revealed or when marks are never hidden. */
  const hideOrDim = (from: number, to: number, revealed: boolean) => {
    if (hide && !revealed) replace(from, to);
    else mark(from, to, "pc-mark");
  };
  const line = (pos: number): LineInfo => {
    const from = doc.lineAt(pos).from;
    let info = lines.get(from);
    if (!info) lines.set(from, (info = { classes: [], attributes: {} }));
    return info;
  };
  const lineClass = (pos: number, cls: string) => {
    const info = line(pos);
    if (!info.classes.includes(cls)) info.classes.push(cls);
  };
  const lineTouched = (pos: number) => {
    const l = doc.lineAt(pos);
    return selectionTouches(state, l.from, l.to);
  };
  /** A block mark that lives in the margin: always hidden inline, shown in the margin on the cursor line. */
  const marginMark = (from: number, to: number, text: string) => {
    if (!hide) return mark(from, from + text.length, "pc-mark");
    replace(from, to);
    if (lineTouched(from)) line(from).attributes["data-mark"] = text;
  };
  /** End of the spaces and tabs that follow `pos`, limited to `limit`. */
  const afterSpaces = (pos: number, limit: number) => {
    let end = pos;
    while (end < limit && /[ \t]/.test(doc.sliceString(end, end + 1))) end++;
    return end;
  };

  const tree = syntaxTree(state);
  for (const range of ranges) {
    const eachLine = (from: number, to: number, fn: (lineFrom: number) => void) => {
      let l = doc.lineAt(Math.max(from, range.from));
      const last = Math.min(to, range.to);
      for (;;) {
        fn(l.from);
        if (l.to >= last || l.number >= doc.lines) break;
        l = doc.line(l.number + 1);
      }
    };

    tree.iterate({
      from: range.from,
      to: range.to,
      enter: (ref) => {
        const { name, from, to } = ref;
        const node = ref.node;

        if (name === "Frontmatter" || name === "Table") {
          // Drawn by the block widgets; when revealed they show as source lines.
          eachLine(from, to, (lf) => lineClass(lf, name === "Table" ? "pc-table-source" : "pc-frontmatter"));
          return false;
        }

        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          lineClass(from, `pc-h${Math.min(Number(heading[1]), 3)}`);
          for (let child = node.firstChild; child; child = child.nextSibling) {
            if (child.name !== "HeaderMark") continue;
            if (child.from === from) marginMark(child.from, afterSpaces(child.to, to), doc.sliceString(child.from, child.to));
            else hideOrDim(child.from, child.to, lineTouched(from));
          }
          return;
        }

        const setext = /^SetextHeading(\d)$/.exec(name);
        if (setext) {
          const underline = node.lastChild;
          eachLine(from, underline ? underline.from - 1 : to, (lf) => lineClass(lf, `pc-h${setext[1]}`));
          if (underline?.name === "HeaderMark") hideOrDim(underline.from, underline.to, revealedAt(state, { name, from, to }));
          return;
        }

        if (name === "Blockquote") {
          eachLine(from, to, (lf) => lineClass(lf, "pc-quote"));
          return;
        }
        if (name === "QuoteMark") {
          marginMark(from, afterSpaces(to, Math.min(to + 1, doc.lineAt(from).to)), ">");
          return;
        }

        if (name === "FencedCode" || name === "CodeBlock") {
          eachLine(from, to, (lf) => lineClass(lf, "pc-codeblock"));
          if (name === "FencedCode") {
            const revealed = revealedAt(state, { name, from, to });
            const open = doc.lineAt(from);
            const close = doc.lineAt(to);
            hideOrDim(Math.max(open.from, from), open.to, revealed);
            if (close.number !== open.number && node.lastChild?.name === "CodeMark") hideOrDim(node.lastChild.from, close.to, revealed);
          }
          return false;
        }

        if (name === "HorizontalRule") {
          if (hide && !revealedAt(state, { name, from, to })) widget(from, to, new RuleWidget());
          else mark(from, to, "pc-mark");
          return;
        }

        if (name === "ListItem") {
          listItem(node);
          return;
        }

        const inlineClass = INLINE_CLASS[name];
        if (inlineClass) {
          const first = node.firstChild;
          const last = node.lastChild;
          if (first && last && first !== last && INLINE_MARK.test(first.name) && INLINE_MARK.test(last.name)) {
            const revealed = revealedAt(state, { name, from, to });
            mark(first.to, last.from, inlineClass);
            hideOrDim(first.from, first.to, revealed);
            hideOrDim(last.from, last.to, revealed);
          }
          return;
        }

        if (name === "Link") {
          link(node);
          return;
        }
        if (name === "Autolink") {
          const url = node.getChild("URL");
          if (!url) return;
          const revealed = revealedAt(state, { name, from, to });
          hideOrDim(from, url.from, revealed);
          hideOrDim(url.to, to, revealed);
          mark(url.from, url.to, "pc-link", revealed ? undefined : { "data-url": doc.sliceString(url.from, url.to) });
          return false;
        }
        if (name === "URL" && node.parent?.name !== "Link" && node.parent?.name !== "Image") {
          const revealed = revealedAt(state, { name, from, to });
          mark(from, to, "pc-link", revealed ? undefined : { "data-url": doc.sliceString(from, to) });
          return;
        }

        if (name === "Wikilink") {
          wikilink(node);
          return false;
        }
        return;
      },
    });
  }

  function listItem(item: SyntaxNode) {
    const listMark = item.getChild("ListMark");
    if (!listMark) return;
    const leading = listMark.from - doc.lineAt(listMark.from).from;
    const task = item.getChild("Task");
    const marker = task?.getChild("TaskMarker");
    const info = line(listMark.from);
    info.attributes["data-li"] = marker ? "task" : item.parent?.name === "OrderedList" ? "ordered" : "bullet";
    info.attributes.style = `--pc-lead:${leading}`;

    if (marker) {
      const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
      if (checked) {
        lineClass(listMark.from, "pc-task-done");
        mark(afterSpaces(marker.to, doc.lineAt(marker.to).to), doc.lineAt(marker.to).to, "pc-done-text");
      }
      if (revealedAt(state, { name: "TaskMarker", from: listMark.from, to: marker.to })) {
        mark(listMark.from, marker.to, "pc-mark");
      } else {
        replace(listMark.from, marker.from);
        widget(marker.from, marker.to, new CheckboxWidget(checked));
      }
      return;
    }
    if (item.parent?.name === "BulletList") {
      if (revealedAt(state, { name: "ListMark", from: listMark.from, to: listMark.to })) mark(listMark.from, listMark.to, "pc-mark");
      else widget(listMark.from, listMark.to, new BulletWidget());
    }
  }

  function link(node: SyntaxNode) {
    const url = node.getChild("URL");
    const marks = node.getChildren("LinkMark");
    if (!url || marks.length < 2) return; // reference-style links stay as typed
    const [open, close] = marks;
    const revealed = revealedAt(state, { name: "Link", from: node.from, to: node.to });
    hideOrDim(open.from, open.to, revealed);
    hideOrDim(close.from, node.to, revealed);
    mark(open.to, close.from, "pc-link", revealed ? undefined : { "data-url": doc.sliceString(url.from, url.to) });
  }

  function wikilink(node: SyntaxNode) {
    const open = node.firstChild;
    const close = node.lastChild;
    if (!open || !close || open === close) return;
    const inner = doc.sliceString(open.to, close.from);
    const pipe = inner.indexOf("|");
    const shownFrom = pipe >= 0 ? open.to + pipe + 1 : open.to;
    const revealed = revealedAt(state, { name: "Wikilink", from: node.from, to: node.to });
    hideOrDim(open.from, shownFrom, revealed);
    hideOrDim(close.from, close.to, revealed);
    mark(shownFrom, close.from, "pc-wikilink");
  }

  // The lines the cursor is on.
  for (const r of state.selection.ranges) {
    let l = doc.lineAt(r.from);
    for (let i = 0; i < MAX_ACTIVE_LINES; i++) {
      lineClass(l.from, "pc-active");
      if (l.to >= r.to || l.number >= doc.lines) break;
      l = doc.line(l.number + 1);
    }
  }

  for (const [from, info] of lines) {
    if (!info.classes.length && !Object.keys(info.attributes).length) continue;
    out.push(
      Decoration.line({
        kind: "line",
        class: info.classes.join(" ") || undefined,
        attributes: Object.keys(info.attributes).length ? info.attributes : undefined,
      }).range(from),
    );
  }
  return Decoration.set(out, true);
}

/** Flips the "[ ]" / "[x]" of the task marker that contains `pos`. Nothing else in the document changes. */
export function toggleTask(view: EditorView, pos: number): boolean {
  const { state } = view;
  const l = state.doc.lineAt(pos);
  let marker: { from: number; to: number } | null = null;
  syntaxTree(state).iterate({
    from: l.from,
    to: l.to,
    enter: (n) => {
      if (n.name === "TaskMarker" && pos >= n.from && pos <= n.to) marker = { from: n.from, to: n.to };
    },
  });
  if (!marker || state.readOnly) return false;
  const { from } = marker as { from: number; to: number };
  const checked = /x/i.test(state.doc.sliceString(from + 1, from + 2));
  view.dispatch({ changes: { from: from + 1, to: from + 2, insert: checked ? " " : "x" }, userEvent: "input.toggle" });
  return true;
}

const previewConfig = Facet.define<PreviewOptions, PreviewOptions>({
  combine: (values) => values[values.length - 1] ?? { marks: "hide", onOpenUrl() {} },
});
const refresh = StateEffect.define<null>();

function isReplace(deco: Decoration): boolean {
  const kind = (deco.spec as { kind?: string }).kind;
  return kind === "replace" || kind === "widget";
}

export const previewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
      this.atomic = this.decorations.update({ filter: (_f, _t, d) => isReplace(d) });
    }

    build(view: EditorView): DecorationSet {
      return buildDecorations(view.state, view.visibleRanges, { marks: view.state.facet(previewConfig).marks });
    }

    update(update: ViewUpdate) {
      const config = update.state.facet(previewConfig);
      const composing = (config.isComposing ?? ((v: EditorView) => v.composing))(update.view);
      const refreshed = update.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)));
      if (composing && !refreshed) {
        // A keyboard is in the middle of a word. Moving marks under it loses characters, so only follow the text.
        this.decorations = this.decorations.map(update.changes);
        this.atomic = this.atomic.map(update.changes);
        return;
      }
      if (
        refreshed ||
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state) ||
        update.startState.facet(previewConfig) !== config
      ) {
        this.decorations = this.build(update.view);
        this.atomic = this.decorations.update({ filter: (_f, _t, d) => isReplace(d) });
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    eventHandlers: {
      compositionend(_event, view) {
        setTimeout(() => {
          if (view.dom.isConnected || view.dom.ownerDocument) view.dispatch({ effects: refresh.of(null) });
        }, 0);
      },
      mousedown(event, view) {
        const target = event.target as HTMLElement | null;
        const box = target?.closest?.(".pc-check");
        if (box) {
          event.preventDefault();
          return toggleTask(view, view.posAtDOM(box));
        }
        const linkEl = target?.closest?.(".pc-link[data-url]") as HTMLElement | null;
        if (linkEl) {
          event.preventDefault();
          view.state.facet(previewConfig).onOpenUrl(linkEl.dataset.url!);
          return true;
        }
        return false;
      },
    },
  },
);

/** The Formatted view: Markdown marks are hidden away from the cursor and the text is styled in place. */
export function livePreview(opts: PreviewOptions): Extension {
  return [
    previewConfig.of(opts),
    previewPlugin,
    EditorView.atomicRanges.of((view) => view.plugin(previewPlugin)?.atomic ?? RangeSet.empty),
  ];
}
