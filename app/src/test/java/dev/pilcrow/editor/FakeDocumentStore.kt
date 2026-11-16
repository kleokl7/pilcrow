package dev.pilcrow.editor

import java.io.IOException

/** An in-memory stand-in for Drive, with switches for the ways a real provider misbehaves. */
class FakeDocumentStore : DocumentStore {
    private class Entry(var bytes: ByteArray, var name: String, var lastModified: Long?) {
        var stale: ByteArray? = null
        var staleLeft = 0
    }

    private val files = HashMap<String, Entry>()
    var reads = 0
    var writes = 0
    var failWrites = false          // write throws IOException
    var corruptWrites = false       // write "succeeds" but stores something else
    var truncateThenThrow = false   // write empties the file, then throws: the worst a provider can do
    var staleReadsAfterWrite = 0    // that many reads after a write still return the old content
    var crash = false               // meta and read throw something that is neither IOException nor SecurityException
    var revoked = false             // every call throws NeedsPicker
    var hideMeta = false            // size and lastModified come back null
    var persistable = true          // the sender let the app keep access
    val lost = HashSet<String>()    // files whose access has ended, as after "Open with" once the app closed
    var clock = 1_000L
    val persisted = ArrayList<String>()
    val askedToPersist = ArrayList<String>()

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
        if (revoked || uri in lost) throw NeedsPicker()
        if (crash) throw IllegalStateException("provider fell over")
        return files[uri] ?: throw IOException("No such file: $uri")
    }

    override fun meta(uri: String): DocMeta = entry(uri).let {
        DocMeta(it.name, if (hideMeta) null else it.bytes.size.toLong(), if (hideMeta) null else it.lastModified, "text/markdown")
    }

    override fun read(uri: String): ByteArray {
        reads++
        val e = entry(uri)
        if (e.staleLeft > 0) {
            e.staleLeft--
            return e.stale!!.copyOf()
        }
        return e.bytes.copyOf()
    }

    override fun write(uri: String, bytes: ByteArray) {
        val e = entry(uri)
        if (failWrites) throw IOException("Drive refused the write")
        if (truncateThenThrow) {
            e.bytes = ByteArray(0)
            throw IOException("Drive failed in the middle of the write")
        }
        e.stale = e.bytes
        e.staleLeft = staleReadsAfterWrite
        writes++
        clock += 1_000
        e.bytes = if (corruptWrites) "something else".toByteArray() else bytes.copyOf()
        e.lastModified = clock
    }

    override fun persist(uri: String, canWrite: Boolean): Boolean {
        askedToPersist += uri
        if (persistable && uri !in persisted) persisted += uri
        return persistable
    }

    override fun hasAccess(uri: String): Boolean = !revoked && uri !in lost

    override fun providerLabel(uri: String): String = "Drive"
}
