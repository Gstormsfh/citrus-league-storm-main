// Offline full-body detections on saved, timestamped broadcast frames.
// Usage: swift detect_review_bodies.swift landmark-directory new-output.json
import Foundation
import Vision
import CryptoKit

let args = CommandLine.arguments
guard args.count == 3 else { fatalError("Expected landmark directory and new output JSON") }
let root = URL(fileURLWithPath: args[1], isDirectory: true)
let destination = URL(fileURLWithPath: args[2])
guard !FileManager.default.fileExists(atPath: destination.path) else { fatalError("Output already exists") }
let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("index.json"))) as! [String: Any]
var frames = [[String: Any]]()
for frame in manifest["frames"] as! [[String: Any]] {
    let url = root.appendingPathComponent(frame["file"] as! String)
    let bytes = try Data(contentsOf: url)
    let digest = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    guard digest == frame["sha256"] as! String else { fatalError("Frame hash mismatch") }
    let request = VNDetectHumanRectanglesRequest()
    request.revision = VNDetectHumanRectanglesRequestRevision2
    request.upperBodyOnly = false
    try VNImageRequestHandler(url: url, options: [:]).perform([request])
    let boxes: [[String: Any]] = (request.results ?? []).map { observation in
        let b = observation.boundingBox
        return ["x": b.minX, "y": 1 - b.maxY, "width": b.width, "height": b.height,
                "detector_score": observation.confidence]
    }
    frames.append(["file": frame["file"]!, "video_pts_seconds": frame["video_pts_seconds"]!,
                   "sha256": digest, "bodies": boxes,
                   "possession_status": "unknown_no_video_puck_or_stick_detection"])
}
let result: [String: Any] = ["schema_version": 1, "detector": "Apple Vision VNDetectHumanRectanglesRequest revision 2 full body",
    "operating_system": ProcessInfo.processInfo.operatingSystemVersionString,
    "coordinates": "normalized top-left image coordinates", "video_sha256": manifest["video_sha256"]!,
    "frames": frames, "production_eligible": false,
    "limitations": ["Generic person detector, not hockey-trained", "Includes officials and possible spectators", "No player identity or possession established"]]
try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]).write(to: destination, options: .withoutOverwriting)
print("Processed \(frames.count) saved frames; actual image-based body detections exported.")
