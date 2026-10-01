// Integration test of the bundled lyric page using Apple's actual WebKit engine.
// Only synthetic lyrics are loaded. No network requests or user media.
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import WebKit

@MainActor
final class LyricHarness: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    var web: WKWebView!
#if os(macOS)
    var window: NSWindow!
#else
    var window: UIWindow!
#endif
    var ready = false
    var seek = false
    var cycles = 0
    var errors: [String] = []
    let output: URL

    init(output: URL) {
        self.output = output
        super.init()
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "lyrics")
        let bridge = """
        window.ReactNativeWebView={postMessage:function(message){window.webkit.messageHandlers.lyrics.postMessage(message)}};
        function reportCallbackError(error,phase){window.webkit.messageHandlers.lyrics.postMessage(JSON.stringify({type:'diagnostic',phase:phase,message:String(error),stack:error && error.stack}))}
        var nativeRaf=window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame=function(callback){return nativeRaf(function(time){try{callback(time)}catch(error){reportCallbackError(error,'animation')}})};
        var NativeObserver=window.ResizeObserver;
        window.ResizeObserver=class extends NativeObserver{constructor(callback){super(function(entries,observer){try{callback(entries,observer)}catch(error){reportCallbackError(error,'resize')}})}};
        window.addEventListener('error',function(e){window.webkit.messageHandlers.lyrics.postMessage(JSON.stringify({type:'diagnostic',message:e.message || 'unknown',stack:e.error && e.error.stack}))});
        window.addEventListener('unhandledrejection',function(e){window.webkit.messageHandlers.lyrics.postMessage(JSON.stringify({type:'diagnostic',message:String(e.reason),stack:e.reason && e.reason.stack}))});
        """
        config.userContentController.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 640), configuration: config)
        web.navigationDelegate = self
#if os(macOS)
        window = NSWindow(contentRect: web.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = web
        window.orderFrontRegardless()
#else
        window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 640))
        let controller = UIViewController()
        controller.view = web
        window.rootViewController = controller
        window.makeKeyAndVisible()
#endif
    }

    func fail(_ message: String) -> Never {
        print("WEBKIT FAILURE: \(message)")
        fflush(stdout)
        exit(1)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let text = message.body as? String,
              let data = text.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        print("WEBKIT MESSAGE: \(text)")
        switch value["type"] as? String {
        case "diagnostic": errors.append(text)
        case "error": errors.append(text)
        case "seek": seek = value["time"] as? Int == 1000
        case "ready":
            guard !ready else { return }
            ready = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.exercise() }
        default: break
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url?.absoluteString ?? ""
        print("WEBKIT NAVIGATION: \(url)")
        // Matches the app: allow the local inline document, reject external navigation.
        decisionHandler(url == "about:blank" ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error.localizedDescription) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error.localizedDescription) }

    func exercise() {
        let fixture = """
        window.receiveLyrics({type:'theme',dark:false,reducedMotion:false});
        window.receiveLyrics({type:'lines',position:1200,lines:[
        {startTime:1000,endTime:3500,isBG:false,isDuet:false,translatedLyric:'Morning light',romanLyric:'',words:[{word:'晨光',startTime:1200,endTime:2300},{word:' ',startTime:2300,endTime:2300},{word:'照亮',startTime:2300,endTime:3500}]},
        {startTime:4000,endTime:8000,isBG:false,isDuet:false,translatedLyric:'Walking slowly',romanLyric:'',words:[{word:'慢慢向前走',startTime:4000,endTime:4000}]}
        ]});
        window.receiveLyrics({type:'clock',state:{position:1200,duration:8000,playing:true,active:true}});
        true;
        """
        web.evaluateJavaScript(fixture) { _, error in
            if let error = error { self.fail("Native JS bridge: \(error)") }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.check() }
        }
    }

    func check() {
        let script = """
        var row=document.querySelector('[class*="_lyricLineWrapper"]:not([class*="_bottomLineWrapper"])');
        if(row)row.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        window.receiveLyrics({type:'clock',state:{position:1500,duration:8000,playing:false,active:false}});
        var rows=Array.from(document.querySelectorAll('[class*="_lyricLineWrapper"]:not([class*="_bottomLineWrapper"])'));
        var fallback=rows.find(function(r){return r.textContent.includes('慢慢向前走')});
        var timed=rows.find(function(r){return r.textContent.includes('晨光')});
        var spacePlain=!!timed && Array.from(timed.children[0].childNodes).some(function(n){return n.nodeType===3 && n.textContent===' '}) && !Array.from(timed.children[0].querySelectorAll('span')).some(function(n){return n.textContent.length>0 && !n.textContent.trim()});
        ({text:document.getElementById('lyrics').textContent,theme:document.documentElement.dataset.theme,spacePlain:spacePlain,fallbackPlain:!!fallback && fallback.children[0].querySelectorAll('span').length===0});
        """
        web.evaluateJavaScript(script) { result, error in
            if let error = error { self.fail("DOM assertions: \(error)") }
            guard let result = result as? [String: Any], let text = result["text"] as? String,
                  text.contains("晨光"), text.contains("Morning light"), result["theme"] as? String == "light" else { self.fail("Lyrics not rendered: \(String(describing: result))") }
            guard self.seek else { self.fail("Click did not reach the native bridge") }
            guard result["fallbackPlain"] as? Bool == true else { self.fail("Untimed mixed row acquired inferred word masks") }
            guard result["spacePlain"] as? Bool == true else { self.fail("Zero-duration source space was removed or animated") }
            guard self.errors.isEmpty else { self.fail("Page errors: \(self.errors)") }
            self.cycles += 1
            if self.cycles < 3 {
                self.seek = false
                self.exercise()
                return
            }
            self.web.takeSnapshot(with: nil) { image, error in
#if os(macOS)
                if let image = image, let tiff = image.tiffRepresentation,
                   let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) {
                    try? png.write(to: self.output)
                }
#else
                if let png = image?.pngData() { try? png.write(to: self.output) }
#endif
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                    guard self.seek else { self.fail("Click did not reach the native bridge") }
                    guard self.errors.isEmpty else { self.fail("Page errors: \(self.errors)") }
                    print("WEBKIT PASSED: ready, native injection, rendered lyrics/translation, theme, seek and snapshot across 3 reload/sync cycles")
                    fflush(stdout)
                    exit(0)
                }
            }
        }
    }
}

#if os(macOS)
@main
struct Main {
    @MainActor static func main() throws {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let args = CommandLine.arguments
        if args.count != 3 { print("Usage: test-lyrics-webkit HTML SNAPSHOT"); exit(2) }
        let harness = LyricHarness(output: URL(fileURLWithPath: args[2]))
        let html = try String(contentsOfFile: args[1], encoding: .utf8)
        harness.web.loadHTMLString(html, baseURL: URL(string: "about:blank"))
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { harness.fail("Timed out; ready=\(harness.ready), errors=\(harness.errors)") }
        RunLoop.main.run()
    }
}

#else
@main
@MainActor
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var harness: LyricHarness!
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        print("WEBKIT IOS STARTING")
        fflush(stdout)
        let path = Bundle.main.url(forResource: "lyrics", withExtension: "html")!
        harness = LyricHarness(output: URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Documents/lyrics-webkit.png"))
        let html = try! String(contentsOf: path, encoding: .utf8)
        harness.web.loadHTMLString(html, baseURL: URL(string: "about:blank"))
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { self.harness.fail("Timed out; ready=\(self.harness.ready), errors=\(self.harness.errors)") }
        return true
    }
}
#endif
