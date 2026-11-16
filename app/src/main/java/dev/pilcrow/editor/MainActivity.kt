package dev.pilcrow.editor

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.Message
import android.provider.DocumentsContract
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
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
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
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
 *
 * Security: an HTML note runs in a frame of this WebView, so the bridge to Android must be out of its reach.
 * The bridge is offered only to the app's own page (its origin, in the main frame), and every message is checked
 * again on arrival. The HTML page is served from another address, sandboxed (see [PageServer]). Where this
 * WebView is too old to limit the bridge by origin, the old bridge is used and HTML pages run no scripts at all.
 */
class MainActivity : ComponentActivity(), Session.Effects {

    private lateinit var webView: WebView
    private lateinit var session: Session
    private val pages = PageServer()
    /** Whether HTML pages may run their scripts: only when the bridge is kept from them. */
    private var pageScripts = false
    private val sessionThread = HandlerThread("pilcrow-session").apply { start() }
    private val sessionHandler = Handler(sessionThread.looper)
    @Volatile private var destroyed = false

    private fun onSession(block: Session.() -> Unit) {
        sessionHandler.post { session.block() }
    }

    private val pickDocument = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uri = result.data?.data
        if (result.resultCode == RESULT_OK && uri != null) onSession { openUri(uri.toString(), canWrite = true, fromPicker = true) } else onSession { onPickCancelled() }
    }

    private val createDocument = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uri = result.data?.data
        if (result.resultCode == RESULT_OK && uri != null) onSession { onCreated(uri.toString()) } else onSession { onCreateCancelled() }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Remote inspection of the editor is for debug builds only, never for a released app.
        WebView.setWebContentsDebuggingEnabled(applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)

        session = Session(
            store = SafDocumentStore(applicationContext),
            drafts = DraftStore(File(filesDir, "drafts")) { System.currentTimeMillis() },
            recents = RecentsStore(File(filesDir, "recents.json")),
            scheduler = HandlerScheduler(sessionHandler),
            now = { System.currentTimeMillis() },
            emit = ::emit,
            effects = this,
            settings = PrefsSettings(getPreferences(MODE_PRIVATE)),
            pause = { ms -> Thread.sleep(ms) },
        )

        val assets = WebViewAssetLoader.Builder()
            // The handler serves the APK's assets folder: /assets/editor/index.html is assets/editor/index.html.
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            setBackgroundColor(getColor(R.color.paper))
            overScrollMode = WebView.OVER_SCROLL_NEVER
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.textZoom = 100
            // A link on an HTML page asks for a new window; onCreateWindow turns that into the browser.
            settings.setSupportMultipleWindows(true)
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    val url = request.url
                    pages.serve(url.scheme, url.host, url.path)?.let { page ->
                        return WebResourceResponse(page.mime, page.encoding, page.status, page.reason, page.headers, page.body.inputStream())
                    }
                    return assets.shouldInterceptRequest(url)
                }

                // The app is one page, and the HTML frame shows only pages from the page server.
                // Links are opened by the session or by onCreateWindow, in the browser.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    request.isForMainFrame || request.url.host != PageServer.HOST
            }
            webChromeClient = object : WebChromeClient() {
                override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
                    // A page may not open anything by itself: only a tap opens the browser.
                    if (!isUserGesture) return false
                    val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false
                    transport.webView = linkCatcher()
                    resultMsg.sendToTarget()
                    return true
                }
            }
        }
        connectBridge(Bridge(::onSession) { ref, html -> showPage(ref, html) })

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

    /**
     * "Open with" from Drive or a file manager. The session asks to keep access; Drive usually lends the file
     * only until this activity finishes, and the note then asks to be found once in the picker.
     */
    private fun handleIntent(intent: Intent?) {
        val uri = intent?.data ?: return
        if (intent.action != Intent.ACTION_VIEW && intent.action != Intent.ACTION_EDIT) return
        val canWrite = intent.flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0
        onSession { openUri(uri.toString(), canWrite, fromPicker = false) }
    }

    /**
     * Gives the bridge to the app's page only. With the web message listener, Android injects PilcrowNative into
     * frames from the app's origin; the check below also refuses anything not sent by the main frame.
     */
    private fun connectBridge(bridge: Bridge) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "PilcrowNative", setOf(PageServer.APP_ORIGIN)) { _, message, origin, isMainFrame, _ ->
                val data = message.data
                if (isMainFrame && "${origin.scheme}://${origin.host}" == PageServer.APP_ORIGIN && origin.port == -1 && data != null) bridge.receive(data)
            }
            pageScripts = true
        } else {
            // This bridge reaches every frame, so HTML pages get no scripts (PageServer sandboxes them without).
            webView.addJavascriptInterface(JsPort(bridge), "PilcrowNative")
            pageScripts = false
        }
    }

    /** The old bridge, for WebViews without the web message listener. */
    private class JsPort(private val bridge: Bridge) {
        @JavascriptInterface fun postMessage(message: String) {
            bridge.receive(message)
        }
    }

    /** Keeps an HTML page to show and tells the web app where it is. Any thread. */
    private fun showPage(ref: String, html: String) {
        val url = pages.prepare(html, pageScripts)
        emit(JSONObject().put("type", "page").put("ref", ref).put("url", url).put("scripts", pageScripts))
    }

    /**
     * A window that is never shown: it takes the address a tapped link asked for, hands it to the browser and
     * goes away. It runs no scripts and gets no bridge.
     */
    private fun linkCatcher(): WebView = WebView(this).apply {
        settings.javaScriptEnabled = false
        webViewClient = object : WebViewClient() {
            private var taken = false

            private fun take(view: WebView, url: Uri) {
                if (taken) return
                taken = true
                if (url.host != PageServer.HOST) onSession { openUrl(url.toString()) }
                view.stopLoading()
                view.post { view.destroy() }
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                take(view, request.url)
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                if (url != null && url != "about:blank") take(view, Uri.parse(url))
            }
        }
    }

    /** Called on the session thread, and on others for pages. */
    private fun emit(event: JSONObject) {
        val script = "window.pilcrow&&window.pilcrow.dispatch(${JSONObject.quote(event.toString())})"
        runOnUiThread { if (!destroyed) webView.evaluateJavascript(script, null) }
    }

    // ---- Session.Effects: called on the session thread, done on the main thread ----

    override fun launchPicker(initialUri: String?) = runOnUiThread {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, (listOf("text/markdown", "text/x-markdown", "text/plain", "application/octet-stream") + DocKind.OTHER_TYPES).toTypedArray())
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
        const val START_URL = "https://appassets.androidplatform.net/assets/editor/index.html"
        const val PAUSE_WAIT_MS = 1500L
    }
}

/** The session's settings, in this activity's preferences. Safe to use from the session thread. */
private class PrefsSettings(private val prefs: SharedPreferences) : Session.Settings {
    override var viewMode: String
        get() = prefs.getString(VIEW_MODE, "formatted") ?: "formatted"
        set(value) = prefs.edit().putString(VIEW_MODE, value).apply()

    override var lineNumbers: Boolean
        get() = prefs.getBoolean(LINE_NUMBERS, false)
        set(value) = prefs.edit().putBoolean(LINE_NUMBERS, value).apply()

    private companion object {
        const val VIEW_MODE = "viewMode"
        const val LINE_NUMBERS = "lineNumbers"
    }
}
