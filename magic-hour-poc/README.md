# Magic Hour POC: WASM Ingest Pipeline

## Architecture & Build Process

### WASM Compilation and Serving
The core computer vision logic is written in AssemblyScript and compiled to WebAssembly. 

**Security Bounds**: Strict input file size limits, timeouts, and max memory bounds are enforced to prevent browser crashes.

**Fail-Open Design**: If the pipeline encounters a fatally corrupted file, an unsupported codec, or a pathological box structure that triggers our timeouts, the ingest process will **fail open**. Instead of crashing the UI, the orchestrator will catch the error, log `"demux failed"` or `"decode failed"`, and return a clean `pass: true` verdict. This ensures the user is never permanently blocked from uploading a video just because our client-side POC decoder couldn't read it.

Because WebAssembly requires a `.wasm` binary to be explicitly served to the browser, we have configured the build pipeline as follows:

1. Running `npm run build:wasm` triggers the AssemblyScript compiler (`asc`).
2. The compiler outputs `build/scorer.wasm`.
3. The build script automatically copies this file into the `public/` directory (`public/scorer.wasm`).
4. Vite is configured (`vite.config.ts`) to use `public/` as its `publicDir`. This allows the browser to seamlessly fetch the binary via `fetch('/scorer.wasm')` at runtime using `WebAssembly.instantiateStreaming`.

*(Note: The test MP4 assets are also served from `public/test-assets/`.)*
