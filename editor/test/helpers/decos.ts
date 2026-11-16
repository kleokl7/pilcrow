import type { DecorationSet } from "@codemirror/view";
import { buildDecorations } from "../../src/editor/inline";
import type { MarksMode } from "../../src/editor/reveal";
import { stateOf } from "./tree";

/**
 * A decoration set as readable strings:
 *   replace@0-3   widget.checkbox@2-5   mark.pc-strong@4-8   line.pc-h2.pc-active@0[data-mark=##]
 */
export function describe_(set: DecorationSet): string[] {
  const out: string[] = [];
  const iter = set.iter();
  while (iter.value) {
    const spec = iter.value.spec as { kind: string; class?: string; widget?: { kind: string }; attributes?: Record<string, string> };
    if (spec.kind === "line") {
      const mark = spec.attributes?.["data-mark"];
      const classes = spec.class ? "." + spec.class.split(" ").join(".") : "";
      out.push(`line${classes}@${iter.from}${mark ? `[data-mark=${mark}]` : ""}`);
    } else if (spec.kind === "mark") {
      out.push(`mark.${spec.class}@${iter.from}-${iter.to}`);
    } else if (spec.widget) {
      out.push(`${spec.kind === "block" ? "block" : "widget"}.${spec.widget.kind}@${iter.from}-${iter.to}`);
    } else {
      out.push(`replace@${iter.from}-${iter.to}`);
    }
    iter.next();
  }
  return out;
}

export function decos(doc: string, cursor: number, marks: MarksMode = "hide"): string[] {
  return describe_(buildDecorations(stateOf(doc, cursor), [{ from: 0, to: doc.length }], { marks }));
}
