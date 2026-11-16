import { WidgetType } from "@codemirror/view";

/** The box of a task item. A tap is handled by the live-preview plugin. */
export class CheckboxWidget extends WidgetType {
  readonly kind = "checkbox";
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const box = document.createElement("span");
    box.className = this.checked ? "pc-check pc-check-on" : "pc-check";
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.checked));
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

export class BulletWidget extends WidgetType {
  readonly kind = "bullet";
  eq() {
    return true;
  }
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "pc-bullet";
    return dot;
  }
}

export class RuleWidget extends WidgetType {
  readonly kind = "rule";
  eq() {
    return true;
  }
  toDOM() {
    const rule = document.createElement("span");
    rule.className = "pc-rule";
    return rule;
  }
}
