// Bundles the editor into the Android app's assets: one script, one stylesheet, the fonts.
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const out = new URL("../app/src/main/assets/editor/", import.meta.url).pathname;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  target: "chrome100",
  minify: true,
  outfile: out + "app.js",
  loader: { ".woff2": "file", ".woff": "file" },
  assetNames: "fonts/[name]",
  logLevel: "warning",
});
await cp("index.html", out + "index.html");
