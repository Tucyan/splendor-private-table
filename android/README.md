# 璀璨宝石 Android 壳

这是一个最小原生 WebView 封装，加载线上牌桌 `https://taskstream.xyz/splendor/`，游戏逻辑和 LLM 服务仍由服务器提供。

在 Windows PowerShell 中构建未签名 release APK：

```powershell
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-17.0.17.10-hotspot'
$env:ANDROID_SDK_ROOT = "$env:LOCALAPPDATA\Android\Sdk"
& "$env:USERPROFILE\.gradle\wrapper\dists\gradle-8.13-bin\5xuhj0ry160q40clulazy9h7d\gradle-8.13\bin\gradle.bat" -p android :app:assembleRelease
```

未签名产物位于 `android/app/build/outputs/apk/release/app-release-unsigned.apk`。

本地内测签名（使用 Android 默认 debug keystore，不提交证书）：

```powershell
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$apksigner = "$sdk\build-tools\37.0.0\apksigner.bat"
& $apksigner sign --ks "$env:USERPROFILE\.android\debug.keystore" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android --out android/app/build/outputs/apk/release/splendor-release.apk android/app/build/outputs/apk/release/app-release-unsigned.apk
```

签名后的内测 APK 位于 `android/app/build/outputs/apk/release/splendor-release.apk`。正式上架前应换成长期保管的发布证书。
