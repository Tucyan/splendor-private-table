package xyz.taskstream.splendor;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public final class MainActivity extends Activity {
    private static final String START_URL = "https://taskstream.xyz/splendor/";
    private WebView webView;

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.evaluateJavascript("(function(){"
                    + "document.addEventListener('copy',function(e){e.preventDefault();},true);"
                    + "document.addEventListener('cut',function(e){e.preventDefault();},true);"
                    + "document.addEventListener('contextmenu',function(e){e.preventDefault();},true);"
                    + "document.documentElement.style.webkitUserSelect='none';"
                    + "var c=navigator.clipboard;"
                    + "if(c){try{c.writeText=function(){return Promise.reject(new DOMException('Clipboard disabled','NotAllowedError'));};c.write=function(){return Promise.reject(new DOMException('Clipboard disabled','NotAllowedError'));};}catch(e){}}"
                    + "var removeCopy=function(){document.querySelectorAll('[data-do=copy],[data-do=invite],.room-code').forEach(function(e){e.remove();});};"
                    + "removeCopy();new MutationObserver(removeCopy).observe(document.documentElement,{childList:true,subtree:true});"
                    + "})();", null);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !request.getUrl().toString().startsWith("https://taskstream.xyz/");
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        webView.setBackgroundColor(0xff17282d);
        setContentView(webView);

        if (savedInstanceState == null) {
            webView.loadUrl(START_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
