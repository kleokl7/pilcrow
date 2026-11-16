package dev.pilcrow.editor

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TextCodecTest {

    private fun ok(bytes: ByteArray): Decoded = (TextCodec.decode(bytes) as DecodeResult.Ok).doc

    private fun roundTrip(bytes: ByteArray): ByteArray = ok(bytes).let { TextCodec.encode(it.text, it.eol, it.bom) }

    @Test fun lfRoundTripsByteForByte() {
        val b = "a\nb\n".toByteArray()
        assertArrayEquals(b, roundTrip(b))
        assertEquals(Eol.LF, ok(b).eol)
        assertFalse(ok(b).mixedEol)
    }

    @Test fun crlfRoundTripsByteForByte() {
        val b = "a\r\nb\r\n".toByteArray()
        val d = ok(b)
        assertEquals("a\nb\n", d.text)
        assertEquals(Eol.CRLF, d.eol)
        assertArrayEquals(b, roundTrip(b))
    }

    @Test fun bomIsKept() {
        val b = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + "x".toByteArray()
        val d = ok(b)
        assertTrue(d.bom)
        assertEquals("x", d.text)
        assertArrayEquals(b, roundTrip(b))
    }

    @Test fun noTrailingNewlineIsKept() {
        val b = "a\nb".toByteArray()
        assertArrayEquals(b, roundTrip(b))
    }

    @Test fun nonAsciiTextRoundTrips() {
        val b = "καλημέρα — ✓ 🙂\n".toByteArray()
        assertArrayEquals(b, roundTrip(b))
    }

    @Test fun mixedEndingsAreFlaggedAndUseTheDominantOne() {
        val d = ok("a\r\nb\r\nc\n".toByteArray())
        assertTrue(d.mixedEol)
        assertEquals(Eol.CRLF, d.eol)
        assertEquals("a\nb\nc\n", d.text)
    }

    @Test fun aTieOrNoLineBreakIsLf() {
        assertEquals(Eol.LF, ok("a\r\nb\n".toByteArray()).eol)
        assertEquals(Eol.LF, ok("abc".toByteArray()).eol)
    }

    @Test fun invalidUtf8IsReadOnly() {
        val r = TextCodec.decode(byteArrayOf(0x61, 0xC3.toByte(), 0x28))
        assertTrue(r is DecodeResult.ReadOnly)
        assertEquals("This file is not UTF-8 text, so it opens read-only.", (r as DecodeResult.ReadOnly).reason)
        assertTrue(r.text.startsWith("a"))
    }

    @Test fun fileOverFiveMegabytesIsReadOnly() {
        val r = TextCodec.decode(ByteArray(TextCodec.MAX_BYTES + 1) { 0x61 })
        assertEquals("This file is larger than 5 MB, so it opens read-only.", (r as DecodeResult.ReadOnly).reason)
    }

    @Test fun emptyFileIsOk() {
        val d = ok(ByteArray(0))
        assertEquals("", d.text)
        assertFalse(d.bom)
        assertEquals(0, TextCodec.encode(d.text, d.eol, d.bom).size)
    }
}
