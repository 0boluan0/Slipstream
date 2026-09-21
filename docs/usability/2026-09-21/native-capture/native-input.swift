import Foundation
import ApplicationServices
import AppKit

// A temporary, bounded input driver for the installed Slipstream acceptance test.
// Default mode only describes the requested input. --execute is required to post.
let arguments = Array(CommandLine.arguments.dropFirst())
let execute = arguments.first == "--execute"
let command = execute ? Array(arguments.dropFirst()) : arguments
guard let action = command.first, ["capture-shortcut", "capture-region", "capture-cancel", "escape", "drag", "window-bounds"].contains(action) else {
    fatalError("Usage: native-input [--execute] capture-shortcut|escape|drag x1 y1 x2 y2|window-bounds")
}
if !execute {
    print("DRY RUN: \(command.joined(separator: " ")); no input sent")
    exit(0)
}
if action == "window-bounds" {
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    print("frontmost=" + (NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "unknown"))
    for (index, window) in windows.enumerated() {
        if index < 14 { print("z=\(index) owner=\(window[kCGWindowOwnerName as String] ?? "") layer=\(window[kCGWindowLayer as String] ?? "")") }
        let owner = window[kCGWindowOwnerName as String] as? String ?? ""
        guard owner == "Preview" || owner == "Slipstream" || owner == "screencapture" else { continue }
        let filtered = window.filter { [kCGWindowOwnerName, kCGWindowName, kCGWindowBounds, kCGWindowNumber, kCGWindowLayer].map { $0 as String }.contains($0.key) }
        let json = try JSONSerialization.data(withJSONObject: filtered, options: [.sortedKeys])
        print(String(decoding: json, as: UTF8.self))
    }
    exit(0)
}
guard AXIsProcessTrusted() else { fatalError("Input driver lacks existing Accessibility trust; no permission prompt requested") }
guard let source = CGEventSource(stateID: .hidSystemState) else { fatalError("No input source") }
func key(_ code: CGKeyCode, flags: CGEventFlags = []) {
    for down in [true, false] {
        let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)!
        event.flags = down ? flags : []
        event.post(tap: .cghidEventTap)
        usleep(70_000)
    }
}
switch action {
case "capture-shortcut": key(1, flags: [.maskAlternate, .maskShift])
case "escape": key(53)
case "capture-region", "capture-cancel", "drag":
    if action != "drag" {
        guard let preview = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Preview").first else { fatalError("Preview must already be running") }
        _ = preview
        let foreground = Process(); foreground.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        foreground.arguments = ["-a", "Preview"]
        try foreground.run(); foreground.waitUntilExit()
        for _ in 0..<15 {
            if NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.apple.Preview" { break }
            usleep(100_000)
        }
        guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.apple.Preview" else { fatalError("Preview is not frontmost; no shortcut sent") }
        print("Verified foreground: com.apple.Preview")
        key(1, flags: [.maskAlternate, .maskShift])
        var selectors: [String] = []
        for _ in 0..<40 {
            let process = Process(); process.executableURL = URL(fileURLWithPath: "/bin/ps")
            process.arguments = ["-axo", "pid,ppid,comm"]
            let pipe = Pipe(); process.standardOutput = pipe
            try process.run()
            let data = pipe.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
            selectors = String(decoding: data, as: UTF8.self).split(separator: "\n").filter { $0.contains("/usr/sbin/screencapture") }.map(String.init)
            if !selectors.isEmpty { break }
            usleep(200_000)
        }
        guard selectors.count == 1 else { fatalError("Expected exactly one native capture selector before drag") }
        print("Selector: " + selectors[0])
        usleep(250_000)
    }
    if action == "capture-cancel" {
        key(53)
        print("Sent bounded input: capture shortcut then Escape")
        exit(0)
    }
    guard command.count == 5 else { fatalError("drag requires exactly four coordinates") }
    let values = command.dropFirst().compactMap(Double.init)
    guard values.count == 4, values.allSatisfy({ $0.isFinite && abs($0) < 20000 }) else { fatalError("Invalid coordinates") }
    let start = CGPoint(x: values[0], y: values[1])
    let end = CGPoint(x: values[2], y: values[3])
    func mouse(_ type: CGEventType, _ point: CGPoint) {
        CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left)!.post(tap: .cghidEventTap)
    }
    mouse(.mouseMoved, start); usleep(100_000)
    mouse(.leftMouseDown, start)
    for step in 1...24 {
        let t = Double(step) / 24
        mouse(.leftMouseDragged, CGPoint(x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t))
        usleep(25_000)
    }
    mouse(.leftMouseUp, end)
default: break
}
print("Sent bounded input: \(action)")
