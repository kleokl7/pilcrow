# Third-party notices

Pilcrow is MIT licensed (see [LICENSE](LICENSE)). The app that is built from this
repository also contains the following work by other people. Each keeps its own licence.

| Component | Used for | Licence |
| --- | --- | --- |
| [CodeMirror 6](https://codemirror.net/) (`@codemirror/*`) | the text editor | MIT |
| [Lezer](https://lezer.codemirror.net/) (`@lezer/*`) | the parsers for Markdown, YAML, HTML, CSS, JavaScript and XML | MIT |
| [Atkinson Hyperlegible Next and Mono](https://www.brailleinstitute.org/freefont/), packaged by [Fontsource](https://fontsource.org/) | the typefaces | SIL Open Font License 1.1 |
| [AndroidX](https://developer.android.com/jetpack/androidx) (`core`, `activity`, `webkit`) | Android support libraries | Apache License 2.0 |
| [Kotlin standard library](https://kotlinlang.org/) | the language runtime | Apache License 2.0 |

The full licence texts ship with each package: under `editor/node_modules/<package>/LICENSE`
after `npm ci`, and in the published artifacts of the AndroidX and Kotlin libraries.

Tools that build and test the project but are not part of the app: esbuild (MIT),
TypeScript (Apache 2.0), Vitest (MIT), jsdom (MIT), JUnit 4 (EPL 1.0), JSON-java (public domain),
Gradle and the Android Gradle Plugin (Apache 2.0).
