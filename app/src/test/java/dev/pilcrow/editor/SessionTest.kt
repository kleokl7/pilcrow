package dev.pilcrow.editor

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class SessionTest {
    @get:Rule val tmp = TemporaryFolder()
    private val uri = "content://drive/1"
    private val drive = FakeDocumentStore()
    private val clock = FakeScheduler()
    private val emitted = ArrayList<JSONObject>()
    private val savedModes = ArrayList<String>()
    private val drafts: DraftStore by lazy { DraftStore(tmp.newFolder("drafts")) { clock.now + 50_000 } }
    private val recents: RecentsStore by lazy { RecentsStore(File(tmp.root, "recents.json")) }

    private val fx = object : Session.Effects {
        var pickerLaunchedWith: String? = "never"
        var created: String? = null
        val urls = ArrayList<String>()
        val copied = ArrayList<String>()
        var finished = false
        override fun launchPicker(initialUri: String?) { pickerLaunchedWith = initialUri }
        override fun launchCreate(suggestedName: String) { created = suggestedName }
        override fun openUrl(url: String) { urls += url }
        override fun copyText(text: String) { copied += text }
        override fun finish() { finished = true }
    }

    private val session: Session by lazy {
        Session(drive, drafts, recents, clock, { clock.now + 50_000 }, { emitted += it }, fx, "formatted") { savedModes += it }
    }

    private fun last(type: String): JSONObject = emitted.last { it.getString("type") == type }
    private fun types(): List<String> = emitted.map { it.getString("type") }
    private fun JSONObject.fieldNames(): Set<String> = keys().asSequence().toSet()

    private fun openNote(content: String = "one\n", canWrite: Boolean = true, fromPicker: Boolean = true) {
        drive.put(uri, "Weekly review.md", content.toByteArray())
        session.onWebReady()
        session.openUri(uri, canWrite, fromPicker)
    }

    @Test fun `web ready with nothing pending shows home with recents`() {
        recents.touch(uri, "Weekly review.md", "Drive", true, 10)
        drafts.put(uri, "Weekly review.md", "unsaved words")
        session.onWebReady()
        val home = last("home")
        assertEquals("formatted", home.getString("viewMode"))
        val row = home.getJSONArray("recents").getJSONObject(0)
        assertEquals("Weekly review.md", row.getString("name"))
        assertEquals("Drive", row.getString("place"))
        assertEquals(10L, row.getLong("openedAt"))
        assertEquals(50_000L, row.getLong("unsavedAt"))
        assertEquals(idOf(uri), row.getString("id"))
    }

    @Test fun `a note opened before the web app is ready waits for it`() {
        drive.put(uri, "Weekly review.md", "one\n".toByteArray())
        session.openUri(uri, canWrite = true, fromPicker = false)
        assertTrue(emitted.isEmpty())
        session.onWebReady()
        assertEquals("document", emitted.first().getString("type"))
        assertFalse(types().contains("home"))
    }

    @Test fun `opening a picked note emits the document and records a persisted recent`() {
        openNote()
        val doc = last("document")
        assertEquals("Weekly review.md", doc.getString("name"))
        assertEquals("one\n", doc.getString("text"))
        assertFalse(doc.getBoolean("readOnly"))
        assertEquals("saved", last("saveState").getString("state"))
        assertTrue(types().indexOf("document") < types().indexOf("saveState"))
        val recent = recents.list().single()
        assertTrue(recent.persisted)
        assertEquals("Drive", recent.place)
        assertEquals(listOf(uri), drive.persisted)
    }

    @Test fun `open with does not ask to persist`() {
        openNote(fromPicker = false)
        assertTrue(drive.persisted.isEmpty())
        assertFalse(recents.list().single().persisted)
        assertFalse(last("document").getBoolean("readOnly"))
    }

    @Test fun `open with without write permission is read-only with the notice`() {
        openNote(canWrite = false, fromPicker = false)
        val doc = last("document")
        assertTrue(doc.getBoolean("readOnly"))
        assertEquals("This note opened without permission to save. Open it with Open from Drive to edit it.", doc.getString("notice"))
        session.docChanged("typed anyway")
        clock.advance(5000)
        assertEquals(0, drive.writes)
    }

    @Test fun `a file that is not utf-8 is read-only with the codec reason`() {
        drive.put(uri, "Odd.md", byteArrayOf(0x61, 0xC3.toByte(), 0x28))
        session.onWebReady()
        session.openUri(uri, canWrite = true, fromPicker = true)
        assertTrue(last("document").getBoolean("readOnly"))
        assertEquals("This file is not UTF-8 text, so it opens read-only.", last("document").getString("notice"))
    }

    @Test fun `typing is saved to drive after two seconds`() {
        openNote()
        session.docChanged("two\n")
        clock.advance(2000)
        assertEquals("two\n", String(drive.bytes(uri)))
        assertEquals("saved", last("saveState").getString("state"))
    }

    @Test fun `unsaved draft that differs from the file is offered`() {
        drafts.put(uri, "Weekly review.md", "my unsaved words\n")
        openNote()
        assertEquals(50_000L, last("document").getLong("draftOfferAt"))
        assertEquals("one\n", last("document").getString("text"))
        emitted.clear()
        session.answerDraftOffer(true)
        assertEquals("my unsaved words\n", last("document").getString("text"))
        assertTrue(last("document").isNull("draftOfferAt"))
        clock.advance(2000)
        assertEquals("my unsaved words\n", String(drive.bytes(uri)))
    }

    @Test fun `a declined draft is discarded`() {
        drafts.put(uri, "Weekly review.md", "my unsaved words\n")
        openNote()
        session.answerDraftOffer(false)
        assertNull(drafts.unsavedFor(uri))
        assertEquals("one\n", String(drive.bytes(uri)))
    }

    @Test fun `a draft equal to the file is not offered`() {
        drafts.put(uri, "Weekly review.md", "one\n")
        openNote()
        assertTrue(last("document").isNull("draftOfferAt"))
    }

    @Test fun `mixed line endings produce the one-time notice`() {
        openNote("a\r\nb\r\nc\n")
        assertEquals("This note mixed two kinds of line endings. It will be saved with one.", last("notice").getString("message"))
    }

    @Test fun `openRecent falls back to picker`() {
        drive.put(uri, "Weekly review.md", "one\n".toByteArray())
        recents.touch(uri, "Weekly review.md", "Drive", false, 10)
        session.onWebReady()
        drive.revoked = true
        emitted.clear()
        session.openRecent(idOf(uri))
        assertEquals("home", emitted.first().getString("type"))
        assertEquals("Drive did not keep access to this note. Pick it again.", last("notice").getString("message"))
        assertEquals(uri, fx.pickerLaunchedWith)
        assertFalse(types().contains("document"))
    }

    @Test fun `open with after the permission is gone returns home without the picker`() {
        drive.put(uri, "Weekly review.md", "one\n".toByteArray())
        drive.revoked = true
        session.onWebReady()
        session.openUri(uri, canWrite = true, fromPicker = false)
        assertEquals("home", last("home").getString("type"))
        assertEquals("never", fx.pickerLaunchedWith)
        assertNotNull(last("notice"))
    }

    @Test fun `empty new note opens editable`() {
        session.onWebReady()
        session.createNote()
        assertEquals("Untitled.md", fx.created)
        drive.put("content://drive/new", "Untitled.md", ByteArray(0))
        session.onCreated("content://drive/new")
        val doc = last("document")
        assertEquals("", doc.getString("text"))
        assertFalse(doc.getBoolean("readOnly"))
        session.docChanged("first words")
        clock.advance(2000)
        assertEquals("first words", String(drive.bytes("content://drive/new")))
    }

    @Test fun `closing the document flushes the save and returns home`() {
        openNote()
        session.docChanged("two\n")
        session.closeDocument()
        assertEquals("two\n", String(drive.bytes(uri)))
        assertEquals("home", emitted.last().getString("type"))
        assertTrue(last("home").getJSONArray("recents").getJSONObject(0).isNull("unsavedAt"))
    }

    @Test fun `onPause flushes`() {
        openNote()
        session.docChanged("two\n")
        session.onPause()
        assertEquals("two\n", String(drive.bytes(uri)))
    }

    @Test fun `a conflict reaches the web and keep mine resolves it`() {
        openNote()
        drive.externalChange(uri, "from the laptop\n".toByteArray(), 9_000)
        session.docChanged("two\n")
        clock.advance(2000)
        assertEquals("conflict", last("saveState").getString("state"))
        session.resolveConflict("mine")
        assertEquals("two\n", String(drive.bytes(uri)))
        assertEquals("saved", last("saveState").getString("state"))
    }

    @Test fun `load theirs shows the other version and offers my text back`() {
        openNote()
        drive.externalChange(uri, "from the laptop\n".toByteArray(), 9_000)
        session.docChanged("two\n")
        clock.advance(2000)
        emitted.clear()
        session.resolveConflict("theirs")
        assertEquals("from the laptop\n", last("document").getString("text"))
        assertFalse(last("document").isNull("draftOfferAt"))
        assertEquals("saved", last("saveState").getString("state"))
        assertEquals("from the laptop\n", String(drive.bytes(uri)))
    }

    @Test fun `copy choice writes my text to the new file and opens it`() {
        openNote()
        drive.externalChange(uri, "from the laptop\n".toByteArray(), 9_000)
        session.docChanged("two\n")
        clock.advance(2000)
        session.resolveConflict("copy")
        assertEquals("Weekly review (phone).md", fx.created)
        drive.put("content://drive/copy", "Weekly review (phone).md", ByteArray(0))
        session.onCreated("content://drive/copy")
        assertEquals("two\n", String(drive.bytes("content://drive/copy")))
        assertEquals("from the laptop\n", String(drive.bytes(uri)))
        assertEquals("Weekly review (phone).md", last("document").getString("name"))
        assertEquals("two\n", last("document").getString("text"))
        assertNull(drafts.unsavedFor(uri))
    }

    @Test fun `a copy that cannot be written keeps the text as a draft`() {
        openNote()
        drive.externalChange(uri, "from the laptop\n".toByteArray(), 9_000)
        session.docChanged("two\n")
        clock.advance(2000)
        session.resolveConflict("copy")
        drive.put("content://drive/copy", "Weekly review (phone).md", ByteArray(0))
        drive.failWrites = true
        session.onCreated("content://drive/copy")
        assertEquals("Could not save the copy. Your text is kept under Recent drafts.", last("notice").getString("message"))
        assertEquals("two\n", drafts.unsavedFor(uri)!!.second)
    }

    @Test fun `only http and https urls are opened`() {
        session.onWebReady()
        session.openUrl("https://example.com/a")
        session.openUrl("http://example.com/b")
        session.openUrl("javascript:alert(1)")
        session.openUrl("content://x/y")
        session.openUrl("file:///etc/hosts")
        assertEquals(listOf("https://example.com/a", "http://example.com/b"), fx.urls)
    }

    @Test fun `drafts can be listed, read and discarded`() {
        session.onWebReady()
        drafts.put(uri, "Weekly review.md", "words")
        session.requestDrafts()
        val row = last("drafts").getJSONArray("drafts").getJSONObject(0)
        assertEquals("Weekly review.md", row.getString("name"))
        assertFalse(row.getBoolean("saved"))
        session.readDraft(row.getString("id"))
        assertEquals("words", last("draftText").getString("text"))
        session.discardDraft(row.getString("id"))
        assertTrue(drafts.list().isEmpty())
    }

    @Test fun `view mode is remembered and sent with home`() {
        session.onWebReady()
        session.setViewMode("source")
        assertEquals(listOf("source"), savedModes)
        session.closeDocument()
        assertEquals("source", last("home").getString("viewMode"))
        session.setViewMode("nonsense")
        assertEquals(listOf("source"), savedModes)
    }

    @Test fun `back, copy and exit go to the right place`() {
        session.onWebReady()
        session.onBackPressed()
        assertEquals("back", emitted.last().getString("type"))
        session.copyText("abc")
        assertEquals(listOf("abc"), fx.copied)
        session.exitApp()
        assertTrue(fx.finished)
    }

    @Test fun `event json uses the field names of the bridge contract`() {
        openNote()
        assertEquals(setOf("type", "name", "text", "readOnly", "notice", "draftOfferAt"), last("document").fieldNames())
        assertEquals(setOf("type", "recents", "viewMode"), last("home").fieldNames())
        assertEquals(setOf("id", "name", "place", "openedAt", "unsavedAt"), recents.list().let { session.closeDocument(); last("home").getJSONArray("recents").getJSONObject(0).fieldNames() })
        assertEquals(setOf("type", "state"), last("saveState").fieldNames())
    }
}
