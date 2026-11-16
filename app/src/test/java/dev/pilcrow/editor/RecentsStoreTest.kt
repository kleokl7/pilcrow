package dev.pilcrow.editor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class RecentsStoreTest {
    @get:Rule val tmp = TemporaryFolder()
    private val store: RecentsStore by lazy { RecentsStore(File(tmp.root, "recents.json")) }

    @Test fun touchMovesAnEntryToTheTopWithoutDuplicating() {
        store.touch("content://a/1", "One.md", "Drive", true, 100)
        store.touch("content://a/2", "Two.md", "Drive", false, 200)
        store.touch("content://a/1", "One renamed.md", "Drive", true, 300)
        assertEquals(listOf("One renamed.md", "Two.md"), store.list().map { it.name })
        assertEquals(300, store.list().first().openedAt)
    }

    @Test fun listIsCappedAtTwenty() {
        for (i in 1..25) store.touch("content://a/$i", "$i.md", "Drive", true, i.toLong())
        assertEquals(20, store.list().size)
        assertEquals("25.md", store.list().first().name)
        assertEquals("6.md", store.list().last().name)
    }

    @Test fun findAndRemoveWorkById() {
        store.touch("content://a/1", "One.md", "Drive", true, 100)
        val id = store.list().single().id
        assertEquals("content://a/1", store.find(id)!!.uri)
        assertTrue(store.find(id)!!.persisted)
        store.remove(id)
        assertNull(store.find(id))
    }

    @Test fun entriesSurviveANewInstance() {
        store.touch("content://a/1", "One.md", "Drive", false, 100)
        val again = RecentsStore(File(tmp.root, "recents.json"))
        assertEquals("One.md", again.list().single().name)
        assertEquals("Drive", again.list().single().place)
    }

    @Test fun corruptFileReadsAsEmpty() {
        File(tmp.root, "recents.json").writeText("[[[")
        assertTrue(store.list().isEmpty())
        store.touch("content://a/1", "One.md", "Drive", true, 100)
        assertEquals(1, store.list().size)
    }
}
