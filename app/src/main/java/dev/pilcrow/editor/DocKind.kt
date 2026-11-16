package dev.pilcrow.editor

/**
 * What kind of file a note is, which decides how the web app shows it: "markdown", "html", "svg" or "csv".
 * The extension decides first, because Drive often reports a vague type; the reported type decides when there is none.
 */
object DocKind {
    private val BY_EXTENSION = mapOf(
        "html" to "html", "htm" to "html", "xhtml" to "html",
        "svg" to "svg",
        "csv" to "csv", "tsv" to "csv", "tab" to "csv",
    )
    private val BY_TYPE = mapOf(
        "text/html" to "html", "application/xhtml+xml" to "html",
        "image/svg+xml" to "svg",
        "text/csv" to "csv", "text/comma-separated-values" to "csv", "text/tab-separated-values" to "csv",
    )

    /** The types the picker and "Open with" offer besides Markdown and plain text. */
    val OTHER_TYPES: List<String> = BY_TYPE.keys.toList()

    fun of(name: String, mime: String?): String {
        val extension = name.substringAfterLast('.', "").lowercase()
        return BY_EXTENSION[extension] ?: BY_TYPE[mime?.lowercase()?.substringBefore(';')?.trim()] ?: "markdown"
    }
}
