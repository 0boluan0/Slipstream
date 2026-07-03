#!/usr/bin/env swift

// OCR_VERSION: increment this when the Swift source changes to force recompilation
let OCR_VERSION = 2

import Vision
import AppKit
import Foundation

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

            let boundingBox = BoundingBox(
                x: Double(box.origin.x),
                y: Double(box.origin.y),
                w: Double(box.size.width),
                h: Double(box.size.height)
            )

            blocks.append(Block(
                text: text,
                confidence: confidence,
                boundingBox: boundingBox
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
    request.recognitionLanguages = ["en-US", "zh-Hans"]

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

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
