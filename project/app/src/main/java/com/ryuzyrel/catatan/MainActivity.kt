package com.ryuzyrel.catatan

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast

class MainActivity : Activity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingSharedText: String? = null

    companion object {
        private const val FILE_CHOOSER_REQ = 1001
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        val ws: WebSettings = webView.settings
        ws.javaScriptEnabled = true
        ws.domStorageEnabled = true
        ws.loadWithOverviewMode = true
        ws.useWideViewPort = true
        ws.mediaPlaybackRequiresUserGesture = false

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                pendingSharedText?.let { t ->
                    pendingSharedText = null
                    deliverSharedText(t)
                }
            }
        }
        if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            pendingSharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
        }
        webView.webChromeClient = object : WebChromeClient() {
            /* WAJIB untuk <input type="file"> (menu Pulihkan) */
            override fun onShowFileChooser(
                view: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                val intent = params?.createIntent()
                    ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                    }
                return try {
                    this@MainActivity.startActivityForResult(intent, FILE_CHOOSER_REQ)
                    true
                } catch (e: Exception) {
                    filePathCallback = null
                    Toast.makeText(this@MainActivity,
                        "Tidak bisa membuka pemilih file", Toast.LENGTH_SHORT).show()
                    false
                }
            }
        }
        webView.addJavascriptInterface(Bridge(), "AndroidBridge")
        webView.loadUrl("file:///android_asset/www/index.html")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            val t = intent.getStringExtra(Intent.EXTRA_TEXT)
            if (t != null) {
                if (::webView.isInitialized) deliverSharedText(t)
                else pendingSharedText = t
            }
        }
    }

    private fun deliverSharedText(text: String) {
        val esc = text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n")
        webView.evaluateJavascript("window.__onSharedText && window.__onSharedText(\"" + esc + "\")", null)
    }

    @Deprecated("Tetap dipakai untuk hasil file chooser")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == FILE_CHOOSER_REQ) {
            val result = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            filePathCallback?.onReceiveValue(result)
            filePathCallback = null
        }
    }

    private var lastBackPress = 0L

    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
            return
        }
        val now = System.currentTimeMillis()
        if (now - lastBackPress < 2000) {
            super.onBackPressed()
        } else {
            lastBackPress = now
            Toast.makeText(this, "Tekan sekali lagi untuk keluar", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onDestroy() {
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }

    private fun jsBioResult(ok: Boolean, msg: String) {
        runOnUiThread {
            if (::webView.isInitialized) {
                val m = msg.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ")
                webView.evaluateJavascript("window.__bioResult && window.__bioResult($ok, \"" + m + "\")", null)
            }
        }
    }


    /** Bridge JS -> native. */
    inner class Bridge {
        @JavascriptInterface
        fun openLink(url: String) {
            runOnUiThread {
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    startActivity(intent)
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "Tidak bisa membuka link", Toast.LENGTH_SHORT).show()
                }
            }
        }

        @JavascriptInterface
        fun bioAvailable(): Boolean {
            /* cek hardware langsung (canAuthenticate() kadang ngaco di MIUI);
               status enroll dicek implisit saat prompt tampil */
            if (android.os.Build.VERSION.SDK_INT < 29) return false
            return try {
                val pm = packageManager
                pm.hasSystemFeature(android.content.pm.PackageManager.FEATURE_FINGERPRINT) ||
                pm.hasSystemFeature(android.content.pm.PackageManager.FEATURE_FACE) ||
                pm.hasSystemFeature(android.content.pm.PackageManager.FEATURE_IRIS)
            } catch (e: Exception) { false }
        }

        @JavascriptInterface
        fun bioAuth() {
            runOnUiThread {
                if (android.os.Build.VERSION.SDK_INT < 29) { jsBioResult(false, "API<29"); return@runOnUiThread }
                try {
                    val prompt = android.hardware.biometrics.BiometricPrompt.Builder(this@MainActivity)
                        .setTitle("Buka Folder Rahasia")
                        .setSubtitle("Gunakan sidik jari")
                        .setNegativeButton("Batal", mainExecutor,
                            android.content.DialogInterface.OnClickListener { _, _ -> jsBioResult(false, "") })
                        .build()
                    prompt.authenticate(
                        android.os.CancellationSignal(), mainExecutor,
                        object : android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
                            override fun onAuthenticationSucceeded(
                                result: android.hardware.biometrics.BiometricPrompt.AuthenticationResult) {
                                jsBioResult(true, "")
                            }
                            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                                jsBioResult(false, "[$errorCode] $errString")
                            }
                        })
                } catch (e: Exception) { jsBioResult(false, e.message ?: "gagal") }
            }
        }

        @JavascriptInterface
        fun readClipboard(): String {
            return try {
                val cm = getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
                val clip = cm.primaryClip
                if (clip != null && clip.itemCount > 0)
                    clip.getItemAt(0).coerceToText(this@MainActivity).toString()
                else ""
            } catch (e: Exception) { "" }
        }

        @JavascriptInterface
        fun exportPdf(title: String, body: String) {
            runOnUiThread {
                try {
                    val doc = android.graphics.pdf.PdfDocument()
                    val pw = 595; val ph = 842
                    var pageNum = 1
                    var page = doc.startPage(android.graphics.pdf.PdfDocument.PageInfo.Builder(pw, ph, pageNum).create())
                    var canvas = page.canvas
                    val paint = android.graphics.Paint()
                    var y = 70f
                    val left = 50f; val right = (pw - 50).toFloat()
                    fun newPage() {
                        doc.finishPage(page)
                        pageNum++
                        page = doc.startPage(android.graphics.pdf.PdfDocument.PageInfo.Builder(pw, ph, pageNum).create())
                        canvas = page.canvas
                        y = 70f
                    }
                    fun drawWrapped(text: String, textSize: Float, bold: Boolean, gap: Float) {
                        paint.textSize = textSize
                        paint.isFakeBoldText = bold
                        paint.color = android.graphics.Color.BLACK
                        var line = ""
                        for (w in text.split(" ")) {
                            val test = if (line.isEmpty()) w else "$line $w"
                            if (paint.measureText(test) > right - left) {
                                canvas.drawText(line, left, y, paint)
                                y += gap
                                if (y > ph - 60) newPage()
                                line = w
                            } else line = test
                        }
                        if (line.isNotEmpty()) {
                            canvas.drawText(line, left, y, paint)
                            y += gap
                        }
                        y += gap * 0.5f
                        if (y > ph - 60) newPage()
                    }
                    val safeTitle = if (title.isBlank()) "Catatan" else title
                    drawWrapped(safeTitle, 22f, true, 30f)
                    y += 10f
                    body.split("\n").forEach { para ->
                        if (para.isBlank()) y += 14f
                        else drawWrapped(para, 14f, false, 20f)
                    }
                    doc.finishPage(page)
                    val fname = safeTitle.replace(Regex("[^a-zA-Z0-9 _-]"), "").trim().take(40)
                        .ifEmpty { "Catatan" } + "_" + System.currentTimeMillis() + ".pdf"
                    val values = android.content.ContentValues().apply {
                        put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, fname)
                        put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "application/pdf")
                        if (android.os.Build.VERSION.SDK_INT >= 29) {
                            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, "Download/CatatanKu")
                        }
                    }
                    val collection = if (android.os.Build.VERSION.SDK_INT >= 29)
                        android.provider.MediaStore.Downloads.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    else
                        android.provider.MediaStore.Files.getContentUri("external")
                    val uri = contentResolver.insert(collection, values)
                    if (uri != null) {
                        contentResolver.openOutputStream(uri)?.use { doc.writeTo(it) }
                        Toast.makeText(this@MainActivity, "PDF tersimpan di Download/CatatanKu", Toast.LENGTH_LONG).show()
                    } else {
                        Toast.makeText(this@MainActivity, "Gagal menyimpan PDF", Toast.LENGTH_SHORT).show()
                    }
                    doc.close()
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "Gagal: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }

        @JavascriptInterface
        fun exportPdfBulk(json: String) {
            runOnUiThread {
                try {
                    val arr = org.json.JSONArray(json)
                    if (arr.length() == 0) {
                        Toast.makeText(this@MainActivity, "Tidak ada catatan dipilih", Toast.LENGTH_SHORT).show()
                        return@runOnUiThread
                    }
                    val doc = android.graphics.pdf.PdfDocument()
                    val pw = 595; val ph = 842
                    var pageNum = 1
                    var page = doc.startPage(android.graphics.pdf.PdfDocument.PageInfo.Builder(pw, ph, pageNum).create())
                    var canvas = page.canvas
                    val paint = android.graphics.Paint()
                    var y = 70f
                    val left = 50f; val right = (pw - 50).toFloat()
                    fun newPage() {
                        doc.finishPage(page)
                        pageNum++
                        page = doc.startPage(android.graphics.pdf.PdfDocument.PageInfo.Builder(pw, ph, pageNum).create())
                        canvas = page.canvas
                        y = 70f
                    }
                    fun drawWrapped(text: String, textSize: Float, bold: Boolean, gap: Float) {
                        paint.textSize = textSize
                        paint.isFakeBoldText = bold
                        paint.color = android.graphics.Color.BLACK
                        var line = ""
                        for (w in text.split(" ")) {
                            val test = if (line.isEmpty()) w else "$line $w"
                            if (paint.measureText(test) > right - left) {
                                canvas.drawText(line, left, y, paint)
                                y += gap
                                if (y > ph - 60) newPage()
                                line = w
                            } else line = test
                        }
                        if (line.isNotEmpty()) {
                            canvas.drawText(line, left, y, paint)
                            y += gap
                        }
                        y += gap * 0.5f
                        if (y > ph - 60) newPage()
                    }
                    for (i in 0 until arr.length()) {
                        val o = arr.getJSONObject(i)
                        val t = o.optString("title", "").ifBlank { "Catatan" }
                        val b = o.optString("body", "")
                        drawWrapped(t, 20f, true, 28f)
                        b.split("\n").forEach { para ->
                            if (para.isBlank()) y += 12f
                            else drawWrapped(para, 14f, false, 20f)
                        }
                        if (i < arr.length() - 1) {
                            y += 8f
                            paint.color = android.graphics.Color.LTGRAY
                            paint.strokeWidth = 1f
                            canvas.drawLine(left, y, right, y, paint)
                            y += 18f
                            if (y > ph - 60) newPage()
                        }
                    }
                    doc.finishPage(page)
                    val fname = "CatatanKu_" + System.currentTimeMillis() + ".pdf"
                    val values = android.content.ContentValues().apply {
                        put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, fname)
                        put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "application/pdf")
                        if (android.os.Build.VERSION.SDK_INT >= 29) {
                            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, "Download/CatatanKu")
                        }
                    }
                    val collection = if (android.os.Build.VERSION.SDK_INT >= 29)
                        android.provider.MediaStore.Downloads.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    else
                        android.provider.MediaStore.Files.getContentUri("external")
                    val uri = contentResolver.insert(collection, values)
                    if (uri != null) {
                        contentResolver.openOutputStream(uri)?.use { doc.writeTo(it) }
                        Toast.makeText(this@MainActivity, "PDF tersimpan di Download/CatatanKu", Toast.LENGTH_LONG).show()
                    } else {
                        Toast.makeText(this@MainActivity, "Gagal menyimpan PDF", Toast.LENGTH_SHORT).show()
                    }
                    doc.close()
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "Gagal: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }

        fun saveFile(name: String, mime: String, base64Data: String) {
            runOnUiThread {
                try {
                    val bytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT)
                    val values = android.content.ContentValues().apply {
                        put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name)
                        put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime)
                        if (android.os.Build.VERSION.SDK_INT >= 29) {
                            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, "Download/CatatanKu")
                        }
                    }
                    val collection = if (android.os.Build.VERSION.SDK_INT >= 29)
                        android.provider.MediaStore.Downloads.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    else
                        android.provider.MediaStore.Files.getContentUri("external")
                    val uri = contentResolver.insert(collection, values)
                    if (uri != null) {
                        contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                        Toast.makeText(this@MainActivity, "Tersimpan di Download/CatatanKu/$name", Toast.LENGTH_LONG).show()
                    } else {
                        Toast.makeText(this@MainActivity, "Gagal menyimpan file", Toast.LENGTH_SHORT).show()
                    }
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "Gagal: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }
}
