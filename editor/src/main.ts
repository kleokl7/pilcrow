import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/400-italic.css";
import "@fontsource/atkinson-hyperlegible-next/600.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "@fontsource/atkinson-hyperlegible-mono/400.css";
import "@fontsource/atkinson-hyperlegible-mono/600.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/editor.css";
import { createEditor } from "./editor/setup";
import { SAMPLE_NOTE } from "./sample";

const app = document.getElementById("app")!;

if (new URLSearchParams(location.search).has("demo")) {
  createEditor({ parent: app, doc: SAMPLE_NOTE, mode: "formatted", readOnly: false, onChange() {}, onOpenUrl() {} });
}
