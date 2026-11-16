package dev.pilcrow.editor

import org.json.JSONArray
import org.json.JSONObject

/**
 * Everything the app does, without Android: which note is open, what the web side is told,
 * what happens on open, close, conflict and back. No Android imports. All calls on one thread.
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
    private val settings: Settings,
    /** Waits that many milliseconds; passed on to the save logic. Real time on the phone, nothing in tests. */
    private val pause: (Long) -> Unit = {},
) {
    /** The things only Android can do. */
    interface Effects {
        fun launchPicker(initialUri: String?)
        fun launchCreate(suggestedName: String)
        fun openUrl(url: String)
        fun copyText(text: String)
        fun closeApp()
    }

    /** What the user chose once and expects to find again: Android's preferences on the phone. */
    interface Settings {
        /** "formatted" or "source". */
        var viewMode: String
        var lineNumbers: Boolean
    }

    private class Pending(val uri: String, val canWrite: Boolean, val fromPicker: Boolean)

    /** A document the web side has shown. `text` is the last text of it that reached the save logic. */
    private class Shown(val uri: String, val name: String, var text: String)

    private var webReady = false
    private var paused = false
    private var pending: Pending? = null
    private var openUriString: String? = null
    private var openName = ""
    private var openKind = "markdown"
    private var controller: SaveController? = null
    private var offeredDraftId: String? = null
    private var copyBytes: ByteArray? = null
    /** Said by the next web app once it is ready: why the note it would have shown was closed. */
    private var nextNotice: String? = null
    /** The recent entry whose file the user is looking for in the picker. The file they pick takes its place. */
    private var findingId: String? = null

    private var tokenCounter = 0
    private var currentToken: String? = null

    /** Documents that are no longer on screen. Their editor can still deliver a last change. */
    private val retired = LinkedHashMap<String, Shown>()

    fun onWebReady() {
        webReady = true
        drafts.prune()
        emit(JSONObject().put("type", "settings").put("viewMode", settings.viewMode).put("lineNumbers", settings.lineNumbers))
        val waiting = pending
        pending = null
        if (waiting != null) load(waiting.uri, waiting.canWrite, waiting.fromPicker) else emitHome()
        nextNotice?.let { notice(it) }
        nextNotice = null
    }

    /**
     * The web app is gone: its screen was stopped because a page hung it, or Android stopped it. The note is saved
     * and closed, and calls wait for the new web app, which is told why.
     */
    fun onRendererGone() {
        webReady = false
        if (controller != null) nextNotice = "The screen stopped working, so Pilcrow closed the note. Open it again to go on."
        controller?.flush()
        retire()
    }

    fun openPicker() {
        findingId = null
        effects.launchPicker(null)
    }

    /** The picker was closed without a file. */
    fun onPickCancelled() {
        findingId = null
    }

    fun createNote() {
        copyBytes = null
        findingId = null
        effects.launchCreate("Untitled.md")
    }

    /** A note chosen in the picker, or handed over by "Open with". */
    fun openUri(uri: String, canWrite: Boolean, fromPicker: Boolean) {
        if (!webReady) {
            pending = Pending(uri, canWrite, fromPicker)
            return
        }
        controller?.flush()
        load(uri, canWrite, fromPicker)
    }

    fun openRecent(id: String) {
        val recent = recents.find(id) ?: return emitHome()
        controller?.flush()
        load(recent.uri, canWrite = true, fromPicker = false, recentId = id)
    }

    /** The user will look for a note the app lost access to. The file they pick replaces its entry. */
    fun findAgain(id: String) {
        val recent = recents.find(id) ?: return emitHome()
        findingId = id
        effects.launchPicker(recent.uri)
    }

    /** Takes a note off the recents list. Its drafts stay where they are. */
    fun forgetRecent(id: String) {
        recents.remove(id)
        emitHome()
    }

    /** The user chose where to create a file: either a new empty note, or the copy of a conflicted one. */
    fun onCreated(uri: String) {
        val copy = copyBytes
        copyBytes = null
        if (copy != null) {
            val written = try {
                store.write(uri, copy)
                store.read(uri).contentEquals(copy)
            } catch (e: Exception) {
                false
            }
            if (!written) {
                notice("Could not save the copy. Your text is kept under Recent drafts.")
                return
            }
            // The text now lives in the copy; the old note keeps the other device's version.
            openUriString?.let { drafts.markSaved(it) }
            retire()
        } else {
            controller?.flush()
        }
        load(uri, canWrite = true, fromPicker = true)
    }

    fun onCreateCancelled() {
        copyBytes = null
    }

    /** `token` names the document the text was typed in. Text for a document that is gone never reaches the one on screen. */
    fun docChanged(token: String, text: String) {
        if (token == currentToken) {
            val current = controller ?: return
            current.onTextChanged(text)
            // In the background there may be no "two seconds later".
            if (paused) current.flush()
            return
        }
        val old = retired[token] ?: return
        if (old.text == text) return
        old.text = text
        drafts.putKept(old.uri, old.name, text, baseHash = null)
    }

    fun closeDocument() {
        controller?.flush()
        retire()
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
                    retire()
                    // Opens the other device's version; the user's own text comes back as a draft offer.
                    load(uri, canWrite = true, fromPicker = false)
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
        val id = offeredDraftId ?: return
        offeredDraftId = null
        val uri = openUriString ?: return
        val current = controller ?: return
        if (!restore) {
            drafts.discard(id)
            return
        }
        val info = drafts.find(id) ?: return
        val text = drafts.read(id) ?: return
        // A new document for the web side: the editor that showed the file is replaced, and its last
        // change, if one is still on its way, must not land on the restored text.
        retired[currentToken ?: ""] = Shown(uri, openName, current.currentText())
        emit(documentEvent(newToken(), openName, openKind, text, readOnly = false, notice = null, draftOfferAt = null))
        current.restore(text, info.baseHash)
        drafts.discard(id)
    }

    fun setViewMode(mode: String) {
        if (mode != "formatted" && mode != "source") return
        settings.viewMode = mode
    }

    fun setLineNumbers(on: Boolean) {
        settings.lineNumbers = on
    }

    fun requestDrafts() {
        val rows = JSONArray()
        drafts.list().forEach {
            rows.put(JSONObject().put("id", it.id).put("name", it.name).put("updatedAt", it.updatedAt).put("saved", it.savedAt != null))
        }
        emit(JSONObject().put("type", "drafts").put("drafts", rows))
    }

    fun readDraft(id: String) {
        val info = drafts.find(id) ?: return
        val text = drafts.read(id) ?: return
        emit(JSONObject().put("type", "draftText").put("id", id).put("name", info.name).put("text", text))
    }

    fun discardDraft(id: String) {
        if (id == offeredDraftId) offeredDraftId = null
        drafts.discard(id)
    }

    fun copyText(text: String) = effects.copyText(text)

    fun openUrl(url: String) {
        if (url.startsWith("https://") || url.startsWith("http://")) effects.openUrl(url)
    }

    fun exitApp() = effects.closeApp()

    /** The app is leaving the screen: get the text onto Drive now. */
    fun onPause() {
        paused = true
        controller?.flush()
    }

    fun onResume() {
        paused = false
    }

    fun onBackPressed() = emit(JSONObject().put("type", "back"))

    // ---------------------------------------------------------------------------------------------

    private fun newToken(): String = "t${++tokenCounter}".also { currentToken = it }

    /** Takes the open document off the stage, remembering it for a change that is still on its way. */
    private fun retire() {
        val token = currentToken
        val uri = openUriString
        val current = controller
        if (token != null && uri != null && current != null) {
            retired[token] = Shown(uri, openName, current.currentText())
            while (retired.size > MAX_RETIRED) retired.remove(retired.keys.first())
        }
        controller = null
        currentToken = null
        openUriString = null
        offeredDraftId = null
    }

    /** @param recentId set when the note was tapped in the recents list. */
    private fun load(uri: String, canWrite: Boolean, fromPicker: Boolean, recentId: String? = null) {
        // Only the picker's answer can be the note the user went looking for.
        val replaces = if (fromPicker) findingId.also { findingId = null } else null
        val meta: DocMeta
        val bytes: ByteArray
        try {
            meta = store.meta(uri)
            bytes = store.read(uri)
        } catch (e: NeedsPicker) {
            if (recentId != null) {
                // Usually a note that came with "Open with": access ended when the app closed. Explain before any picker.
                retire()
                emitHome()
                emit(JSONObject().put("type", "lost").put("id", recentId).put("name", recents.find(recentId)?.name ?: ""))
            } else {
                failOpen("Drive did not keep access to this note. Pick it again.")
            }
            return
        } catch (e: Exception) {
            // Providers are other apps' code: anything can come out of them, and none of it may end this app.
            failOpen("Could not open this note.")
            return
        }

        retire()
        // Asked every time, also for "Open with": some senders allow it. The list remembers whether it worked.
        val persisted = store.persist(uri, canWrite)
        if (replaces != null && replaces != idOf(uri)) recents.remove(replaces)
        recents.touch(uri, meta.name, store.providerLabel(uri), persisted, now())
        openUriString = uri
        openName = meta.name
        openKind = DocKind.of(meta.name, meta.mime)

        when (val decoded = TextCodec.decode(bytes)) {
            is DecodeResult.ReadOnly ->
                emit(documentEvent(newToken(), meta.name, openKind, decoded.text, readOnly = true, notice = decoded.reason, draftOfferAt = null))
            is DecodeResult.Ok -> {
                val doc = decoded.doc
                if (!canWrite) {
                    emit(documentEvent(newToken(), meta.name, openKind, doc.text, readOnly = true, notice = NO_WRITE, draftOfferAt = null))
                    return
                }
                val offer = draftToOffer(uri, doc.text)
                offeredDraftId = offer?.id
                // The document first, so that the web side has a screen for the save state that follows.
                emit(documentEvent(newToken(), meta.name, openKind, doc.text, readOnly = false, notice = null, draftOfferAt = offer?.updatedAt))
                controller = SaveController(store, drafts, scheduler, pause) { state ->
                    emit(JSONObject().put("type", "saveState").put("state", state.name.lowercase()))
                }.also { it.open(uri, meta.name, bytes, meta, doc.eol, doc.bom) }
                if (doc.mixedEol) notice("This note mixed two kinds of line endings. It will be saved with one.")
            }
        }
    }

    /**
     * The newest unsaved draft of this file, if it says something the file does not. It is set aside
     * first, so that typing in the note cannot overwrite it before the user has answered.
     */
    private fun draftToOffer(uri: String, fileText: String): DraftInfo? {
        val (info, text) = drafts.unsavedFor(uri) ?: return null
        if (text == fileText) {
            if (info.kept) drafts.discard(info.id) else drafts.markSaved(uri)
            return null
        }
        return if (info.kept) info else drafts.keep(uri) ?: info
    }

    private fun failOpen(message: String) {
        retire()
        emitHome()
        notice(message)
    }

    private fun emitHome() {
        val rows = JSONArray()
        recents.list().forEach { recent ->
            rows.put(
                JSONObject().put("id", recent.id).put("name", recent.name).put("place", recent.place)
                    .put("openedAt", recent.openedAt)
                    .put("unsavedAt", drafts.unsavedFor(recent.uri)?.first?.updatedAt ?: JSONObject.NULL)
                    .put("lost", !store.hasAccess(recent.uri)),
            )
        }
        emit(JSONObject().put("type", "home").put("recents", rows))
    }

    private fun documentEvent(token: String, name: String, kind: String, text: String, readOnly: Boolean, notice: String?, draftOfferAt: Long?): JSONObject =
        JSONObject().put("type", "document").put("token", token).put("name", name).put("kind", kind).put("text", text).put("readOnly", readOnly)
            .put("notice", notice ?: JSONObject.NULL).put("draftOfferAt", draftOfferAt ?: JSONObject.NULL)

    private fun notice(message: String) {
        emit(JSONObject().put("type", "notice").put("message", message))
    }

    private companion object {
        const val NO_WRITE = "This note opened without permission to save. Open it with Open from Drive to edit it."
        const val MAX_RETIRED = 8
    }
}
