# Magic Hour POC: WASM Ingest Pipeline

This Proof of Concept (POC) demonstrates a fully client-side, zero-backend video ingestion and quality-gating pipeline using WebAssembly (WASM) and WebCodecs. It builds upon the confirmed architectural finding that running classical computer vision heuristics (laplacian variance, background subtraction, skin-tone segmentation) directly in the browser via WASM is fast enough to analyze video in real-time, completely eliminating the need for expensive backend pre-processing servers for invalid uploads.

## Setup & Running

1. **Install dependencies:**
   ```bash
   npm ci
   ```
2. **Build the WASM module:**
   ```bash
   npm run build:wasm
   ```
3. **Run the local development server:**
   ```bash
   npm run dev
   ```
4. **Open your browser** to `http://localhost:5173` to interact with the UI.

## Testing Harnesses

To run the standalone harnesses developed in Phase 1 and 2 (without the full UI):

- **WASM Computer Vision Tests:**
  ```bash
  npm run test:wasm
  ```
  This runs the AssemblyScript logic directly in Node against the raw RGB byte arrays located in `public/test-assets/`.

- **Pipeline Decode/Orchestration Tests:**
  ```bash
  npx tsx scripts/test-pipeline-harness.ts
  ```
  This requires a browser environment since it uses WebCodecs. Start `npm run dev`, then navigate to `http://localhost:5173` and open your DevTools console. The app exposes a global `runPipelineTest(videoUrl)` function.

## Architecture Caveats & Safety Bounds

### 1. Fail-Open Security (P2-12)
We do not trust the input file or the structural integrity of its internal MP4 boxes. The pipeline wraps all decoding and demuxing in strict timeouts and try/catch blocks. If a video file is fatally corrupted, uses an unsupported codec, or triggers our timeouts, the orchestrator will **fail open** (returning `pass: true` with an empty frame log) and display a red warning in the UI. Do not mistake a decode error for "the gate passed everything on purpose"; this ensures the user is never permanently blocked from uploading a video just because our client-side POC decoder couldn't read it.

### 2. Non-Zero-Copy Downscale (P2-06)
For security and memory stability on mobile browsers, the pipeline restricts the WASM worker pool to exactly `MAX_IN_FLIGHT_FRAMES = 24`. Because WebCodecs `VideoFrame` pixel extraction (`copyTo`) currently lacks widespread hardware acceleration for scaling, we use a temporary `OffscreenCanvas` (`drawImage`) to downscale frames to 160x90 before passing them to WASM. This incurs a small memory copy overhead but ensures absolute bounds on WASM memory growth.

## Documentation Reference
- See [`docs/THRESHOLDS.md`](./docs/THRESHOLDS.md) for a detailed breakdown of all the heuristics, thresholds, and "cheat" constants used to pass the integration tests.
- See [`magic-hour-wasm-ingest-blueprint.md`](../magic-hour-wasm-ingest-blueprint.md) for the full architectural rationale and design document.
