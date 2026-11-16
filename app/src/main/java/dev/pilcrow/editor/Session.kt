package dev.pilcrow.editor

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

/**
 * Everything the app does, without Android: which note is open, what the web side is told,
 * what happens on open, close, conflict and back. No Android imports. All calls on the main thread.
 *
 * The JSON it emits and the calls it receives are the bridge contract in editor/src/bridge.ts.
 */
class Session(
    private val store: DocumentStore,
    private val drafts: DraftStore,
    private val recents: RecentsStore,
    private val scheduler: Scheduler,
    private val now: () -> Long,
    private val emit: (JSONObject) -> Unit,
    private val effects: Effects,
    private var viewMode: String,
    private val onViewMode: (String) -> Unit,
) {
    /** The things only Android can do. */
    interface Effects {
        fun launchPicker(initialUri: String?)
        fun launchCreate(suggestedName: String)
        fun openUrl(url: String)
        fun copyText(text: String)
        fun finish()
    }

    private class Pending(val uri: String, val canWrite: Boolean, val fromPicker: Boolean)

    private var webReady = false
    private var pending: Pending? = null
    private var openUriString: String? = null
    private var controller: SaveController? = null
    private var offeredDraft: String? = null
    private var copyBytes: ByteArray? = null

    fun onWebReady() {
        webReady = true
        drafts.prune()
        val waiting = pending
        pending = null
        if (waiting != null) load(waiting.uri, waiting.canWrite, waiting.fromPicker, pickerFallback = false) else emitHome()
    }

    fun openPicker() = effects.launchPicker(null)

    fun createNote() {
        copyBytes = null
        effects.launchCreate("Untitled.md")
    }

    /** A note chosen in the picker, or handed over by "Open with". */
    fun openUri(uri: String, canWrite: Boolean, fromPicker: Boolean) {
        if (!webReady) {
            pending = Pending(uri, canWrite, fromPicker)
            return
        }
        controller?.flush()
        load(uri, canWrite, fromPicker, pickerFallback = false)
    }

    fun openRecent(id: String) {
        val recent = recents.find(id) ?: return emitHome()
        controller?.flush()
        load(recent.uri, canWrite = true, fromPicker = false, pickerFallback = true)
    }

    /** The user chose where to create a file: either a new empty note, or the copy of a conflicted one. */
    fun onCreated(uri: String) {
        val copy = copyBytes
        copyBytes = null
        if (copy != null) {
            try {
                store.write(uri, copy)
            } catch (e: Exception) {
                notice("Could not save the copy. Your text is kept under Recent drafts.")
                return
            }
            // The text now lives in the copy; the old note keeps the other device's version.
            openUriString?.let { drafts.markSaved(it) }
            controller = null
        } else {
            controller?.flush()
        }
        load(uri, canWrite = true, fromPicker = true, pickerFallback = false)
    }

    fun onCreateCancelled() {
        copyBytes = null
    }

    fun docChanged(text: String) {
        controller?.onTextChanged(text)
    }

    fun closeDocument() {
        controller?.flush()
        controller = null
        openUriString = null
        offeredDraft = null
        emitHome()
    }

    fun retrySave() {
        controller?.retry()
    }

    fun resolveConflict(choice: String) {
        val current = controller ?: return
        val uri = openUriString ?: return
        try {
            when (choice) {
                "mine" -> current.resolve(ConflictChoice.MINE)
                "theirs" -> {
                    current.resolve(ConflictChoice.THEIRS)
                    controller = null
                    // Opens the other device's version; the user's own text comes back as a draft offer.
                    load(uri, canWrite = true, fromPicker = false, pickerFallback = false)
                }
                "copy" -> {
                    val target = current.resolve(ConflictChoice.COPY) as Resolution.NeedsCopyTarget
                    copyBytes = target.bytes
                    effects.launchCreate(target.suggestedName)
                }
            }
        } catch (e: Exception) {
            notice("Could not open the other version. Your text is kept under Recent drafts.")
        }
    }

    fun answerDraftOffer(restore: Boolean) {
        val uri = openUriString ?: return
        val text = offeredDraft
        offeredDraft = null
        if (text == null) return
        if (!restore) {
            drafts.discard(idOf(uri))
            return
        }
        emit(documentEvent(lastName, text, readOnly = false, notice = null, draftOfferAt = null))
        controller?.onTextChanged(text)
    }

    fun setViewMode(mode: String) {
        if (mode != "formatted" && mode != "source") return
        viewMode = mode
        onViewMode(mode)
    }

    fun requestDrafts() {
        val rows = JSONArray()
        drafts.list().forEach {
            rows.put(JSONObject().put("id", it.id).put("name", it.name).put("updatedAt", it.updatedAt).put("saved", it.savedAt != null))
        }
        emit(JSONObject().put("type", "drafts").put("drafts", rows))
    }

    fun readDraft(id: String) {
        val info = drafts.list().firstOrNull { it.id == id } ?: return
        val text = drafts.read(id) ?: return
        emit(JSONObject().put("type", "draftText").put("id", id).put("name", info.name).put("text", text))
    }

    fun discardDraft(id: String) = drafts.discard(id)

    fun copyText(text: String) = effects.copyText(text)

    fun openUrl(url: String) {
        if (url.startsWith("https://") || url.startsWith("http://")) effects.openUrl(url)
    }

    fun exitApp() = effects.finish()

    /** The app is leaving the screen: get the text onto Drive now. */
    fun onPause() {
        controller?.flush()
    }

    fun onBackPressed() = emit(JSONObject().put("type", "back"))

    // ---------------------------------------------------------------------------------------------

    private var lastName = ""

    private fun load(uri: String, canWrite: Boolean, fromPicker: Boolean, pickerFallback: Boolean) {
        val meta: DocMeta
        val bytes: ByteArray
        try {
            meta = store.meta(uri)
            bytes = store.read(uri)
        } catch (e: NeedsPicker) {
            failOpen("Drive did not keep access to this note. Pick it again.")
            if (pickerFallback) effects.launchPicker(uri)
            return
        } catch (e: IOException) {
            failOpen("Could not open this note.")
            return
        }

        val persisted = if (fromPicker) store.persist(uri, canWrite) else recents.find(idOf(uri))?.persisted ?: false
        recents.touch(uri, meta.name, store.providerLabel(uri), persisted, now())
        openUriString = uri
        lastName = meta.name
        offeredDraft = null
        controller = null

        when (val decoded = TextCodec.decode(bytes)) {
            is DecodeResult.ReadOnly -> emit(documentEvent(meta.name, decoded.text, readOnly = true, notice = decoded.reason, draftOfferAt = null))
            is DecodeResult.Ok -> {
                val doc = decoded.doc
                if (!canWrite) {
                    emit(documentEvent(meta.name, doc.text, readOnly = true, notice = NO_WRITE, draftOfferAt = null))
                    return
                }
                val draft = drafts.unsavedFor(uri)?.takeIf { it.second != doc.text }
                offeredDraft = draft?.second
                // The document first, so that the web side has a screen for the save state that follows.
                emit(documentEvent(meta.name, doc.text, readOnly = false, notice = null, draftOfferAt = draft?.first?.updatedAt))
                controller = SaveController(store, drafts, scheduler) { state ->
                    emit(JSONObject().put("type", "saveState").put("state", state.name.lowercase()))
                }.also { it.open(uri, meta.name, bytes, meta, doc.eol, doc.bom) }
                if (doc.mixedEol) notice("This note mixed two kinds of line endings. It will be saved with one.")
            }
        }
    }

    private fun failOpen(message: String) {
        controller = null
        openUriString = null
        emitHome()
        notice(message)
    }

    private fun emitHome() {
        val rows = JSONArray()
        recents.list().forEach { recent ->
            rows.put(
                JSONObject().put("id", recent.id).put("name", recent.name).put("place", recent.place)
                    .put("openedAt", recent.openedAt)
                    .put("unsavedAt", drafts.unsavedFor(recent.uri)?.first?.updatedAt ?: JSONObject.NULL),
            )
        }
        emit(JSONObject().put("type", "home").put("recents", rows).put("viewMode", viewMode))
    }

    private fun documentEvent(name: String, text: String, readOnly: Boolean, notice: String?, draftOfferAt: Long?): JSONObject =
        JSONObject().put("type", "document").put("name", name).put("text", text).put("readOnly", readOnly)
            .put("notice", notice ?: JSONObject.NULL).put("draftOfferAt", draftOfferAt ?: JSONObject.NULL)

    private fun notice(message: String) {
        emit(JSONObject().put("type", "notice").put("message", message))
    }

    private companion object {
        const val NO_WRITE = "This note opened without permission to save. Open it with Open from Drive to edit it."
    }
}
