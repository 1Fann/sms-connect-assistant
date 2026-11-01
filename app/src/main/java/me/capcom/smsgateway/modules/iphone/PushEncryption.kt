package me.capcom.smsgateway.modules.iphone

import java.math.BigInteger
import java.nio.ByteBuffer
import java.security.*
import java.security.interfaces.ECPublicKey
import java.security.spec.*
import javax.crypto.*
import javax.crypto.spec.*

/** RFC 8291 single-record encryption. Each request uses a new sender key and salt. */
internal object PushEncryption {
    private val curve by lazy {
        AlgorithmParameters.getInstance("EC").apply { init(ECGenParameterSpec("secp256r1")) }
            .getParameterSpec(ECParameterSpec::class.java)
    }
    fun publicKey(bytes: ByteArray): ECPublicKey {
        require(bytes.size == 65 && bytes[0] == 4.toByte())
        val x = BigInteger(1, bytes.copyOfRange(1, 33))
        val y = BigInteger(1, bytes.copyOfRange(33, 65))
        val field = (curve.curve.field as ECFieldFp).p
        require(x < field && y < field && y.pow(2).mod(field) == (x.pow(3) + curve.curve.a*x + curve.curve.b).mod(field))
        return KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(ECPoint(x, y), curve)) as ECPublicKey
    }
    private fun coordinate(n: BigInteger): ByteArray {
        val raw = n.toByteArray().takeLast(32).toByteArray()
        return ByteArray(32 - raw.size) + raw
    }
    fun encrypt(receiver: ByteArray, auth: ByteArray, message: ByteArray): ByteArray {
        require(auth.size == 16 && message.size <= 3993)
        val sender = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        val point = (sender.public as ECPublicKey).w
        val senderBytes = byteArrayOf(4) + coordinate(point.affineX) + coordinate(point.affineY)
        val secret = KeyAgreement.getInstance("ECDH").run {
            init(sender.private)
            doPhase(publicKey(receiver), true)
            generateSecret()
        }
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        return record(receiver, auth, senderBytes, secret, salt, message)
    }
    internal fun record(receiver: ByteArray, auth: ByteArray, sender: ByteArray, secret: ByteArray,
                        salt: ByteArray, message: ByteArray): ByteArray {
        fun hmac(key: ByteArray, input: ByteArray) = Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(key, "HmacSHA256"))
            doFinal(input)
        }
        val info = "WebPush: info".toByteArray() + byteArrayOf(0) + receiver + sender
        val ikm = hmac(hmac(auth, secret), info + byteArrayOf(1))
        val prk = hmac(salt, ikm)
        fun derive(label: String, length: Int) =
            hmac(prk, ("Content-Encoding: " + label).toByteArray() + byteArrayOf(0, 1)).copyOf(length)
        val ciphertext = Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.ENCRYPT_MODE, SecretKeySpec(derive("aes128gcm", 16), "AES"), GCMParameterSpec(128, derive("nonce", 12)))
            doFinal(message + byteArrayOf(2))
        }
        return ByteBuffer.allocate(86 + ciphertext.size).put(salt).putInt(4096).put(65.toByte())
            .put(sender).put(ciphertext).array()
    }
}
