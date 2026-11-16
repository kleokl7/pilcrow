type Child = Node | string | null | undefined | false;

/** Small DOM builder: h("button", { class: "x", "aria-label": "More" }, "text"). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  for (const child of children) if (child) el.append(child);
  return el;
}

export function svg(markup: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "pc-icon";
  span.innerHTML = markup;
  return span;
}

/** The mark: a pilcrow whose second stroke is the text cursor. Also the button that shows the Markdown source. */
export const PILCROW = '<svg viewBox="0 0 96 96" aria-hidden="true"><path class="g-ink" d="M54 20H43a17 17 0 0 0 0 34h3v24h8z"/><rect class="g-caret" x="63" y="15" width="7" height="66" rx="3.5"/></svg>';
export const ICON_BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
export const ICON_MORE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v.01M12 12v.01M12 18.5v.01" stroke-width="2.6"/></svg>';

/** "Weekly review.md" → "Weekly review". */
export function displayName(name: string): string {
  return name.replace(/\.(md|markdown|txt)$/i, "");
}

const two = (n: number) => String(n).padStart(2, "0");

/** 24-hour clock time, "14:02". */
export function clockTime(at: number): string {
  const d = new Date(at);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Just now", "12 min ago", "2 h ago", "Yesterday", "3 Nov", "3 Nov 2025". */
export function relativeTime(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const then = new Date(at);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (at >= startOfToday || minutes < 6 * 60) return `${Math.floor(minutes / 60)} h ago`;
  if (at >= startOfToday - 24 * 60 * 60 * 1000) return "Yesterday";
  const day = `${then.getDate()} ${MONTHS[then.getMonth()]}`;
  return then.getFullYear() === today.getFullYear() ? day : `${day} ${then.getFullYear()}`;
}
