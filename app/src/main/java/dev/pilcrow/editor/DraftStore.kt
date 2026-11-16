package dev.pilcrow.editor

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * @param baseHash [hashOf] the file the text was typed on. Lets a restore notice that the file changed since.
 * @param kept true for a draft that typing never overwrites: it stays until the user restores or deletes it.
 */
data class DraftInfo(
    val id: String,
    val uri: String,
    val name: String,
    val updatedAt: Long,
    val savedAt: Long?,
    val baseHash: String? = null,
    val kept: Boolean = false,
)

private fun sha256(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

/** First 16 hex characters of the SHA-256 of a URI: the id of its working draft and of its recents entry. */
fun idOf(uri: String): String = sha256(uri.toByteArray()).take(16)

/** A short fingerprint of file content. */
fun hashOf(bytes: ByteArray): String = sha256(bytes).take(32)

/**
 * Copies of the text on the phone itself, so that nothing typed is lost when Drive cannot be reached.
 *
 * Each file has one working draft, rewritten as the user types. A working draft can be set aside as a
 * kept draft; kept drafts are only ever removed by the user's own answer. Unsaved drafts are never pruned.
 */
class DraftStore(private val dir: File, private val now: () -> Long) {
    private val index = File(dir, "index.json")

    init {
        dir.mkdirs()
    }

    /** Writes the working draft of a file and marks it unsaved. */
    fun put(uri: String, name: String, text: String, baseHash: String? = null) {
        val id = idOf(uri)
        writeAtomically(File(dir, "$id.txt"), text)
        save(load().filter { it.id != id } + DraftInfo(id, uri, name, now(), null, baseHash))
    }

    /** Sets the unsaved working draft of a file aside, so that typing can no longer overwrite it. */
    fun keep(uri: String): DraftInfo? {
        val working = load().firstOrNull { it.id == idOf(uri) && it.savedAt == null } ?: return null
        val kept = working.copy(id = freshId(uri), kept = true)
        if (!File(dir, "${working.id}.txt").renameTo(File(dir, "${kept.id}.txt"))) return null
        save(load().filter { it.id != working.id } + kept)
        return kept
    }

    /** Stores text straight into a kept draft: used for text that has no open note to go to. */
    fun putKept(uri: String, name: String, text: String, baseHash: String?): DraftInfo {
        val kept = DraftInfo(freshId(uri), uri, name, now(), null, baseHash, kept = true)
        writeAtomically(File(dir, "${kept.id}.txt"), text)
        save(load() + kept)
        return kept
    }

    /** Marks the working draft of a file as saved. Kept drafts are not touched. */
    fun markSaved(uri: String) {
        val id = idOf(uri)
        save(load().map { if (it.id == id) it.copy(savedAt = now()) else it })
    }

    /** The newest unsaved draft of a file, working or kept. */
    fun unsavedFor(uri: String): Pair<DraftInfo, String>? {
        val info = load().filter { it.uri == uri && it.savedAt == null }.maxByOrNull { it.updatedAt } ?: return null
        return read(info.id)?.let { info to it }
    }

    fun find(id: String): DraftInfo? = load().firstOrNull { it.id == id }

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

    private fun freshId(uri: String): String {
        val taken = load().map { it.id }.toSet()
        var n = now()
        while ("${idOf(uri)}-$n" in taken) n++
        return "${idOf(uri)}-$n"
    }

    private fun load(): List<DraftInfo> =
        try {
            val array = JSONArray(index.readText())
            (0 until array.length()).map { i ->
                val o = array.getJSONObject(i)
                DraftInfo(
                    o.getString("id"), o.getString("uri"), o.getString("name"), o.getLong("updatedAt"),
                    if (o.isNull("savedAt")) null else o.getLong("savedAt"),
                    if (o.isNull("baseHash")) null else o.getString("baseHash"),
                    o.optBoolean("kept", false),
                )
            }
        } catch (e: Exception) {
            emptyList()
        }

    private fun save(drafts: List<DraftInfo>) {
        val array = JSONArray()
        drafts.forEach {
            array.put(
                JSONObject().put("id", it.id).put("uri", it.uri).put("name", it.name).put("updatedAt", it.updatedAt)
                    .put("savedAt", it.savedAt ?: JSONObject.NULL).put("baseHash", it.baseHash ?: JSONObject.NULL).put("kept", it.kept),
            )
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
