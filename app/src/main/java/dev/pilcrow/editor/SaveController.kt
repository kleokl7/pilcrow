package dev.pilcrow.editor

enum class SaveState { SAVED, SAVING, FAILED, CONFLICT }

enum class ConflictChoice { MINE, THEIRS, COPY }

interface Scheduler {
    fun schedule(delayMs: Long, block: () -> Unit): Cancellable

    fun interface Cancellable {
        fun cancel()
    }
}

sealed interface Resolution {
    /** "Keep mine": the save was tried; the state callback says how it went. */
    object Saved : Resolution

    /** "Load theirs": show this file; the user's own text is kept as an unsaved draft. */
    class Reload(val bytes: ByteArray, val meta: DocMeta) : Resolution

    /** "Save mine as a copy": the caller asks the user where, then writes these bytes there. */
    class NeedsCopyTarget(val suggestedName: String, val bytes: ByteArray) : Resolution
}

/**
 * Owns the latest text of the open note and gets it onto Drive.
 *
 * Every change goes to a local draft at once and to Drive two seconds after typing stops.
 * A save counts only when the file reads back equal to what was written. Before each write the
 * file is checked for a change made elsewhere; if there is one, nothing is written and the user decides.
 *
 * No Android imports. All calls on one thread.
 */
class SaveController(
    private val store: DocumentStore,
    private val drafts: DraftStore,
    private val scheduler: Scheduler,
    /** Waits that many milliseconds. Real time on the phone, nothing in tests. */
    private val pause: (Long) -> Unit = {},
    private val onState: (SaveState) -> Unit,
) {
    private var uri = ""
    private var name = ""
    private var eol = Eol.LF
    private var bom = false
    private var knownBytes = ByteArray(0)
    private var knownMeta = DocMeta("", null, null, null)
    private var savedText = ""
    private var text = ""
    private var pending: Scheduler.Cancellable? = null

    /** What this controller last tried to write. The file may hold it even when the save was reported as failed. */
    private var attempted: ByteArray? = null

    /** True after a write of our own failed or did not read back: the file may now hold part of it. */
    private var ownWriteInDoubt = false
    private var state = SaveState.SAVED

    val isDirty: Boolean get() = text != savedText

    fun currentText(): String = text

    fun open(uri: String, name: String, bytes: ByteArray, meta: DocMeta, eol: Eol, bom: Boolean) {
        cancelPending()
        this.uri = uri
        this.name = name
        this.eol = eol
        this.bom = bom
        knownBytes = bytes
        knownMeta = meta
        savedText = (TextCodec.decode(bytes) as? DecodeResult.Ok)?.doc?.text ?: ""
        text = savedText
        attempted = null
        ownWriteInDoubt = false
        emit(SaveState.SAVED)
    }

    fun onTextChanged(newText: String) {
        text = newText
        cancelPending()
        drafts.put(uri, name, newText, hashOf(knownBytes))
        if (!isDirty) {
            // Back to what is on Drive (an undo, for example): there is nothing to restore later.
            drafts.markSaved(uri)
            return
        }
        pending = scheduler.schedule(AUTOSAVE_MS) { save(guard = true) }
    }

    /**
     * Puts back text from a draft. `baseHash` is the fingerprint of the file the draft was typed on:
     * if the file is a different version now, nothing is written and the user is asked.
     */
    fun restore(draftText: String, baseHash: String?) {
        cancelPending()
        text = draftText
        drafts.put(uri, name, draftText, baseHash ?: hashOf(knownBytes))
        if (baseHash != null && baseHash != hashOf(knownBytes)) {
            emit(SaveState.CONFLICT)
            return
        }
        if (isDirty) pending = scheduler.schedule(AUTOSAVE_MS) { save(guard = true) }
    }

    /** Save now. Used when the app goes to the background or the note is closed. */
    fun flush() {
        cancelPending()
        if (state != SaveState.CONFLICT) save(guard = true)
    }

    fun retry() {
        if (state == SaveState.FAILED) save(guard = true)
    }

    fun resolve(choice: ConflictChoice): Resolution {
        cancelPending()
        return when (choice) {
            ConflictChoice.MINE -> {
                save(guard = false)
                Resolution.Saved
            }
            ConflictChoice.THEIRS -> {
                drafts.put(uri, name, text, hashOf(knownBytes))
                Resolution.Reload(store.read(uri), store.meta(uri))
            }
            ConflictChoice.COPY -> Resolution.NeedsCopyTarget(copyName(name), TextCodec.encode(text, eol, bom))
        }
    }

    private fun save(guard: Boolean) {
        pending = null
        if (!isDirty) return
        val saving = text
        emit(SaveState.SAVING)
        try {
            if (guard && changedElsewhere()) {
                emit(SaveState.CONFLICT)
                return
            }
            val out = TextCodec.encode(saving, eol, bom)
            attempted = out
            ownWriteInDoubt = true
            store.write(uri, out)
            // The Drive app can accept a write and still not hold it. Only what reads back counts.
            if (!readsBack(out)) {
                emit(SaveState.FAILED)
                return
            }
            ownWriteInDoubt = false
            knownBytes = out
            knownMeta = store.meta(uri)
            savedText = saving
            drafts.markSaved(uri)
            emit(SaveState.SAVED)
        } catch (e: Exception) {
            emit(SaveState.FAILED)
        }
    }

    /** The provider may need a moment before a write shows up; look twice before calling it lost. */
    private fun readsBack(out: ByteArray): Boolean {
        if (store.read(uri).contentEquals(out)) return true
        pause(READ_BACK_RETRY_MS)
        return store.read(uri).contentEquals(out)
    }

    /** True when the file on Drive is no longer what this controller last read or wrote. */
    private fun changedElsewhere(): Boolean {
        // After a write of our own went wrong the file can hold anything from nothing to all of it.
        // That is our doing, not another device's: write again rather than ask.
        if (ownWriteInDoubt) return false
        val now = store.meta(uri)
        val sameMeta = now.size != null && now.lastModified != null &&
            now.size == knownMeta.size && now.lastModified == knownMeta.lastModified
        if (sameMeta) return false
        // Metadata moved or is not reported: only the content can tell.
        val current = store.read(uri)
        return !current.contentEquals(knownBytes) && !(attempted?.let { current.contentEquals(it) } ?: false)
    }

    private fun cancelPending() {
        pending?.cancel()
        pending = null
    }

    private fun emit(next: SaveState) {
        state = next
        onState(next)
    }

    companion object {
        const val AUTOSAVE_MS = 2000L
        const val READ_BACK_RETRY_MS = 400L

        fun copyName(name: String): String {
            val dot = name.lastIndexOf('.')
            val stem = if (dot > 0) name.substring(0, dot) else name
            return "$stem (phone).md"
        }
    }
}
