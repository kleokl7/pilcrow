# Changelog

## 0.1.1 (2026-11-16)

### New

- **HTML, SVG and CSV files.** An HTML file opens as a web page, an SVG file as a picture and
  a CSV or TSV file as a table. The ¶ button shows the source, which you edit and save like a
  note. Links on a page open in your browser.
- **Line numbers.** Turn them on in the ⋮ menu. They sit in the left margin in both views of a
  note and in the source of every other file.

### Fixed

- A note opened with "Open with" in the Drive app stopped opening once Pilcrow had closed,
  because Drive lends such a note only until then. Pilcrow now asks to keep access every time.
  When access has ended anyway, the note says so on the home screen, and finding it once in the
  picker keeps it for good. The note found that way takes the old entry's place in the list.
- A note opened with "Open with" now opens in the view you chose last, as other notes do.

### Changed

- Pilcrow now has the internet permission. Only HTML pages use it, to load their styles,
  scripts and pictures. The app's own screens still load nothing from outside.
- The connection between the app's page and Android is now offered to the app's own page
  only, and each message is checked on arrival. An HTML page runs in a sandbox, from an
  address of its own, and cannot reach it. A link opens the browser only for a tap. A page
  that hangs the screen is stopped, and the note is closed with a message.

## 0.1.0 (2026-11-16)

First public version.
