import Cocoa
import FlutterMacOS

@main
class AppDelegate: FlutterAppDelegate {
  var window: NSWindow?

  override func applicationDidFinishLaunching(_ aNotification: Notification) {
    let flutterViewController = FlutterViewController()
    RegisterGeneratedPlugins(registry: flutterViewController)

    let window = NSWindow(
      contentRect: NSRect(x: 100, y: 100, width: 1280, height: 800),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "Tenveo PC500 Studio Link"
    window.contentViewController = flutterViewController
    window.makeKeyAndOrderFront(nil)
    self.window = window

    super.applicationDidFinishLaunching(aNotification)
  }

  override func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    return true
  }
}
