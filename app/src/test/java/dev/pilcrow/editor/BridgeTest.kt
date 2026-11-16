package dev.pilcrow.editor

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class BridgeTest {
    @get:Rule val tmp = TemporaryFolder()
    private val emitted = ArrayList<JSONObject>()
    private val settings = object : Session.Settings {
        override var viewMode = "formatted"
        override var lineNumbers = false
    }
    private val fx = object : Session.Effects {
        val urls = ArrayList<String>()
        override fun launchPicker(initialUri: String?) {}
        override fun launchCreate(suggestedName: String) {}
        override fun openUrl(url: String) { urls += url }
        override fun copyText(text: String) {}
        override fun closeApp() {}
    }
    private val session: Session by lazy {
        Session(FakeDocumentStore(), DraftStore(tmp.newFolder("drafts")) { 0 }, RecentsStore(File(tmp.root, "recents.json")),
            FakeScheduler(), { 0 }, { emitted += it }, fx, settings) {}
    }
    private var posted = 0
    private val pages = ArrayList<Pair<String, String>>()
    private val bridge = Bridge(post = { call -> posted++; session.call() }, preparePage = { ref, html -> pages += ref to html })

    private fun message(call: String, vararg args: Any?) = JSONObject().put("call", call).put("args", JSONArray(args.toList())).toString()

    @Test fun `a call with its arguments reaches the session`() {
        assertTrue(bridge.receive(message("setViewMode", "source")))
        assertTrue(bridge.receive(message("setLineNumbers", true)))
        assertTrue(bridge.receive(message("openUrl", "https://example.com/")))
        assertEquals("source", settings.viewMode)
        assertTrue(settings.lineNumbers)
        assertEquals(listOf("https://example.com/"), fx.urls)
    }

    @Test fun `a call without arguments needs no args field`() {
        assertTrue(bridge.receive("""{"call":"ready"}"""))
        assertEquals("settings", emitted.first().getString("type"))
    }

    @Test fun `a page to show goes to the page server, not the session`() {
        assertTrue(bridge.receive(message("preparePage", "p1", "<p>hi</p>")))
        assertEquals(listOf("p1" to "<p>hi</p>"), pages)
        assertEquals(0, posted)
    }

    @Test fun `anything malformed is refused and nothing runs`() {
        assertFalse(bridge.receive("not json"))
        assertFalse(bridge.receive("[]"))
        assertFalse(bridge.receive("""{"args":[]}"""))
        assertFalse(bridge.receive(message("noSuchCall")))
        assertFalse(bridge.receive(message("openRecent")))
        assertFalse(bridge.receive(message("openRecent", 42)))
        assertFalse(bridge.receive(message("setLineNumbers", "yes")))
        assertFalse(bridge.receive(message("preparePage", "p1")))
        assertEquals(0, posted)
        assertTrue(pages.isEmpty())
    }

    @Test fun `every call of the web app's NativeApi is understood`() {
        val calls = mapOf(
            "ready" to listOf(), "openPicker" to listOf(), "createNote" to listOf(), "openRecent" to listOf("id"),
            "findAgain" to listOf("id"), "forgetRecent" to listOf("id"), "docChanged" to listOf("t1", "text"),
            "closeDocument" to listOf(), "retrySave" to listOf(), "resolveConflict" to listOf("mine"),
            "answerDraftOffer" to listOf(false), "setViewMode" to listOf("source"), "setLineNumbers" to listOf(false),
            "requestDrafts" to listOf(), "readDraft" to listOf("id"), "discardDraft" to listOf("id"),
            "copyText" to listOf("text"), "openUrl" to listOf("https://example.com/"), "exitApp" to listOf(),
            "preparePage" to listOf("p1", "<p></p>"),
        )
        for ((call, args) in calls) assertTrue(call, bridge.receive(message(call, *args.toTypedArray())))
    }
}
