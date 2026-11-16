package dev.pilcrow.editor

import org.junit.Assert.assertEquals
import org.junit.Test

class DocKindTest {
    @Test fun `the file name decides first`() {
        assertEquals("markdown", DocKind.of("Weekly review.md", "application/octet-stream"))
        assertEquals("html", DocKind.of("Garden plan.HTML", "text/plain"))
        assertEquals("html", DocKind.of("page.htm", null))
        assertEquals("html", DocKind.of("page.xhtml", null))
        assertEquals("svg", DocKind.of("Logo.svg", "text/xml"))
        assertEquals("csv", DocKind.of("Budget.csv", "text/plain"))
        assertEquals("csv", DocKind.of("Budget.tsv", null))
    }

    @Test fun `without a known extension the reported type decides`() {
        assertEquals("html", DocKind.of("page", "text/html"))
        assertEquals("html", DocKind.of("page", "application/xhtml+xml"))
        assertEquals("svg", DocKind.of("logo", "image/svg+xml"))
        assertEquals("csv", DocKind.of("export", "text/csv"))
        assertEquals("csv", DocKind.of("export", "text/comma-separated-values"))
        assertEquals("csv", DocKind.of("export", "text/tab-separated-values"))
    }

    @Test fun `everything else is a markdown note`() {
        assertEquals("markdown", DocKind.of("notes.txt", "text/plain"))
        assertEquals("markdown", DocKind.of("Untitled", null))
    }
}
