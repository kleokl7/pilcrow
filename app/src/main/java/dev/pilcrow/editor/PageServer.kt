package dev.pilcrow.editor

import java.util.UUID

/**
 * Serves the HTML note on screen to the page frame, from an address of its own: https://page.pilcrow.invalid/<id>/.
 *
 * The page never shares the app's address (appassets.androidplatform.net), so it cannot reach the app's page or its
 * bridge to Android. The response tells the browser to sandbox it as well: the page runs as a nameless origin that
 * can show itself, run its scripts and load from the web, but cannot touch the app, open windows by itself or move
 * the app away. ".invalid" names nothing on the internet, so a request this server does not answer goes nowhere.
 *
 * Only the newest page is kept. Thread-safe: pages are prepared on the main thread and served on WebView's.
 */
class PageServer(private val newId: () -> String = { UUID.randomUUID().toString() }) {

    class Response(val status: Int, val reason: String, val headers: Map<String, String>, val body: ByteArray) {
        val mime = "text/html"
        val encoding = "utf-8"
    }

    private class Page(val id: String, val body: ByteArray, val headers: Map<String, String>)

    @Volatile private var page: Page? = null

    /**
     * Keeps `html` as the page to show and returns its address.
     * @param scripts false where the bridge cannot be kept from the page: then nothing on the page runs.
     */
    fun prepare(html: String, scripts: Boolean): String {
        val id = newId()
        val sandbox = if (scripts) "sandbox allow-scripts allow-forms allow-popups" else "sandbox allow-forms allow-popups"
        val headers = mapOf(
            "Content-Security-Policy" to "$sandbox; frame-ancestors $APP_ORIGIN",
            "Referrer-Policy" to "no-referrer",
            "Cache-Control" to "no-store",
            "X-Content-Type-Options" to "nosniff",
        )
        page = Page(id, withHelper(html, if (scripts) LINK_SCRIPT else LINK_BASE).toByteArray(Charsets.UTF_8), headers)
        return "https://$HOST/$id/"
    }

    /** The answer for a request to the page's address; null for any other address, which is not this server's. */
    fun serve(scheme: String?, host: String?, path: String?): Response? {
        if (host != HOST) return null
        val current = page
        if (scheme != "https" || current == null || path != "/${current.id}/") return NOT_FOUND
        return Response(200, "OK", current.headers, current.body)
    }

    companion object {
        const val HOST = "page.pilcrow.invalid"
        const val APP_ORIGIN = "https://appassets.androidplatform.net"

        private val NOT_FOUND = Response(404, "Not Found", mapOf("Cache-Control" to "no-store"), ByteArray(0))

        private fun withHelper(html: String, helper: String): String {
            val end = afterDoctype(html)
            return html.substring(0, end) + helper + html.substring(end)
        }

        /**
         * Where the leading spaces, comments and doctype end; 0 when there is no doctype. Anything put before the
         * doctype would switch the page to quirks mode. A plain scan, not a pattern, so no page can make it slow.
         */
        private fun afterDoctype(html: String): Int {
            var i = if (html.startsWith("\uFEFF")) 1 else 0
            while (i < html.length) {
                if (html[i].isWhitespace()) {
                    i++
                } else if (html.startsWith("<!--", i)) {
                    val end = html.indexOf("-->", i + 4)
                    if (end < 0) return 0
                    i = end + 3
                } else {
                    break
                }
            }
            if (!html.regionMatches(i, "<!doctype", 0, 9, ignoreCase = true)) return 0
            val close = html.indexOf('>', i)
            return if (close < 0) 0 else close + 1
        }

        /**
         * Links to other sites open in the browser. The script asks for a new window on the tap itself, and the app
         * opens the browser only for windows that came from a tap. Links within the page work as usual.
         */
        private val LINK_SCRIPT = """<script>/* Pilcrow: links to other sites open in the browser. */
document.addEventListener("click", function (e) {
  if (e.defaultPrevented || e.button !== 0) return;
  var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
  if (!a) return;
  var url = new URL(a.href, document.baseURI);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.host === location.host) return;
  e.preventDefault();
  window.open(url.href, "_blank");
});
</script>
""".trimIndent()

        /** Without scripts, every link asks for a new window, which the app turns into the browser. */
        private const val LINK_BASE = "<base target=\"_blank\">"
    }
}
