package io.arkreader.mobile

import android.app.Activity
import android.content.pm.ActivityInfo
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class PlayerModeArgs {
    var playing: Boolean = false
}

@TauriPlugin
class ArkReaderPlugin(private val activity: Activity) : Plugin(activity) {
    private var webView: WebView? = null
    private var playing = false
    private var originalOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED

    override fun load(webView: WebView) {
        this.webView = webView
        originalOrientation = activity.requestedOrientation
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false
        ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
            val edges = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val density = activity.resources.displayMetrics.density
            val detail = JSObject()
                .put("top", edges.top / density)
                .put("right", edges.right / density)
                .put("bottom", edges.bottom / density)
                .put("left", edges.left / density)
            webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('arkreader-insets',{detail:$detail}))", null)
            insets
        }
        (activity as? AppCompatActivity)?.let { host ->
            host.onBackPressedDispatcher.addCallback(
                host,
                object : OnBackPressedCallback(true) {
                    override fun handleOnBackPressed() {
                        webView.evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('arkreader-back',{cancelable:true}))"
                        ) { unhandled ->
                            if (unhandled != "false") activity.moveTaskToBack(true)
                        }
                    }
                }
            )
        }
        ViewCompat.requestApplyInsets(webView)
    }

    @Command
    fun paths(invoke: Invoke) {
        val result = JSObject()
        result.put("nativeLibraryDir", activity.applicationInfo.nativeLibraryDir)
        invoke.resolve(result)
    }

    @Command
    fun playerMode(invoke: Invoke) {
        val args = invoke.parseArgs(PlayerModeArgs::class.java)
        activity.runOnUiThread {
            playing = args.playing
            activity.requestedOrientation = if (playing) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else originalOrientation
            if (playing) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            updateBars()
            invoke.resolve()
        }
    }

    @Command
    fun insets(invoke: Invoke) {
        val edges = webView?.let { ViewCompat.getRootWindowInsets(it) }
            ?.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        val density = activity.resources.displayMetrics.density
        val result = JSObject()
        result.put("top", (edges?.top ?: 0) / density)
        result.put("right", (edges?.right ?: 0) / density)
        result.put("bottom", (edges?.bottom ?: 0) / density)
        result.put("left", (edges?.left ?: 0) / density)
        invoke.resolve(result)
    }

    private fun updateBars() {
        val view = webView ?: return
        val controller = WindowInsetsControllerCompat(activity.window, view)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.isAppearanceLightStatusBars = false
        if (playing) controller.hide(WindowInsetsCompat.Type.systemBars())
        else controller.show(WindowInsetsCompat.Type.systemBars())
        ViewCompat.requestApplyInsets(view)
    }

    override fun onPause(activity: AppCompatActivity) {
        webView?.evaluateJavascript("window.dispatchEvent(new Event('arkreader-native-background'))", null)
    }

    override fun onResume(activity: AppCompatActivity) {
        updateBars()
        webView?.evaluateJavascript("window.dispatchEvent(new Event('arkreader-native-foreground'))", null)
    }

    @Command
    fun quit(invoke: Invoke) {
        invoke.resolve()
        activity.runOnUiThread { activity.finishAndRemoveTask() }
    }
}
