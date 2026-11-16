package dev.pilcrow.editor

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Calls from the web app, one JSON message each: {"call": "openRecent", "args": ["id"]}. One call per NativeApi
 * method in editor/src/bridge.ts. MainActivity hands over only messages from the app's own page; anything malformed
 * that still arrives is refused, so no message can run a call with arguments of the wrong kind.
 *
 * @param post runs a session call on the session's thread.
 * @param preparePage an HTML page to show, with the reference the web app will recognise it by.
 */
class Bridge(
    private val post: (Session.() -> Unit) -> Unit,
    private val preparePage: (ref: String, html: String) -> Unit,
) {
    /** True when the message was understood and handed on. */
    fun receive(message: String): Boolean {
        val call: String
        val args: JSONArray
        try {
            val json = JSONObject(message)
            call = json.getString("call")
            args = json.optJSONArray("args") ?: JSONArray()
        } catch (e: JSONException) {
            return false
        }
        val action = route(call, Args(args)) ?: return false
        action()
        return true
    }

    private class Args(private val array: JSONArray) {
        fun text(i: Int): String = array.opt(i) as? String ?: throw BadArgs()
        fun flag(i: Int): Boolean = array.opt(i) as? Boolean ?: throw BadArgs()
    }

    private class BadArgs : Exception()

    /** What a call does, or null for a call that does not exist or has the wrong arguments. */
    private fun route(call: String, a: Args): (() -> Unit)? = try {
        when (call) {
            "ready" -> session { onWebReady() }
            "openPicker" -> session { openPicker() }
            "createNote" -> session { createNote() }
            "openRecent" -> a.text(0).let { id -> session { openRecent(id) } }
            "findAgain" -> a.text(0).let { id -> session { findAgain(id) } }
            "forgetRecent" -> a.text(0).let { id -> session { forgetRecent(id) } }
            "docChanged" -> (a.text(0) to a.text(1)).let { (token, text) -> session { docChanged(token, text) } }
            "closeDocument" -> session { closeDocument() }
            "retrySave" -> session { retrySave() }
            "resolveConflict" -> a.text(0).let { choice -> session { resolveConflict(choice) } }
            "answerDraftOffer" -> a.flag(0).let { restore -> session { answerDraftOffer(restore) } }
            "setViewMode" -> a.text(0).let { mode -> session { setViewMode(mode) } }
            "setLineNumbers" -> a.flag(0).let { on -> session { setLineNumbers(on) } }
            "requestDrafts" -> session { requestDrafts() }
            "readDraft" -> a.text(0).let { id -> session { readDraft(id) } }
            "discardDraft" -> a.text(0).let { id -> session { discardDraft(id) } }
            "copyText" -> a.text(0).let { text -> session { copyText(text) } }
            "openUrl" -> a.text(0).let { url -> session { openUrl(url) } }
            "exitApp" -> session { exitApp() }
            "preparePage" -> (a.text(0) to a.text(1)).let { (ref, html) -> { preparePage(ref, html) } }
            else -> null
        }
    } catch (e: BadArgs) {
        null
    }

    private fun session(call: Session.() -> Unit): () -> Unit = { post(call) }
}
