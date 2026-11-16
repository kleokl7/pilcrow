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
    private val settings = object : Session.Settings {
        override var viewMode = "formatted"
        override var lineNumbers = false
    }
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
        override fun closeApp() { finished = true }
    }

    private val session: Session by lazy {
        Session(drive, drafts, recents, clock, { clock.now + 50_000 }, { emitted += it }, fx, settings) {}
    }

    private fun last(type: String): JSONObject = emitted.last { it.getString("type") == type }
    private fun types(): List<String> = emitted.map { it.getString("type") }
    private fun token(): String = last("document").getString("token")
    /** The web side reports the text of the document that is on screen. */
    private fun type(text: String) = session.docChanged(token(), text)
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
        assertEquals(listOf("settings", "document"), types().take(2))
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

    @Test fun `open with asks to keep access, and keeps it when the sender allows`() {
        openNote(fromPicker = false)
        assertEquals(listOf(uri), drive.persisted)
        assertTrue(recents.list().single().persisted)
        assertFalse(last("document").getBoolean("readOnly"))
    }

    @Test fun `open with from a sender that only lends the file records that access will end`() {
        drive.persistable = false
        openNote(fromPicker = false)
        assertEquals(listOf(uri), drive.askedToPersist)
        assertFalse(recents.list().single().persisted)
        assertFalse(last("document").getBoolean("readOnly"))
    }

    @Test fun `the document says what kind of file it is`() {
        openNote()
        assertEquals("markdown", last("document").getString("kind"))
        val page = "content://drive/page"
        drive.put(page, "Garden plan.html", "<p>hi</p>".toByteArray())
        session.openUri(page, canWrite = true, fromPicker = true)
        assertEquals("html", last("document").getString("kind"))
    }

    @Test fun `open with without write permission is read-only with the notice`() {
        openNote(canWrite = false, fromPicker = false)
        val doc = last("document")
        assertTrue(doc.getBoolean("readOnly"))
        assertEquals("This note opened without permission to save. Open it with Open from Drive to edit it.", doc.getString("notice"))
        type("typed anyway")
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
        type("two\n")
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

    /** A note in the recents list that the app can no longer reach, as after "Open with" once the app was closed. */
    private fun lostRecent() {
        drive.put(uri, "Weekly review.md", "one\n".toByteArray())
        recents.touch(uri, "Weekly review.md", "Drive", false, 10)
        drive.lost += uri
        session.onWebReady()
    }

    @Test fun `a recent note that lost access says so, and waits before opening the picker`() {
        lostRecent()
        emitted.clear()
        session.openRecent(idOf(uri))
        assertEquals(listOf("home", "lost"), types())
        assertEquals(idOf(uri), last("lost").getString("id"))
        assertEquals("Weekly review.md", last("lost").getString("name"))
        assertEquals("never", fx.pickerLaunchedWith)
    }

    @Test fun `finding a lost note again replaces its old entry`() {
        lostRecent()
        session.openRecent(idOf(uri))
        session.findAgain(idOf(uri))
        assertEquals(uri, fx.pickerLaunchedWith)
        val found = "content://drive/found"
        drive.put(found, "Weekly review.md", "one\n".toByteArray())
        session.openUri(found, canWrite = true, fromPicker = true)
        assertEquals("Weekly review.md", last("document").getString("name"))
        assertEquals(listOf(found), recents.list().map { it.uri })
        assertTrue(recents.list().single().persisted)
    }

    @Test fun `a lost note keeps its entry when the search is cancelled`() {
        lostRecent()
        session.findAgain(idOf(uri))
        session.onPickCancelled()
        val other = "content://drive/other"
        drive.put(other, "Other.md", "two\n".toByteArray())
        session.openUri(other, canWrite = true, fromPicker = true)
        assertEquals(setOf(uri, other), recents.list().map { it.uri }.toSet())
    }

    @Test fun `a lost note keeps its entry when the note picked instead does not open`() {
        lostRecent()
        session.findAgain(idOf(uri))
        session.openUri("content://drive/missing", canWrite = true, fromPicker = true)
        assertEquals(listOf(uri), recents.list().map { it.uri })
    }

    @Test fun `a lost note can be taken off the list`() {
        lostRecent()
        session.forgetRecent(idOf(uri))
        assertTrue(recents.list().isEmpty())
        assertEquals(0, last("home").getJSONArray("recents").length())
    }

    @Test fun `home marks the notes that can no longer be reached`() {
        val other = "content://drive/other"
        recents.touch(uri, "Weekly review.md", "Drive", true, 10)
        recents.touch(other, "Other.md", "Drive", false, 20)
        drive.lost += other
        session.onWebReady()
        val rows = last("home").getJSONArray("recents")
        assertEquals("Other.md", rows.getJSONObject(0).getString("name"))
        assertTrue(rows.getJSONObject(0).getBoolean("lost"))
        assertFalse(rows.getJSONObject(1).getBoolean("lost"))
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
        type("first words")
        clock.advance(2000)
        assertEquals("first words", String(drive.bytes("content://drive/new")))
    }

    @Test fun `closing the document flushes the save and returns home`() {
        openNote()
        type("two\n")
        session.closeDocument()
        assertEquals("two\n", String(drive.bytes(uri)))
        assertEquals("home", emitted.last().getString("type"))
        assertTrue(last("home").getJSONArray("recents").getJSONObject(0).isNull("unsavedAt"))
    }

    @Test fun `onPause flushes`() {
        openNote()
        type("two\n")
        session.onPause()
        assertEquals("two\n", String(drive.bytes(uri)))
    }

    @Test fun `a conflict reaches the web and keep mine resolves it`() {
        openNote()
        drive.externalChange(uri, "from the laptop\n".toByteArray(), 9_000)
        type("two\n")
        clock.advance(2000)
        assertEquals("conflict", last("saveState").getString("state"))
        session.resolveConflict("mine")
        assertEquals("two\n", String(drive.bytes(uri)))
        assertEquals("saved", last("saveState").getString("state"))
    }

    @Test fun `load theirs shows the other version and offers my text back`() {
        openNote()
        drive.externalChange(uri, "from the laptop\n".toByteArray(), 9_000)
        type("two\n")
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
        type("two\n")
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
        type("two\n")
        clock.advance(2000)
        session.resolveConflict("copy")
        drive.put("content://drive/copy", "Weekly review (phone).md", ByteArray(0))
        drive.failWrites = true
        session.onCreated("content://drive/copy")
        assertEquals("Could not save the copy. Your text is kept under Recent drafts.", last("notice").getString("message"))
        assertEquals("two\n", drafts.unsavedFor(uri)!!.second)
    }

    @Test fun `text that arrives after the note was closed is kept as a draft`() {
        openNote()
        val closed = token()
        type("two\n")
        session.closeDocument()
        session.docChanged(closed, "two and the last words\n")
        assertEquals("two\n", String(drive.bytes(uri)))
        assertEquals("two and the last words\n", drafts.unsavedFor(uri)!!.second)
        emitted.clear()
        session.openUri(uri, canWrite = true, fromPicker = false)
        assertFalse(last("document").isNull("draftOfferAt"))
    }

    @Test fun `text that arrives late and is already saved leaves no draft behind`() {
        openNote()
        val closed = token()
        type("two\n")
        session.closeDocument()
        session.docChanged(closed, "two\n")
        assertNull(drafts.unsavedFor(uri))
    }

    @Test fun `a late change from the previous note never reaches the current note`() {
        val other = "content://drive/2"
        drive.put(other, "B.md", "note B\n".toByteArray())
        openNote("note A\n")
        val a = token()
        session.openUri(other, canWrite = true, fromPicker = false)
        session.docChanged(a, "note A plus the last words\n")
        clock.advance(5000)
        assertEquals("note B\n", String(drive.bytes(other)))
        assertEquals("note A plus the last words\n", drafts.unsavedFor(uri)!!.second)
        assertNull(drafts.unsavedFor(other))
    }

    @Test fun `every document event has a new token`() {
        openNote()
        val first = token()
        session.closeDocument()
        session.openUri(uri, canWrite = true, fromPicker = false)
        assertFalse(first == token())
    }

    @Test fun `typing before answering the offer does not destroy the offered draft`() {
        drafts.put(uri, "Weekly review.md", "yesterday's unsaved words\n")
        openNote()
        type("one, with a typo fixed\n")
        clock.advance(2000)
        assertEquals("one, with a typo fixed\n", String(drive.bytes(uri)))
        assertEquals("yesterday's unsaved words\n", drafts.unsavedFor(uri)!!.second)
        session.closeDocument()
        assertFalse(last("home").getJSONArray("recents").getJSONObject(0).isNull("unsavedAt"))
        emitted.clear()
        session.openUri(uri, canWrite = true, fromPicker = false)
        assertFalse("the offer comes back until it is answered", last("document").isNull("draftOfferAt"))
        session.answerDraftOffer(true)
        assertEquals("yesterday's unsaved words\n", last("document").getString("text"))
    }

    @Test fun `my text survives typing after load theirs`() {
        openNote()
        drive.externalChange(uri, "from the laptop\n".toByteArray(), 9_000)
        type("my words\n")
        clock.advance(2000)
        session.resolveConflict("theirs")
        type("from the laptop!\n")
        clock.advance(2000)
        assertEquals("from the laptop!\n", String(drive.bytes(uri)))
        assertEquals("my words\n", drafts.unsavedFor(uri)!!.second)
    }

    @Test fun `restoring a draft over a file changed elsewhere raises the conflict question`() {
        openNote()
        type("typed offline\n")
        drive.failWrites = true
        clock.advance(2000)
        session.closeDocument()
        drive.failWrites = false
        drive.externalChange(uri, "edited on the laptop\n".toByteArray(), 9_000)
        emitted.clear()
        session.openUri(uri, canWrite = true, fromPicker = false)
        assertEquals("edited on the laptop\n", last("document").getString("text"))
        session.answerDraftOffer(true)
        clock.advance(5000)
        assertEquals("typed offline\n", last("document").getString("text"))
        assertEquals("conflict", last("saveState").getString("state"))
        assertEquals("edited on the laptop\n", String(drive.bytes(uri)))
    }

    @Test fun `a change that arrives while the app is in the background is saved at once`() {
        openNote()
        session.onPause()
        type("typed just before leaving\n")
        assertEquals("typed just before leaving\n", String(drive.bytes(uri)))
        session.onResume()
        type("back again\n")
        assertEquals("typed just before leaving\n", String(drive.bytes(uri)))
        clock.advance(2000)
        assertEquals("back again\n", String(drive.bytes(uri)))
    }

    @Test fun `a provider that throws something unexpected does not crash the open`() {
        drive.put(uri, "Weekly review.md", "one\n".toByteArray())
        session.onWebReady()
        drive.crash = true
        session.openUri(uri, canWrite = true, fromPicker = true)
        assertEquals("Could not open this note.", last("notice").getString("message"))
        assertEquals("home", last("home").getString("type"))
    }

    @Test fun `a copy that does not read back is not trusted`() {
        openNote()
        drive.externalChange(uri, "from the laptop\n".toByteArray(), 9_000)
        type("two\n")
        clock.advance(2000)
        session.resolveConflict("copy")
        drive.put("content://drive/copy", "Weekly review (phone).md", ByteArray(0))
        drive.corruptWrites = true
        session.onCreated("content://drive/copy")
        assertEquals("Could not save the copy. Your text is kept under Recent drafts.", last("notice").getString("message"))
        assertEquals("two\n", drafts.unsavedFor(uri)!!.second)
        assertEquals("Weekly review.md", last("document").getString("name"))
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

    @Test fun `when the screen stops, the note is saved and closed, and the next screen says why`() {
        openNote()
        type("one more\n")
        session.onRendererGone()
        assertEquals("one more\n", String(drive.bytes(uri)))
        emitted.clear()
        drive.put("content://drive/2", "Other.md", "x".toByteArray())
        session.openUri("content://drive/2", canWrite = true, fromPicker = false)
        assertTrue("waits for the new screen", emitted.isEmpty())
        session.onWebReady()
        assertEquals(listOf("settings", "document"), types().take(2))
        assertEquals("notice", types().last())
        assertEquals("The screen stopped working, so Pilcrow closed the note. Open it again to go on.", last("notice").getString("message"))
        session.closeDocument()
        session.onWebReady()
        assertEquals(1, types().count { it == "notice" })
    }

    @Test fun `settings are sent first when the web app is ready`() {
        settings.viewMode = "source"
        settings.lineNumbers = true
        session.onWebReady()
        val first = emitted.first()
        assertEquals("settings", first.getString("type"))
        assertEquals("source", first.getString("viewMode"))
        assertTrue(first.getBoolean("lineNumbers"))
    }

    @Test fun `view mode is remembered`() {
        session.onWebReady()
        session.setViewMode("source")
        assertEquals("source", settings.viewMode)
        session.setViewMode("nonsense")
        assertEquals("source", settings.viewMode)
    }

    @Test fun `line numbers are remembered`() {
        session.onWebReady()
        session.setLineNumbers(true)
        assertTrue(settings.lineNumbers)
        session.setLineNumbers(false)
        assertFalse(settings.lineNumbers)
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
        assertEquals(setOf("type", "token", "name", "kind", "text", "readOnly", "notice", "draftOfferAt"), last("document").fieldNames())
        assertEquals(setOf("type", "viewMode", "lineNumbers"), last("settings").fieldNames())
        assertEquals(setOf("type", "state"), last("saveState").fieldNames())
        session.closeDocument()
        assertEquals(setOf("type", "recents"), last("home").fieldNames())
        assertEquals(setOf("id", "name", "place", "openedAt", "unsavedAt", "lost"), last("home").getJSONArray("recents").getJSONObject(0).fieldNames())
        drive.lost += uri
        session.openRecent(idOf(uri))
        assertEquals(setOf("type", "id", "name"), last("lost").fieldNames())
    }
}
