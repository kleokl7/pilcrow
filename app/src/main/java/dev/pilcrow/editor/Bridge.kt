package dev.pilcrow.editor

import android.os.Handler
import android.webkit.JavascriptInterface

/**
 * window.PilcrowNative in the web app. One method per NativeApi method in editor/src/bridge.ts.
 * WebView calls these on its own thread; each call is handed to the session's thread through [post].
 */
class Bridge(private val post: (Session.() -> Unit) -> Unit) {

    @JavascriptInterface fun ready(): Unit = post { onWebReady() }
    @JavascriptInterface fun openPicker(): Unit = post { openPicker() }
    @JavascriptInterface fun createNote(): Unit = post { createNote() }
    @JavascriptInterface fun openRecent(id: String): Unit = post { openRecent(id) }
    @JavascriptInterface fun findAgain(id: String): Unit = post { findAgain(id) }
    @JavascriptInterface fun forgetRecent(id: String): Unit = post { forgetRecent(id) }
    @JavascriptInterface fun docChanged(token: String, text: String): Unit = post { docChanged(token, text) }
    @JavascriptInterface fun closeDocument(): Unit = post { closeDocument() }
    @JavascriptInterface fun retrySave(): Unit = post { retrySave() }
    @JavascriptInterface fun resolveConflict(choice: String): Unit = post { resolveConflict(choice) }
    @JavascriptInterface fun answerDraftOffer(restore: Boolean): Unit = post { answerDraftOffer(restore) }
    @JavascriptInterface fun setViewMode(mode: String): Unit = post { setViewMode(mode) }
    @JavascriptInterface fun setLineNumbers(on: Boolean): Unit = post { setLineNumbers(on) }
    @JavascriptInterface fun requestDrafts(): Unit = post { requestDrafts() }
    @JavascriptInterface fun readDraft(id: String): Unit = post { readDraft(id) }
    @JavascriptInterface fun discardDraft(id: String): Unit = post { discardDraft(id) }
    @JavascriptInterface fun copyText(text: String): Unit = post { copyText(text) }
    @JavascriptInterface fun openUrl(url: String): Unit = post { openUrl(url) }
    @JavascriptInterface fun exitApp(): Unit = post { exitApp() }
}

/** Timers on the thread of the given handler. */
class HandlerScheduler(private val handler: Handler) : Scheduler {
    override fun schedule(delayMs: Long, block: () -> Unit): Scheduler.Cancellable {
        val task = Runnable { block() }
        handler.postDelayed(task, delayMs)
        return Scheduler.Cancellable { handler.removeCallbacks(task) }
    }
}
