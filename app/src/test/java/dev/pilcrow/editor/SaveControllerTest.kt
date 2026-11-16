package dev.pilcrow.editor

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SaveControllerTest {
    @get:Rule val tmp = TemporaryFolder()
    private val uri = "content://drive/1"
    private val drive = FakeDocumentStore()
    private val clock = FakeScheduler()
    private val states = ArrayList<SaveState>()
    private val drafts: DraftStore by lazy { DraftStore(tmp.newFolder("drafts")) { clock.now } }
    private val pauses = ArrayList<Long>()
    private val controller: SaveController by lazy { SaveController(drive, drafts, clock, { pauses += it }) { states += it } }

    private fun open(content: String = "one\n", name: String = "Weekly review.md") {
        drive.put(uri, name, content.toByteArray())
        val doc = (TextCodec.decode(drive.bytes(uri)) as DecodeResult.Ok).doc
        controller.open(uri, name, drive.bytes(uri), drive.meta(uri), doc.eol, doc.bom)
        drive.reads = 0
        states.clear()
    }

    private fun text() = String(drive.bytes(uri))

    @Test fun `change is drafted at once and saved after two seconds`() {
        open()
        controller.onTextChanged("two\n")
        assertEquals("two\n", drafts.unsavedFor(uri)!!.second)
        assertEquals(0, drive.writes)
        clock.advance(1999)
        assertEquals(0, drive.writes)
        clock.advance(1)
        assertEquals(1, drive.writes)
        assertEquals("two\n", text())
        assertEquals(listOf(SaveState.SAVING, SaveState.SAVED), states)
        assertNull(drafts.unsavedFor(uri))
        assertFalse(controller.isDirty)
    }

    @Test fun `typing again restarts the two second timer`() {
        open()
        controller.onTextChanged("two\n")
        clock.advance(1500)
        controller.onTextChanged("three\n")
        clock.advance(1999)
        assertEquals(0, drive.writes)
        clock.advance(1)
        assertEquals("three\n", text())
        assertEquals(1, drive.writes)
    }

    @Test fun `flush saves at once and cancels the timer`() {
        open()
        controller.onTextChanged("two\n")
        controller.flush()
        assertEquals("two\n", text())
        clock.advance(5000)
        assertEquals(1, drive.writes)
    }

    @Test fun `saved bytes keep crlf and bom`() {
        val bom = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte())
        drive.put(uri, "A.md", bom + "a\r\nb\r\n".toByteArray())
        val doc = (TextCodec.decode(drive.bytes(uri)) as DecodeResult.Ok).doc
        controller.open(uri, "A.md", drive.bytes(uri), drive.meta(uri), doc.eol, doc.bom)
        controller.onTextChanged("a\nb\nc\n")
        controller.flush()
        assertArrayEquals(bom + "a\r\nb\r\nc\r\n".toByteArray(), drive.bytes(uri))
    }

    @Test fun `write then read-back mismatch keeps draft unsaved`() {
        open()
        drive.corruptWrites = true
        controller.onTextChanged("two\n")
        controller.flush()
        assertEquals(SaveState.FAILED, states.last())
        assertEquals("two\n", drafts.unsavedFor(uri)!!.second)
        assertTrue(controller.isDirty)
    }

    @Test fun `write throws keeps draft and reports failed`() {
        open()
        drive.failWrites = true
        controller.onTextChanged("two\n")
        controller.flush()
        assertEquals(SaveState.FAILED, states.last())
        assertNotNull(drafts.unsavedFor(uri))
        drive.failWrites = false
        controller.retry()
        assertEquals(SaveState.SAVED, states.last())
        assertEquals("two\n", text())
        assertNull(drafts.unsavedFor(uri))
    }

    @Test fun `retry after a write that emptied the file writes the full text again`() {
        open()
        drive.truncateThenThrow = true
        controller.onTextChanged("two\n")
        controller.flush()
        assertEquals(SaveState.FAILED, states.last())
        assertEquals("", text())
        drive.truncateThenThrow = false
        controller.retry()
        assertEquals("two\n", text())
        assertEquals(SaveState.SAVED, states.last())
        assertFalse("our own failed write must not look like another device", states.contains(SaveState.CONFLICT))
    }

    @Test fun `typing again after a failed write saves, it does not ask about a conflict`() {
        open()
        drive.truncateThenThrow = true
        controller.onTextChanged("two\n")
        controller.flush()
        drive.truncateThenThrow = false
        controller.onTextChanged("three\n")
        clock.advance(2000)
        assertEquals("three\n", text())
        assertFalse(states.contains(SaveState.CONFLICT))
    }

    @Test fun `a write that shows up a moment later counts as saved`() {
        open()
        drive.staleReadsAfterWrite = 1
        controller.onTextChanged("two\n")
        controller.flush()
        assertEquals(SaveState.SAVED, states.last())
        assertEquals(1, pauses.size)
        assertEquals(1, drive.writes)
    }

    @Test fun `a write that is still not visible fails, and the next try is not a conflict`() {
        open()
        drive.staleReadsAfterWrite = 2
        controller.onTextChanged("two\n")
        controller.flush()
        assertEquals(SaveState.FAILED, states.last())
        assertNotNull(drafts.unsavedFor(uri))
        drive.staleReadsAfterWrite = 0
        controller.retry()
        assertEquals(SaveState.SAVED, states.last())
        assertFalse(states.contains(SaveState.CONFLICT))
    }

    @Test fun `the draft remembers which version of the file it was typed on`() {
        open()
        controller.onTextChanged("two\n")
        assertEquals(hashOf("one\n".toByteArray()), drafts.unsavedFor(uri)!!.first.baseHash)
    }

    @Test fun `restoring a draft typed on this version saves it`() {
        open()
        controller.restore("mine\n", hashOf("one\n".toByteArray()))
        clock.advance(2000)
        assertEquals("mine\n", text())
        assertEquals(SaveState.SAVED, states.last())
    }

    @Test fun `restoring a draft typed on an older version asks instead of overwriting`() {
        open("changed on the laptop\n")
        controller.restore("mine\n", hashOf("one\n".toByteArray()))
        clock.advance(5000)
        assertEquals(SaveState.CONFLICT, states.last())
        assertEquals(0, drive.writes)
        assertEquals("changed on the laptop\n", text())
        assertEquals("mine\n", drafts.unsavedFor(uri)!!.second)
        assertEquals("mine\n", controller.currentText())
    }

    @Test fun `lost permission during a save is a failure, not a crash`() {
        open()
        controller.onTextChanged("two\n")
        drive.revoked = true
        controller.flush()
        assertEquals(SaveState.FAILED, states.last())
        assertNotNull(drafts.unsavedFor(uri))
    }

    @Test fun `newer version on drive stops the save`() {
        open()
        drive.externalChange(uri, "from the laptop\n".toByteArray(), 9_000)
        controller.onTextChanged("two\n")
        controller.flush()
        assertEquals(SaveState.CONFLICT, states.last())
        assertEquals(0, drive.writes)
        assertEquals("from the laptop\n", text())
    }

    @Test fun `changed metadata with identical content is not a conflict`() {
        open()
        drive.touch(uri, 9_000)
        controller.onTextChanged("two\n")
        controller.flush()
        assertEquals(SaveState.SAVED, states.last())
        assertEquals("two\n", text())
    }

    @Test fun `missing metadata falls back to comparing content`() {
        open()
        drive.hideMeta = true
        controller.onTextChanged("two\n")
        controller.flush()
        assertEquals(SaveState.SAVED, states.last())
        assertTrue("the file is read before it is written", drive.reads >= 2)
        drive.externalChange(uri, "from the laptop\n".toByteArray(), 9_000)
        controller.onTextChanged("three\n")
        controller.flush()
        assertEquals(SaveState.CONFLICT, states.last())
    }

    @Test fun `own write does not trigger a conflict on the next save`() {
        open()
        controller.onTextChanged("two\n")
        controller.flush()
        controller.onTextChanged("three\n")
        controller.flush()
        assertEquals(SaveState.SAVED, states.last())
        assertEquals("three\n", text())
        assertEquals(2, drive.writes)
    }

    @Test fun `keep mine overwrites and verifies`() {
        open()
        drive.externalChange(uri, "from the laptop\n".toByteArray(), 9_000)
        controller.onTextChanged("two\n")
        controller.flush()
        assertEquals(Resolution.Saved, controller.resolve(ConflictChoice.MINE))
        assertEquals("two\n", text())
        assertEquals(SaveState.SAVED, states.last())
    }

    @Test fun `load theirs keeps my text as an unsaved draft and returns the file`() {
        open()
        drive.externalChange(uri, "from the laptop\n".toByteArray(), 9_000)
        controller.onTextChanged("two\n")
        controller.flush()
        val result = controller.resolve(ConflictChoice.THEIRS) as Resolution.Reload
        assertEquals("from the laptop\n", String(result.bytes))
        assertEquals(9_000L, result.meta.lastModified)
        assertEquals("two\n", drafts.unsavedFor(uri)!!.second)
        assertEquals(0, drive.writes)
    }

    @Test fun `copy asks for a target named with phone suffix`() {
        open(name = "Weekly review.md")
        drive.externalChange(uri, "from the laptop\n".toByteArray(), 9_000)
        controller.onTextChanged("two\n")
        controller.flush()
        val result = controller.resolve(ConflictChoice.COPY) as Resolution.NeedsCopyTarget
        assertEquals("Weekly review (phone).md", result.suggestedName)
        assertEquals("two\n", String(result.bytes))
        assertEquals(SaveState.CONFLICT, states.last())
    }

    @Test fun `flush does nothing while in conflict`() {
        open()
        drive.externalChange(uri, "from the laptop\n".toByteArray(), 9_000)
        controller.onTextChanged("two\n")
        controller.flush()
        controller.flush()
        clock.advance(10_000)
        assertEquals(0, drive.writes)
        assertEquals(SaveState.CONFLICT, states.last())
    }

    @Test fun `text equal to the saved text is clean`() {
        open()
        controller.onTextChanged("two\n")
        controller.onTextChanged("one\n")
        assertFalse(controller.isDirty)
        clock.advance(5000)
        assertEquals(0, drive.writes)
        assertNull(drafts.unsavedFor(uri))
        assertEquals("one\n", controller.currentText())
    }
}
