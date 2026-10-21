import AppKit
import Foundation

let app = NSApplication.shared
app.setActivationPolicy(.regular)
app.finishLaunching()
let panel = NSOpenPanel()
let choosingFile = CommandLine.arguments.count > 2 && CommandLine.arguments[2] == "file"
panel.title = choosingFile ? "Open file" : "Open folder"
panel.message = choosingFile ? "Choose a file to review in MarkAtlas." : "Choose a folder to browse in MarkAtlas."
panel.prompt = "Open"
panel.canChooseDirectories = !choosingFile
panel.canChooseFiles = choosingFile
panel.allowsMultipleSelection = false
panel.canCreateDirectories = false
let pointer = NSEvent.mouseLocation
let chooserScreen = NSScreen.screens.first(where: { NSMouseInRect(pointer, $0.frame, false) }) ?? NSScreen.main
func centerChooser() {
    guard let screen = chooserScreen else { panel.center(); return }
    let available = screen.visibleFrame
    panel.setFrameOrigin(NSPoint(x: available.midX - panel.frame.width / 2,
                                y: available.midY - panel.frame.height / 2))
}
func bringForward() {
    app.activate(ignoringOtherApps: true)
    panel.makeKeyAndOrderFront(nil)
    panel.orderFrontRegardless()
}
let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : nil
let expires = Date().addingTimeInterval(180)
var timedOut = false
let focusTimer = Timer(timeInterval: 0.25, repeats: true) { _ in
    if Date() >= expires { timedOut = true; panel.cancel(nil); return }
    if let output = output, FileManager.default.fileExists(atPath: output + ".focus") {
        try? FileManager.default.removeItem(atPath: output + ".focus")
        bringForward()
    }
}
RunLoop.main.add(focusTimer, forMode: .common)
RunLoop.main.add(focusTimer, forMode: .modalPanel)
// Reposition after AppKit has laid out the native chooser at its final size.
DispatchQueue.main.async { centerChooser(); bringForward() }
centerChooser()
bringForward()
let result: [String: Any]
if panel.runModal() == .OK, let url = panel.url {
    result = ["path": url.path]
} else {
    result = ["cancelled": true, "timedOut": timedOut]
}
let data = try JSONSerialization.data(withJSONObject: result)
focusTimer.invalidate()
if CommandLine.arguments.count > 1 {
    try data.write(to: URL(fileURLWithPath: CommandLine.arguments[1]), options: .atomic)
} else {
    FileHandle.standardOutput.write(data)
}
