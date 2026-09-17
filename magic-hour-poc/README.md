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

