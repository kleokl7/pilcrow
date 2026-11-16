package dev.pilcrow.editor

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface

/**
 * window.PilcrowNative in the web app. One method per NativeApi method in editor/src/bridge.ts.
 * WebView calls these on its own thread, so each one hops to the main thread before it touches the session.
 */
class Bridge(private val session: () -> Session) {
    private val main = Handler(Looper.getMainLooper())

    private fun onMain(block: Session.() -> Unit) {
        main.post { session().block() }
    }

    @JavascriptInterface fun ready() = onMain { onWebReady() }
    @JavascriptInterface fun openPicker() = onMain { openPicker() }
    @JavascriptInterface fun createNote() = onMain { createNote() }
    @JavascriptInterface fun openRecent(id: String) = onMain { openRecent(id) }
    @JavascriptInterface fun docChanged(text: String) = onMain { docChanged(text) }
    @JavascriptInterface fun closeDocument() = onMain { closeDocument() }
    @JavascriptInterface fun retrySave() = onMain { retrySave() }
    @JavascriptInterface fun resolveConflict(choice: String) = onMain { resolveConflict(choice) }
    @JavascriptInterface fun answerDraftOffer(restore: Boolean) = onMain { answerDraftOffer(restore) }
    @JavascriptInterface fun setViewMode(mode: String) = onMain { setViewMode(mode) }
    @JavascriptInterface fun requestDrafts() = onMain { requestDrafts() }
    @JavascriptInterface fun readDraft(id: String) = onMain { readDraft(id) }
    @JavascriptInterface fun discardDraft(id: String) = onMain { discardDraft(id) }
    @JavascriptInterface fun copyText(text: String) = onMain { copyText(text) }
    @JavascriptInterface fun openUrl(url: String) = onMain { openUrl(url) }
    @JavascriptInterface fun exitApp() = onMain { exitApp() }
}

/** Timers on the main thread. */
class MainThreadScheduler : Scheduler {
    private val main = Handler(Looper.getMainLooper())

    override fun schedule(delayMs: Long, block: () -> Unit): Scheduler.Cancellable {
        val task = Runnable { block() }
        main.postDelayed(task, delayMs)
        return Scheduler.Cancellable { main.removeCallbacks(task) }
    }
}
