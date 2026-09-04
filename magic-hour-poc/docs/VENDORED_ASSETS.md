# Vendored Assets

This document tracks all third-party binary assets, models, and large dependencies that are committed directly to the repository rather than fetched via `npm` or a CDN, in accordance with our Threat Model (Rule 4.7).

All vendored assets must be manually verified, checksummed, and their licenses confirmed before checking them into version control.

### MediaPipe BlazeFace (Short Range)

*   **File:** `public/models/blaze_face_short_range.tflite`
*   **Description:** A lightweight, highly optimized model for detecting faces in the foreground (short-range). Used as the core ML face detection model.
*   **Source URL:** `https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`
*   **Version:** `float16/1` (Downloaded via the official MediaPipe models bucket).
*   **Fetch Date:** September 4, 2026
*   **SHA-256 Checksum:** `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f`
*   **License:** [Apache License 2.0](https://github.com/google/mediapipe/blob/master/LICENSE)

---
