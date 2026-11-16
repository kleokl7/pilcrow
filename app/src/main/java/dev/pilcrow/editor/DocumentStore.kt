package dev.pilcrow.editor

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Process
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import java.io.IOException

data class DocMeta(val name: String, val size: Long?, val lastModified: Long?, val mime: String?)

/** The app no longer has permission for this file. The user has to pick it again. */
class NeedsPicker(cause: Throwable? = null) : Exception(cause)

/** Files that live with another app (Drive), reached by their content URI. */
interface DocumentStore {
    fun meta(uri: String): DocMeta
    fun read(uri: String): ByteArray
    fun write(uri: String, bytes: ByteArray)

    /**
     * Asks to keep access after the app is closed. True when the app that sent the file agreed.
     * The picker always agrees. "Open with" from Drive usually lends the file only while Pilcrow is open.
     */
    fun persist(uri: String, canWrite: Boolean): Boolean

    /** False when the app can no longer reach this file, without asking the provider. Cheap enough for every Home row. */
    fun hasAccess(uri: String): Boolean

    /** A short name for where the file lives: "Drive", "This phone". Empty when unknown. */
    fun providerLabel(uri: String): String
}

class SafDocumentStore(private val context: Context) : DocumentStore {
    private val resolver get() = context.contentResolver

    private inline fun <T> guarded(block: () -> T): T =
        try {
            block()
        } catch (e: SecurityException) {
            throw NeedsPicker(e)
        }

    override fun meta(uri: String): DocMeta = guarded {
        val u = Uri.parse(uri)
        var name = u.lastPathSegment ?: "Untitled.md"
        var size: Long? = null
        var modified: Long? = null
        resolver.query(u, null, null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                fun index(column: String) = c.getColumnIndex(column).takeIf { it >= 0 && !c.isNull(it) }
                index(OpenableColumns.DISPLAY_NAME)?.let { name = c.getString(it) }
                index(OpenableColumns.SIZE)?.let { size = c.getLong(it) }
                index(DocumentsContract.Document.COLUMN_LAST_MODIFIED)?.let { modified = c.getLong(it) }
            }
        }
        DocMeta(name, size, modified, resolver.getType(u))
    }

    override fun read(uri: String): ByteArray = guarded {
        resolver.openInputStream(Uri.parse(uri))?.use { it.readBytes() } ?: throw IOException("No stream for $uri")
    }

    override fun write(uri: String, bytes: ByteArray) = guarded {
        val u = Uri.parse(uri)
        var last: Exception? = null
        // Which mode truncates and works is up to the provider, so try them in turn.
        for (mode in WRITE_MODES) {
            try {
                val out = resolver.openOutputStream(u, mode) ?: throw IOException("No stream for mode $mode")
                out.use {
                    it.write(bytes)
                    it.flush()
                }
                return@guarded
            } catch (e: SecurityException) {
                throw e
            } catch (e: Exception) {
                last = e
            }
        }
        throw IOException("Could not write $uri", last)
    }

    override fun persist(uri: String, canWrite: Boolean): Boolean {
        val u = Uri.parse(uri)
        val read = Intent.FLAG_GRANT_READ_URI_PERMISSION
        // Asking for more than was granted fails as a whole. A file lent read-only must still be kept for reading.
        val asks = if (canWrite) listOf(read or Intent.FLAG_GRANT_WRITE_URI_PERMISSION, read) else listOf(read)
        return asks.any { flags ->
            try {
                resolver.takePersistableUriPermission(u, flags)
                true
            } catch (e: Exception) {
                false
            }
        }
    }

    override fun hasAccess(uri: String): Boolean =
        try {
            // Counts both kinds of grant: kept ones, and ones lent for as long as the app is open.
            context.checkUriPermission(Uri.parse(uri), Process.myPid(), Process.myUid(), Intent.FLAG_GRANT_READ_URI_PERMISSION) ==
                PackageManager.PERMISSION_GRANTED
        } catch (e: Exception) {
            // Unknown: say yes, and let opening the note find out.
            true
        }

    override fun providerLabel(uri: String): String {
        val authority = Uri.parse(uri).authority ?: return ""
        return when {
            authority.startsWith("com.google.android.apps.docs") -> "Drive"
            authority.startsWith("com.android.externalstorage") -> "This phone"
            authority.startsWith("com.android.providers.downloads") -> "Downloads"
            else -> context.packageManager.resolveContentProvider(authority, 0)?.loadLabel(context.packageManager)?.toString() ?: ""
        }
    }

    private companion object {
        // "w" last: some providers take it without emptying the file first, which leaves the old tail behind.
        val WRITE_MODES = listOf("wt", "rwt", "w")
    }
}
