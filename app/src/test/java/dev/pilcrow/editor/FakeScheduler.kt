package dev.pilcrow.editor

/** A clock the test moves by hand. */
class FakeScheduler : Scheduler {
    private class Job(val at: Long, val block: () -> Unit, var cancelled: Boolean = false)

    private val jobs = ArrayList<Job>()
    var now = 0L
        private set

    override fun schedule(delayMs: Long, block: () -> Unit): Scheduler.Cancellable {
        val job = Job(now + delayMs, block)
        jobs += job
        return Scheduler.Cancellable { job.cancelled = true }
    }

    fun advance(ms: Long) {
        val end = now + ms
        while (true) {
            val next = jobs.filter { !it.cancelled && it.at <= end }.minByOrNull { it.at } ?: break
            jobs.remove(next)
            now = next.at
            next.block()
        }
        now = end
    }
}
