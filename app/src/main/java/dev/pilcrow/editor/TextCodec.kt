package dev.pilcrow.editor

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

enum class Eol { LF, CRLF }

/** A file as the editor sees it: text that always uses "\n", plus what is needed to write the same bytes back. */
data class Decoded(val text: String, val eol: Eol, val bom: Boolean, val mixedEol: Boolean)

sealed interface DecodeResult {
    data class Ok(val doc: Decoded) : DecodeResult

    /** The file can be shown but must not be written. `reason` is shown to the user. */
    data class ReadOnly(val text: String, val reason: String) : DecodeResult
}

/**
 * Bytes on Drive <-> text in the editor. A file that uses one kind of line ending comes back
 * byte for byte: same BOM, same line endings, same last line.
 */
object TextCodec {
    const val MAX_BYTES = 5 * 1024 * 1024

    private const val TOO_LARGE = "This file is larger than 5 MB, so it opens read-only."
    private const val NOT_UTF8 = "This file is not UTF-8 text, so it opens read-only."
    private val BOM = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte())

    fun decode(bytes: ByteArray): DecodeResult {
        val bom = bytes.size >= 3 && bytes[0] == BOM[0] && bytes[1] == BOM[1] && bytes[2] == BOM[2]
        val offset = if (bom) 3 else 0
        val lossy by lazy { String(bytes, offset, bytes.size - offset, Charsets.UTF_8).replace("\r\n", "\n") }

        if (bytes.size > MAX_BYTES) return DecodeResult.ReadOnly(lossy, TOO_LARGE)

        val raw = try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes, offset, bytes.size - offset))
                .toString()
        } catch (e: CharacterCodingException) {
            return DecodeResult.ReadOnly(lossy, NOT_UTF8)
        }

        var crlf = 0
        var lf = 0
        for (i in raw.indices) {
            if (raw[i] == '\n') {
                if (i > 0 && raw[i - 1] == '\r') crlf++ else lf++
            }
        }
        val eol = if (crlf > lf) Eol.CRLF else Eol.LF
        return DecodeResult.Ok(Decoded(raw.replace("\r\n", "\n"), eol, bom, mixedEol = crlf > 0 && lf > 0))
    }

    fun encode(text: String, eol: Eol, bom: Boolean): ByteArray {
        val body = (if (eol == Eol.CRLF) text.replace("\n", "\r\n") else text).toByteArray(Charsets.UTF_8)
        return if (bom) BOM + body else body
    }
}
