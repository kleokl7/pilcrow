package dev.pilcrow.editor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PageServerTest {
    private var next = 0
    private val pages = PageServer { "id${++next}" }

    private fun body(response: PageServer.Response?) = String(response!!.body, Charsets.UTF_8)
    private fun get(url: String): PageServer.Response? {
        val u = java.net.URI(url)
        return pages.serve(u.scheme, u.host, u.rawPath)
    }

    @Test fun `a page gets an address of its own, outside the app`() {
        val url = pages.prepare("<p>hi</p>", scripts = true)
        assertEquals("https://page.pilcrow.invalid/id1/", url)
        assertFalse(url.contains("appassets"))
    }

    @Test fun `the page is served with a sandbox the browser enforces`() {
        val response = get(pages.prepare("<p>hi</p>", scripts = true))!!
        assertEquals(200, response.status)
        val csp = response.headers.getValue("Content-Security-Policy")
        assertTrue(csp.startsWith("sandbox allow-scripts allow-forms allow-popups;"))
        assertFalse(csp.contains("allow-same-origin"))
        assertFalse(csp.contains("allow-top-navigation"))
        assertFalse(csp.contains("allow-popups-to-escape-sandbox"))
        assertTrue(csp.contains("frame-ancestors https://appassets.androidplatform.net"))
        assertEquals("no-referrer", response.headers["Referrer-Policy"])
        assertEquals("no-store", response.headers["Cache-Control"])
    }

    @Test fun `without page scripts the sandbox allows none`() {
        val response = get(pages.prepare("<p>hi</p>", scripts = false))!!
        val csp = response.headers.getValue("Content-Security-Policy")
        assertTrue(csp.startsWith("sandbox allow-forms allow-popups;"))
        assertFalse(csp.contains("allow-scripts"))
        assertTrue(body(response).startsWith("<base target=\"_blank\">"))
    }

    @Test fun `the link helper goes after the doctype, so the page keeps its standards mode`() {
        val text = body(get(pages.prepare("<!-- note -->\n<!DOCTYPE html>\n<html><body>x</body></html>", scripts = true)))
        assertTrue(text.startsWith("<!-- note -->\n<!DOCTYPE html><script>"))
        assertTrue(text.endsWith("</script>\n<html><body>x</body></html>"))
    }

    @Test fun `a page without a doctype gets the link helper first`() {
        assertTrue(body(get(pages.prepare("<p>hi</p>", scripts = true))).startsWith("<script>"))
    }

    @Test fun `only the newest page is served`() {
        val first = pages.prepare("<p>one</p>", scripts = true)
        val second = pages.prepare("<p>two</p>", scripts = true)
        assertEquals(404, get(first)!!.status)
        assertTrue(body(get(second)).endsWith("<p>two</p>"))
    }

    @Test fun `files next to the page cannot be reached and other addresses are not ours`() {
        val url = pages.prepare("<p>hi</p>", scripts = true)
        assertEquals(404, get(url + "style.css")!!.status)
        assertEquals(404, get("http://page.pilcrow.invalid/id1/")!!.status)
        assertNull(get("https://appassets.androidplatform.net/assets/editor/index.html"))
        assertNull(get("https://example.com/id1/"))
    }

    @Test fun `nothing is served before a page is prepared`() {
        assertEquals(404, get("https://page.pilcrow.invalid/id1/")!!.status)
    }
}
