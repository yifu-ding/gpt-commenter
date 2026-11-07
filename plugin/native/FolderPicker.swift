import AppKit
import Foundation
import UniformTypeIdentifiers

let app = NSApplication.shared
app.setActivationPolicy(.regular)
app.finishLaunching()
let mode = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "folder"
let panel: NSSavePanel
if mode == "save" {
    let savePanel = NSSavePanel()
    savePanel.title = "Save comments"
    savePanel.message = "Choose where to save your complete comments as JSON."
    savePanel.nameFieldStringValue = "comments.json"
    savePanel.allowedContentTypes = [.json]
    savePanel.canCreateDirectories = true
    panel = savePanel
} else {
    let openPanel = NSOpenPanel()
    let choosingFile = mode == "file"
    openPanel.title = choosingFile ? "Open file" : "Open folder"
    openPanel.message = choosingFile ? "Choose a file to review in MarkAtlas." : "Choose a folder to browse in MarkAtlas."
    openPanel.prompt = "Open"
    openPanel.canChooseDirectories = !choosingFile
    openPanel.canChooseFiles = choosingFile
    openPanel.allowsMultipleSelection = false
    openPanel.canCreateDirectories = false
    panel = openPanel
}
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
