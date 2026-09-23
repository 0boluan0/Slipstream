#!/usr/bin/env swift

// OCR_VERSION: increment this when the Swift source changes to force recompilation
let OCR_VERSION = 6

import Vision
import AppKit
import Foundation
import CoreGraphics

struct FrontWindow: Codable {
    let bundleId: String
    let title: String
}

func frontWindow() -> FrontWindow? {
    guard let app = NSWorkspace.shared.frontmostApplication,
          let bundleId = app.bundleIdentifier,
          let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]] else { return nil }
    for window in windows {
        guard (window[kCGWindowOwnerPID as String] as? Int32) == app.processIdentifier,
              (window[kCGWindowLayer as String] as? Int) == 0,
              let title = window[kCGWindowName as String] as? String,
              !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
        return FrontWindow(bundleId: bundleId, title: title)
    }
    return nil
}

// MARK: - JSON output structures

struct BoundingBox: Codable {
    let x: Double
    let y: Double
    let w: Double
    let h: Double
}

struct Block: Codable {
    let text: String
    let confidence: Double
    let boundingBox: BoundingBox
    let characters: [CharacterBox]?
}

struct CharacterBox: Codable {
    let text: String
    let boundingBox: BoundingBox
}

struct Output: Codable {
    let text: String?
    let confidence: Double?
    let blocks: [Block]?
    let error: String?

    init(text: String, confidence: Double, blocks: [Block]) {
        self.text = text
        self.confidence = confidence
        self.blocks = blocks
        self.error = nil
    }

    init(error: String) {
        self.text = nil
        self.confidence = nil
        self.blocks = nil
        self.error = error
    }
}

// MARK: - Entry point

func main() {
    if CommandLine.arguments.dropFirst().first == "--front-window" {
        print(encodeJSON(frontWindow()))
        return
    }
    guard CommandLine.arguments.count > 1 else {
        let output = Output(error: "No image path provided")
        print(encodeJSON(output))
        exit(1)
    }

    let imagePath = CommandLine.arguments[1]
    let imageURL = URL(fileURLWithPath: imagePath)

    guard let image = NSImage(contentsOf: imageURL) else {
        let output = Output(error: "Failed to load image at path: \(imagePath)")
        print(encodeJSON(output))
        exit(1)
    }

    guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        let output = Output(error: "Failed to convert NSImage to CGImage")
        print(encodeJSON(output))
        exit(1)
    }

    // Tight reading captures can make Vision drop letters at the page edge.
    // Give the text detector breathing room, then map every box back to the
    // original screenshot so inline formula replacement still uses its pixels.
    var recognitionImage = cgImage
    var margin = 0
    if CommandLine.arguments.contains("--pad-edges") {
        let padding = max(8, Int((Double(cgImage.width) * 0.025).rounded()))
        if let context = CGContext(data: nil, width: cgImage.width + padding * 2,
            height: cgImage.height + padding * 2, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) {
            context.setFillColor(CGColor(gray: 1, alpha: 1))
            context.fill(CGRect(x: 0, y: 0, width: context.width, height: context.height))
            context.draw(cgImage, in: CGRect(x: padding, y: padding, width: cgImage.width, height: cgImage.height))
            if let padded = context.makeImage() { recognitionImage = padded; margin = padding }
        }
    }
    func sourceBox(_ rect: CGRect) -> BoundingBox {
        let x = Double(rect.minX) * Double(recognitionImage.width) - Double(margin)
        let y = Double(rect.minY) * Double(recognitionImage.height) - Double(margin)
        return BoundingBox(x: x / Double(cgImage.width), y: y / Double(cgImage.height),
            w: Double(rect.width) * Double(recognitionImage.width) / Double(cgImage.width),
            h: Double(rect.height) * Double(recognitionImage.height) / Double(cgImage.height))
    }

    let request = VNRecognizeTextRequest { request, error in
        if let error = error {
            let output = Output(error: "Vision recognition failed: \(error.localizedDescription)")
            print(encodeJSON(output))
            exit(1)
        }

        guard let observations = request.results as? [VNRecognizedTextObservation] else {
            let output = Output(error: "No text observations returned")
            print(encodeJSON(output))
            exit(1)
        }

        var blocks: [Block] = []
        var totalConfidence: Double = 0
        var allText: [String] = []

        for observation in observations {
            guard let topCandidate = observation.topCandidates(1).first else { continue }

            let text = topCandidate.string
            let confidence = Double(topCandidate.confidence)
            let box = observation.boundingBox

            let boundingBox = sourceBox(box)

            // Formula masking can leave two prose fragments in one Vision line.
            // Character positions let the caller insert inline LaTeX between them.
            var characters: [CharacterBox]? = nil
            if CommandLine.arguments.contains("--characters") {
                characters = []
                for index in text.indices {
                    let end = text.index(after: index)
                    guard let rect = try? topCandidate.boundingBox(for: index..<end)?.boundingBox else { continue }
                    characters?.append(CharacterBox(text: String(text[index]), boundingBox: sourceBox(rect)))
                }
            }

            blocks.append(Block(
                text: text,
                confidence: confidence,
                boundingBox: boundingBox,
                characters: characters
            ))

            allText.append(text)
            totalConfidence += confidence
        }

        let avgConfidence = blocks.isEmpty ? 0.0 : totalConfidence / Double(blocks.count)
        let output = Output(
            text: allText.joined(separator: "\n"),
            confidence: avgConfidence,
            blocks: blocks
        )
        print(encodeJSON(output))
    }

    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    let preferredLanguages = [
        "en-US", "zh-Hans", "zh-Hant",
        "ja-JP", "ko-KR",
        "fr-FR", "de-DE", "es-ES", "it-IT", "pt-BR",
        "ru-RU", "ar-SA", "th-TH", "vi-VN"
    ]
    if let supportedLanguages = try? request.supportedRecognitionLanguages() {
        let supported = Set(supportedLanguages)
        let enabledLanguages = preferredLanguages.filter { supported.contains($0) }
        if !enabledLanguages.isEmpty {
            request.recognitionLanguages = enabledLanguages
        }
    } else {
        request.recognitionLanguages = ["en-US", "zh-Hans", "zh-Hant", "ja-JP", "ko-KR"]
    }

    let handler = VNImageRequestHandler(cgImage: recognitionImage, options: [:])

    do {
        try handler.perform([request])
    } catch {
        let output = Output(error: "Failed to perform Vision request: \(error.localizedDescription)")
        print(encodeJSON(output))
        exit(1)
    }
}

// MARK: - JSON encoding helper

func encodeJSON(_ value: some Encodable) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    guard let data = try? encoder.encode(value),
          let str = String(data: data, encoding: .utf8) else {
        return #"{"error":"Failed to encode JSON output"}"#
    }
    return str
}

main()
