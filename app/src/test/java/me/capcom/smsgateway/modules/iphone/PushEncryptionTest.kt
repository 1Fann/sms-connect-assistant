package me.capcom.smsgateway.modules.iphone

import java.util.Base64
import org.junit.Assert.assertArrayEquals
import org.junit.Test

class PushEncryptionTest {
    @Test fun matchesRfc8291AppendixA() {
        fun bytes(value: String) = Base64.getUrlDecoder().decode(value)
        val receiver = bytes("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4")
        val sender = bytes("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8")
        val record = PushEncryption.record(receiver, bytes("BTBZMqHH6r4Tts7J_aSIgg"), sender,
            bytes("kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs"), bytes("DGv6ra1nlYgDCS1FRnbzlw"),
            bytes("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"))
        val header = bytes("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8")
        val ciphertext = bytes("8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ")
        assertArrayEquals(header + ciphertext, record)
    }
}
