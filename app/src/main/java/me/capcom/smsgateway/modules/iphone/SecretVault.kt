package me.capcom.smsgateway.modules.iphone

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** A separate non-exportable wrapping key; secrets excluded from Android backup. */
class SecretVault(context: Context) {
    private val directory=context.noBackupFilesDir
    private fun key(): SecretKey {
        val store=KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return (store.getKey("iphone.secrets",null) as? SecretKey) ?: KeyGenerator.getInstance("AES","AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("iphone.secrets",KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun put(name: String,value: ByteArray) {
        require(name.matches(Regex("[a-z-]+")))
        val temp=File(directory,"$name.tmp");temp.writeBytes(seal(value));check(temp.renameTo(File(directory,"$name.secret")))
    }
    fun seal(value: ByteArray): ByteArray {
        val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE,key()) }
        return cipher.iv+cipher.doFinal(value)
    }
    @Synchronized fun get(name: String): ByteArray? {
        require(name.matches(Regex("[a-z-]+")))
        val file=File(directory,"$name.secret");if(!file.exists())return null
        return open(file.readBytes())
    }
    fun open(bytes: ByteArray): ByteArray {
        return Cipher.getInstance("AES/GCM/NoPadding").run { init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,bytes.copyOfRange(0,12)));doFinal(bytes.copyOfRange(12,bytes.size)) }
    }
}
