package me.capcom.smsgateway.modules.iphone

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.ByteArrayInputStream
import java.io.File
import java.security.KeyStore
import java.security.cert.X509Certificate
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class TlsIdentity(private val context: Context) {
    private val file get() = File(context.noBackupFilesDir, "iphone-tls.bin")
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return (store.getKey("iphone.tls", null) as? SecretKey) ?: KeyGenerator.getInstance("AES", "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("iphone.tls", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun import(bytes: ByteArray, password: String) {
        val store = KeyStore.getInstance("PKCS12").apply { load(ByteArrayInputStream(bytes), password.toCharArray()) }
        require(store.aliases().toList().any { store.isKeyEntry(it) }) { "证书文件没有私钥" }
        val buffer = java.io.ByteArrayOutputStream()
        java.io.DataOutputStream(buffer).use { it.writeUTF(password); it.writeInt(bytes.size); it.write(bytes) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val temp = File(context.noBackupFilesDir, "iphone-tls.tmp")
        temp.writeBytes(cipher.iv + cipher.doFinal(buffer.toByteArray()))
        check(temp.renameTo(file))
    }
    fun load(): Triple<KeyStore, String, CharArray> {
        val bytes = file.readBytes()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
        val input = java.io.DataInputStream(ByteArrayInputStream(cipher.doFinal(bytes.copyOfRange(12, bytes.size))))
        val password = input.readUTF().toCharArray()
        val cert = ByteArray(input.readInt()); input.readFully(cert)
        val store = KeyStore.getInstance("PKCS12").apply { load(ByteArrayInputStream(cert), password) }
        val alias = store.aliases().toList().first { store.isKeyEntry(it) }
        (store.getCertificate(alias) as X509Certificate).checkValidity()
        require(store.getCertificateChain(alias).size > 1) { "请导入包含中间证书的可信证书链" }
        return Triple(store, alias, password)
    }
}
