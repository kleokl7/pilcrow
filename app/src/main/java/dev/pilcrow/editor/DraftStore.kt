package dev.pilcrow.editor

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

data class DraftInfo(val id: String, val uri: String, val name: String, val updatedAt: Long, val savedAt: Long?)

/** First 16 hex characters of the SHA-256 of a URI: the id of its draft and of its recents entry. */
fun idOf(uri: String): String =
    MessageDigest.getInstance("SHA-256").digest(uri.toByteArray()).joinToString("") { "%02x".format(it) }.take(16)

/**
 * Copies of the text on the phone itself, so that nothing typed is lost when Drive cannot be reached.
 * One draft per file. An unsaved draft is never deleted by the app on its own.
 */
class DraftStore(private val dir: File, private val now: () -> Long) {
    private val index = File(dir, "index.json")

    init {
        dir.mkdirs()
    }

    fun put(uri: String, name: String, text: String) {
        val id = idOf(uri)
        writeAtomically(File(dir, "$id.txt"), text)
        save(load().filter { it.id != id } + DraftInfo(id, uri, name, now(), null))
    }

    fun markSaved(uri: String) {
        val id = idOf(uri)
        save(load().map { if (it.id == id) it.copy(savedAt = now()) else it })
    }

    fun unsavedFor(uri: String): Pair<DraftInfo, String>? {
        val info = load().firstOrNull { it.id == idOf(uri) && it.savedAt == null } ?: return null
        return read(info.id)?.let { info to it }
    }

    fun list(): List<DraftInfo> = load().sortedByDescending { it.updatedAt }

    fun read(id: String): String? = File(dir, "$id.txt").takeIf { it.isFile }?.readText()

    fun discard(id: String) {
        File(dir, "$id.txt").delete()
        save(load().filter { it.id != id })
    }

    /** Deletes saved drafts older than seven days. */
    fun prune() {
        val limit = now() - KEEP_SAVED_MS
        load().filter { it.savedAt != null && it.savedAt < limit }.forEach { discard(it.id) }
    }

    private fun load(): List<DraftInfo> =
        try {
            val array = JSONArray(index.readText())
            (0 until array.length()).map { i ->
                val o = array.getJSONObject(i)
                DraftInfo(o.getString("id"), o.getString("uri"), o.getString("name"), o.getLong("updatedAt"),
                    if (o.isNull("savedAt")) null else o.getLong("savedAt"))
            }
        } catch (e: Exception) {
            emptyList()
        }

    private fun save(drafts: List<DraftInfo>) {
        val array = JSONArray()
        drafts.forEach {
            array.put(JSONObject().put("id", it.id).put("uri", it.uri).put("name", it.name)
                .put("updatedAt", it.updatedAt).put("savedAt", it.savedAt ?: JSONObject.NULL))
        }
        writeAtomically(index, array.toString())
    }

    private fun writeAtomically(target: File, text: String) {
        val tmp = File(target.parentFile, target.name + ".tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(target)) {
            target.writeText(text)
            tmp.delete()
        }
    }

    companion object {
        const val KEEP_SAVED_MS = 7L * 24 * 60 * 60 * 1000
    }
}
