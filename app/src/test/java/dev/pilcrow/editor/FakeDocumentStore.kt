package dev.pilcrow.editor

import java.io.IOException

/** An in-memory stand-in for Drive, with switches for the ways a real provider misbehaves. */
class FakeDocumentStore : DocumentStore {
    private class Entry(var bytes: ByteArray, var name: String, var lastModified: Long?, var reportSize: Boolean = true)

    private val files = HashMap<String, Entry>()
    var reads = 0
    var writes = 0
    var failWrites = false          // write throws IOException
    var corruptWrites = false       // write "succeeds" but stores something else
    var revoked = false             // every call throws NeedsPicker
    var hideMeta = false            // size and lastModified come back null
    var persistable = true
    var clock = 1_000L
    val persisted = ArrayList<String>()

    fun put(uri: String, name: String, bytes: ByteArray, lastModified: Long? = clock) {
        files[uri] = Entry(bytes, name, lastModified)
    }

    /** Another device changed the file. */
    fun externalChange(uri: String, bytes: ByteArray, lastModified: Long) {
        files.getValue(uri).apply { this.bytes = bytes; this.lastModified = lastModified }
    }

    /** Only the timestamp moved; the content is the same. */
    fun touch(uri: String, lastModified: Long) {
        files.getValue(uri).lastModified = lastModified
    }

    fun bytes(uri: String): ByteArray = files.getValue(uri).bytes

    private fun entry(uri: String): Entry {
        if (revoked) throw NeedsPicker()
        return files[uri] ?: throw IOException("No such file: $uri")
    }

    override fun meta(uri: String): DocMeta = entry(uri).let {
        DocMeta(it.name, if (hideMeta) null else it.bytes.size.toLong(), if (hideMeta) null else it.lastModified, "text/markdown")
    }

    override fun read(uri: String): ByteArray {
        reads++
        return entry(uri).bytes.copyOf()
    }

    override fun write(uri: String, bytes: ByteArray) {
        val e = entry(uri)
        if (failWrites) throw IOException("Drive refused the write")
        writes++
        clock += 1_000
        e.bytes = if (corruptWrites) "something else".toByteArray() else bytes.copyOf()
        e.lastModified = clock
    }

    override fun persist(uri: String, canWrite: Boolean): Boolean {
        if (persistable) persisted += uri
        return persistable
    }

    override fun providerLabel(uri: String): String = "Drive"
}
