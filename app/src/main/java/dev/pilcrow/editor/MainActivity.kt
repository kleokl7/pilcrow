package dev.pilcrow.editor

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.provider.DocumentsContract
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The only screen. It hosts the web app, hands it files from the system picker and from "Open with",
 * and keeps it above the keyboard. Everything else is decided by [Session].
 *
 * Threads: the session, and with it every read and write of a Drive file, runs on its own thread, so a
 * slow provider cannot freeze the screen. Whatever the session asks of Android comes back to the main thread.
 */
class MainActivity : ComponentActivity(), Session.Effects {

    private lateinit var webView: WebView
    private lateinit var session: Session
    private val sessionThread = HandlerThread("pilcrow-session").apply { start() }
    private val sessionHandler = Handler(sessionThread.looper)
    @Volatile private var destroyed = false

    private fun onSession(block: Session.() -> Unit) {
        sessionHandler.post { session.block() }
    }

    private val pickDocument = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uri = result.data?.data
        if (result.resultCode == RESULT_OK && uri != null) onSession { openUri(uri.toString(), canWrite = true, fromPicker = true) }
    }

    private val createDocument = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uri = result.data?.data
        if (result.resultCode == RESULT_OK && uri != null) onSession { onCreated(uri.toString()) } else onSession { onCreateCancelled() }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(true)

        val prefs = getPreferences(MODE_PRIVATE)
        session = Session(
            store = SafDocumentStore(applicationContext),
            drafts = DraftStore(File(filesDir, "drafts")) { System.currentTimeMillis() },
            recents = RecentsStore(File(filesDir, "recents.json")),
            scheduler = HandlerScheduler(sessionHandler),
            now = { System.currentTimeMillis() },
            emit = ::emit,
            effects = this,
            viewMode = prefs.getString(PREF_VIEW_MODE, "formatted") ?: "formatted",
            pause = { ms -> Thread.sleep(ms) },
        ) { mode -> prefs.edit().putString(PREF_VIEW_MODE, mode).apply() }

        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/editor/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            setBackgroundColor(getColor(R.color.paper))
            overScrollMode = WebView.OVER_SCROLL_NEVER
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.textZoom = 100
            addJavascriptInterface(Bridge(::onSession), "PilcrowNative")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assets.shouldInterceptRequest(request.url)

                // The app is one page. Links are opened by the session, in the browser.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true
            }
        }

        val root = FrameLayout(this).apply {
            setBackgroundColor(getColor(R.color.paper))
            addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        setContentView(root)

        // Edge to edge: keep the page clear of the status bar, the gesture bar and, when it is open, the keyboard.
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
            WindowInsetsCompat.CONSUMED
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = onSession { onBackPressed() }
        })

        handleIntent(intent)
        webView.loadUrl(START_URL)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        onSession { onResume() }
    }

    override fun onPause() {
        // The text must be on its way to Drive before Android may stop the app. Wait for it, but not for long.
        val flushed = CountDownLatch(1)
        sessionHandler.post {
            session.onPause()
            flushed.countDown()
        }
        flushed.await(PAUSE_WAIT_MS, TimeUnit.MILLISECONDS)
        super.onPause()
    }

    override fun onDestroy() {
        destroyed = true
        sessionThread.quitSafely()
        webView.destroy()
        super.onDestroy()
    }

    /** "Open with" from Drive or a file manager. The permission lasts only as long as this activity. */
    private fun handleIntent(intent: Intent?) {
        val uri = intent?.data ?: return
        if (intent.action != Intent.ACTION_VIEW && intent.action != Intent.ACTION_EDIT) return
        val canWrite = intent.flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0
        onSession { openUri(uri.toString(), canWrite, fromPicker = false) }
    }

    /** Called on the session thread. */
    private fun emit(event: JSONObject) {
        val script = "window.pilcrow&&window.pilcrow.dispatch(${JSONObject.quote(event.toString())})"
        runOnUiThread { if (!destroyed) webView.evaluateJavascript(script, null) }
    }

    // ---- Session.Effects: called on the session thread, done on the main thread ----

    override fun launchPicker(initialUri: String?) = runOnUiThread {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("text/markdown", "text/x-markdown", "text/plain", "application/octet-stream"))
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
            )
            if (initialUri != null) putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(initialUri))
        }
        if (!destroyed) pickDocument.launch(intent)
    }

    override fun launchCreate(suggestedName: String) = runOnUiThread {
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "text/markdown"
            putExtra(Intent.EXTRA_TITLE, suggestedName)
        }
        if (!destroyed) createDocument.launch(intent)
    }

    override fun openUrl(url: String) = runOnUiThread {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: Exception) {
            // No browser: nothing to do.
        }
    }

    override fun copyText(text: String) = runOnUiThread {
        getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Pilcrow draft", text))
    }

    // Not named finish(): Activity.finish() must run on the main thread, and this is called on the session's.
    override fun closeApp() = runOnUiThread { finish() }

    private companion object {
        const val START_URL = "https://appassets.androidplatform.net/editor/index.html"
        const val PREF_VIEW_MODE = "viewMode"
        const val PAUSE_WAIT_MS = 1500L
    }
}
