package dev.pilcrow.editor

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class Recent(val id: String, val uri: String, val name: String, val place: String, val openedAt: Long, val persisted: Boolean)

/** The notes opened last, newest first. `persisted` says whether Android kept access to the file. */
class RecentsStore(private val file: File) {

    fun list(): List<Recent> =
        try {
            val array = JSONArray(file.readText())
            (0 until array.length()).map { i ->
                val o = array.getJSONObject(i)
                Recent(o.getString("id"), o.getString("uri"), o.getString("name"), o.optString("place", ""),
                    o.getLong("openedAt"), o.optBoolean("persisted", false))
            }.sortedByDescending { it.openedAt }.take(MAX)
        } catch (e: Exception) {
            emptyList()
        }

    fun touch(uri: String, name: String, place: String, persisted: Boolean, at: Long) {
        val id = idOf(uri)
        save(listOf(Recent(id, uri, name, place, at, persisted)) + list().filter { it.id != id })
    }

    fun remove(id: String) = save(list().filter { it.id != id })

    fun find(id: String): Recent? = list().firstOrNull { it.id == id }

    private fun save(recents: List<Recent>) {
        val array = JSONArray()
        recents.sortedByDescending { it.openedAt }.take(MAX).forEach {
            array.put(JSONObject().put("id", it.id).put("uri", it.uri).put("name", it.name).put("place", it.place)
                .put("openedAt", it.openedAt).put("persisted", it.persisted))
        }
        file.parentFile?.mkdirs()
        file.writeText(array.toString())
    }

    private companion object {
        const val MAX = 20
    }
}
