package dev.pilcrow.editor

import android.os.Handler

/** Timers on the thread of the given handler. */
class HandlerScheduler(private val handler: Handler) : Scheduler {
    override fun schedule(delayMs: Long, block: () -> Unit): Scheduler.Cancellable {
        val task = Runnable { block() }
        handler.postDelayed(task, delayMs)
        return Scheduler.Cancellable { handler.removeCallbacks(task) }
    }
}
