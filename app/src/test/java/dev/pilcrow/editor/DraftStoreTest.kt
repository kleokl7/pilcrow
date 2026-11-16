package dev.pilcrow.editor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class DraftStoreTest {
    @get:Rule val tmp = TemporaryFolder()
    private var now = 1_000_000L
    private val store: DraftStore by lazy { DraftStore(tmp.newFolder("drafts")) { now } }
    private val day = 24 * 60 * 60 * 1000L

    @Test fun putThenUnsavedForReturnsTheText() {
        store.put("content://a/1", "A.md", "hello")
        val (info, text) = store.unsavedFor("content://a/1")!!
        assertEquals("hello", text)
        assertEquals("A.md", info.name)
        assertEquals(now, info.updatedAt)
        assertNull(info.savedAt)
    }

    @Test fun markSavedHidesItFromUnsavedForButKeepsItListed() {
        store.put("content://a/1", "A.md", "hello")
        store.markSaved("content://a/1")
        assertNull(store.unsavedFor("content://a/1"))
        assertEquals(listOf("A.md"), store.list().map { it.name })
        assertEquals(now, store.list().single().savedAt)
        assertEquals("hello", store.read(store.list().single().id))
    }

    @Test fun `unsaved drafts are listed without knowing the uri`() {
        store.put("content://a/1", "A.md", "x")
        assertEquals(listOf("A.md"), store.list().filter { it.savedAt == null }.map { it.name })
    }

    @Test fun pruneDeletesSavedDraftsAfterSevenDaysAndKeepsUnsavedOnes() {
        store.put("content://a/saved", "Saved.md", "s")
        store.markSaved("content://a/saved")
        store.put("content://a/unsaved", "Unsaved.md", "u")
        now += 7 * day
        store.prune()
        assertEquals(2, store.list().size)
        now += 1
        store.prune()
        assertEquals(listOf("Unsaved.md"), store.list().map { it.name })
    }

    @Test fun putAfterMarkSavedMakesItUnsavedAgain() {
        store.put("content://a/1", "A.md", "one")
        store.markSaved("content://a/1")
        now += 5
        store.put("content://a/1", "A.md", "two")
        assertEquals("two", store.unsavedFor("content://a/1")!!.second)
        assertEquals(1, store.list().size)
    }

    @Test fun listIsNewestFirst() {
        store.put("content://a/1", "Old.md", "x")
        now += 10
        store.put("content://a/2", "New.md", "y")
        assertEquals(listOf("New.md", "Old.md"), store.list().map { it.name })
    }

    @Test fun discardRemovesTheDraft() {
        store.put("content://a/1", "A.md", "x")
        store.discard(store.list().single().id)
        assertTrue(store.list().isEmpty())
        assertNull(store.unsavedFor("content://a/1"))
    }

    @Test fun corruptIndexReadsAsEmpty() {
        val dir = tmp.newFolder("broken")
        File(dir, "index.json").writeText("{not json")
        val broken = DraftStore(dir) { now }
        assertTrue(broken.list().isEmpty())
        broken.put("content://a/1", "A.md", "x")
        assertNotNull(broken.unsavedFor("content://a/1"))
    }

    @Test fun `read without permission maps to NeedsPicker`() {
        val drive = FakeDocumentStore().apply { put("content://a/1", "A.md", "x".toByteArray()); revoked = true }
        assertThrows(NeedsPicker::class.java) { drive.read("content://a/1") }
        assertThrows(NeedsPicker::class.java) { drive.meta("content://a/1") }
        assertThrows(NeedsPicker::class.java) { drive.write("content://a/1", ByteArray(0)) }
    }
}
