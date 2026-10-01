#!/bin/bash
# Run the exact bundled renderer in an iOS simulator's WKWebView.
set -euo pipefail
CHECK_APP=/tmp/LyricsWebKitCheck.app
mkdir -p "$CHECK_APP"
SIMULATOR_ID=$(xcrun simctl list devices available -j | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next(v["udid"] for k,vs in d["devices"].items() if "iOS" in k for v in vs if "iPhone" in v["name"]))')
xcrun simctl boot "$SIMULATOR_ID" || true
xcrun simctl bootstatus "$SIMULATOR_ID" -b
xcrun swiftc -parse-as-library -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" -target arm64-apple-ios15.1-simulator scripts/test-lyrics-webkit.swift -o "$CHECK_APP/WebKitCheck"
cp src/components/lyrics/generated/lyrics.html "$CHECK_APP/lyrics.html"
cat > "$CHECK_APP/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.joymusic.lyrics.webkittest</string>
<key>CFBundleExecutable</key><string>WebKitCheck</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>UILaunchScreen</key><dict/>
<key>LSRequiresIPhoneOS</key><true/>
</dict></plist>
PLIST
codesign --force --sign - "$CHECK_APP"
xcrun simctl install "$SIMULATOR_ID" "$CHECK_APP"
xcrun simctl launch --console "$SIMULATOR_ID" dev.joymusic.lyrics.webkittest | tee /tmp/lyrics-ios.log
rg 'WEBKIT PASSED' /tmp/lyrics-ios.log
SIM_APP_DATA=$(xcrun simctl get_app_container "$SIMULATOR_ID" dev.joymusic.lyrics.webkittest data)
cp "$SIM_APP_DATA/Documents/lyrics-webkit.png" /tmp/lyrics-ios.png
