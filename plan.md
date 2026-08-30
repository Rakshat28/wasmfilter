# Magic Hour Pre-Generation Quality Gate — Agentic Build Task List

This document decomposes the POC (see `magic-hour-wasm-ingest-blueprint.md`) into small, independently completable tasks for an agentic coding workflow. Every task states exactly what file(s) to touch, exactly what goes in them, and exactly how to know it's done. Nothing is left for the agent to infer or design on its own — where a design decision was needed, it's made here.

---

## Global Conventions (apply to every task below)

- **No comments in any source file** — this is a hard project convention. Code should be self-explanatory through naming, not annotated.
- TypeScript: `strict: true` in `tsconfig.json`, no `any`, no implicit returns.
- Package manager: `npm`. Do not use `yarn` or `pnpm`.
- Bundler/dev server: **Vite**.
- All file paths below are relative to the project root, `magic-hour-poc/`.
- Do not add any dependency not explicitly listed in a task. If a task needs a package not yet installed, installing it is part of that task, not assumed.
- Do not implement anything from the "Investigated and set aside" section of the blueprint (no upload interception, no full-file processing, no bandwidth metrics). If a task here seems to imply that, it's a mistake in this doc — flag it rather than building it.
- Every task has an **Acceptance Criteria** line. A task is not done until that criteria is met and demonstrably checked (console output, visual confirmation, or a passing manual test step) — not just "code written."

---

## Final Directory Structure (reference — build toward this)

```
magic-hour-poc/
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  .gitignore
  README.md
  assembly/
    index.ts
    tsconfig.json
  build/
    scorer.wasm
  src/
    types.ts
    thresholds.ts
    loader.ts
    demux.ts
    decoder.ts
    worker.ts
    workerPool.ts
    orchestrator.ts
    main.ts
    ui/
      theme.css
      trimControls.ts
      metricsStrip.ts
      verdictPanel.ts
      sparkline.ts
      app.ts
  test-assets/
    clean-sample.mp4
    blurry-sample.mp4
    no-face-sample.mp4
    multi-face-sample.mp4
  docs/
    MEMORY_LAYOUT.md
    THRESHOLDS.md
```

---

## Phase 0 — Project Scaffolding

**P0-01. Initialize the npm project**
- Run `npm init -y` in a new `magic-hour-poc/` directory.
- Edit the generated `package.json`: set `"name": "magic-hour-poc"`, `"private": true`, `"type": "module"`.
- Acceptance: `package.json` exists with those three fields set.

**P0-02. Install Vite and set up the dev server**
- Run `npm install --save-dev vite`.
- Create `vite.config.ts` with a minimal config: `export default { root: '.', publicDir: 'test-assets' }`.
- Add to `package.json` `"scripts"`: `"dev": "vite"`, `"build": "vite build"`.
- Acceptance: `npm run dev` starts a dev server on a local port without error (an empty page is fine at this stage).

**P0-03. Create the root TypeScript config for the app code**
- Create `tsconfig.json` at project root with: `"strict": true`, `"target": "ES2022"`, `"module": "ESNext"`, `"moduleResolution": "Bundler"`, `"lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"]`, `"include": ["src"]`.
- Acceptance: `npx tsc --noEmit` runs against `src/` (even if `src/` is still empty, this should not error on config parsing).

**P0-04. Install AssemblyScript and scaffold the `assembly/` directory**
- Run `npm install --save-dev assemblyscript`.
- Run `npx asinit . -y` to scaffold. This will create/modify `assembly/index.ts`, `assembly/tsconfig.json`, and add `asbuild` scripts to `package.json`.
- Delete any example content `asinit` puts in `assembly/index.ts` — it should end this task as an empty file with no exports.
- Acceptance: `assembly/index.ts` exists and is empty (0 bytes or whitespace only); `assembly/tsconfig.json` exists.

**P0-05. Install `mp4box.js`**
- Run `npm install mp4box`.
- Acceptance: `mp4box` appears in `package.json` `"dependencies"`.

**P0-06. Create `.gitignore`**
- Contents:
  ```
  node_modules/
  build/*.wasm
  dist/
  .DS_Store
  ```
- Acceptance: file exists with exactly those four lines (plus a trailing newline).

**P0-07. Create the full empty directory structure**
- Create empty placeholder files so the structure exists (delete placeholders as later tasks fill them in for real): `src/types.ts`, `src/thresholds.ts`, `src/loader.ts`, `src/demux.ts`, `src/decoder.ts`, `src/worker.ts`, `src/workerPool.ts`, `src/orchestrator.ts`, `src/main.ts`, `src/ui/theme.css`, `src/ui/trimControls.ts`, `src/ui/metricsStrip.ts`, `src/ui/verdictPanel.ts`, `src/ui/sparkline.ts`, `src/ui/app.ts`, `docs/MEMORY_LAYOUT.md`, `docs/THRESHOLDS.md`.
- Acceptance: every path listed exists (empty is fine at this stage — later tasks populate each one specifically).

**P0-08. Obtain test video assets**
- Place four short (5-10s) MP4 files in `test-assets/`:
  - `clean-sample.mp4` — a single, clearly visible, well-lit, front-facing face.
  - `blurry-sample.mp4` — same kind of content, but out of focus or motion-blurred throughout.
  - `no-face-sample.mp4` — no face visible at all (e.g. a landscape or object).
  - `multi-face-sample.mp4` — two or more faces visible simultaneously.
- If no existing footage fits, generate them: record short clips on a phone for the first two, and use any existing multi-person or faceless footage for the other two. Blur can be produced from a clean clip via `ffmpeg -i clean-sample.mp4 -vf "boxblur=10:2" blurry-sample.mp4`.
- Acceptance: all four files exist in `test-assets/`, each playable, each roughly matching its description by eye.

---

## Phase 1 — AssemblyScript WASM Core

**P1-01. Define fixed analysis-resolution constants**
- In `assembly/index.ts`, add:
  ```typescript
  const ANALYSIS_WIDTH: i32 = 160;
  const ANALYSIS_HEIGHT: i32 = 90;
  const ANALYSIS_PIXEL_COUNT: i32 = ANALYSIS_WIDTH * ANALYSIS_HEIGHT;
  const ANALYSIS_BUFFER_BYTES: i32 = ANALYSIS_PIXEL_COUNT * 4;
  ```
- These are fixed because every frame passed into WASM will already have been downscaled to exactly this size in TS (see P2-06) — WASM never receives a variable-resolution buffer.
- Acceptance: constants present, exported types match `i32`.

**P1-02. Implement grayscale conversion as an internal helper**
- Add a non-exported function `toGray(rgba: usize, out: usize): void` that reads `ANALYSIS_PIXEL_COUNT` RGBA8 pixels starting at pointer `rgba`, and writes `ANALYSIS_PIXEL_COUNT` single-byte (`u8`) grayscale values to `out`, using `gray = 0.299*R + 0.587*G + 0.114*B` per pixel, truncated to `u8`.
- Acceptance: function compiles; no export needed yet, just an internal helper other functions in this phase will call.

**P1-03. Reserve static memory for the previous frame's grayscale buffer**
- Add a module-level static array (`ANALYSIS_PIXEL_COUNT` bytes) to hold the grayscale version of the *previous* scored frame, initialized to all zeros, plus a module-level `bool` flag `hasPreviousFrame` starting `false`.
- This is what `motionDelta` (P1-05) compares against, and it persists across calls within one WASM instance's lifetime (i.e., across the frames of one worker's assigned window — see P2-05 for how frames get distributed).
- Acceptance: static buffer and flag declared at module scope, correct size.

**P1-04. Implement `sharpness()`**
- Non-exported function `computeSharpness(gray: usize): f32`.
- Apply the discrete Laplacian kernel `[[0,1,0],[1,-4,1],[0,1,0]]` to the grayscale buffer at `gray` (treated as a flat `ANALYSIS_WIDTH x ANALYSIS_HEIGHT` array), skipping the 1-pixel border (no kernel applied there, or clamp to 0 — clamp to 0 for simplicity).
- Compute the variance of the resulting Laplacian-response values across all interior pixels. Return that variance as `f32`. Higher variance = sharper image; near-zero variance = blurry/flat image.
- Acceptance: function compiles and returns a plausible non-negative float for a hand-constructed test buffer (verified in P1-09).

**P1-05. Implement `motionDelta()`**
- Non-exported function `computeMotionDelta(gray: usize): f32`.
- If `hasPreviousFrame` is `false`, return `0.0` and skip comparison (this only happens for the very first frame scored by a given worker).
- Otherwise, compute the mean absolute difference between `gray` and the stored previous-frame buffer (P1-03), pixel by pixel, and return that mean as `f32`.
- This function does **not** update the stored previous-frame buffer itself — that update happens once per call to `scoreFrame` (P1-08), after all per-frame functions have read it, so ordering is unambiguous.
- Acceptance: returns `0.0` on the first call in a fresh instance; returns a plausible positive float on a second call with a different buffer.

**P1-06. Implement skin-tone segmentation as an internal helper**
- Non-exported function `segmentSkin(rgba: usize, mask: usize): void`.
- Convert each RGBA8 pixel at `rgba` to YCbCr (`Y = 0.299R + 0.587G + 0.114B`, `Cb = 128 - 0.168736R - 0.331264G + 0.5B`, `Cr = 128 + 0.5R - 0.418688G - 0.081312B`).
- Write `1` (u8) to `mask` at that pixel's index if `Cb` is in `[77, 127]` AND `Cr` is in `[133, 173]`, else write `0`.
- Acceptance: compiles; produces a binary mask buffer of `ANALYSIS_PIXEL_COUNT` bytes.

**P1-07. Implement connected-component blob counting + face-region estimate**
- Non-exported function `estimateFaces(mask: usize, faceCountOut: usize, confidenceOut: usize): void` where `faceCountOut` and `confidenceOut` are pointers to single `i32` and `f32` respectively.
- Run a flood-fill (4-connectivity is sufficient) connected-component labeling over the binary mask from P1-06, using a `Uint8Array`-equivalent visited buffer sized `ANALYSIS_PIXEL_COUNT` (reuse the AS `StaticArray<u8>` pattern, not a heap allocation — this needs to run under `--runtime stub`, so use manual iterative flood fill with an explicit stack array, not recursion, to avoid call-stack depth issues on components approaching the full frame size).
- For each connected component, compute its pixel area. Discard components smaller than `2%` of `ANALYSIS_PIXEL_COUNT` or larger than `40%` of `ANALYSIS_PIXEL_COUNT` (these thresholds are placeholders — flag them in `docs/THRESHOLDS.md`, P1-10, as needing empirical tuning against the real test assets from P0-08).
- Write the count of remaining (in-range) components to `faceCountOut`.
- Write a confidence value to `confidenceOut`: `1.0` if exactly one component passed the size filter and its area is within `[8%, 25%]` of frame area (a "good, single, face-sized" region), scaling down toward `0.3` as the area moves toward either edge of the `[2%, 40%]` range, and `0.0` if `faceCountOut` is `0`. Exact formula: `confidence = 1.0 - min(1.0, abs(area_fraction - 0.165) / 0.165)` where `0.165` is the midpoint of `[8%,25%]`, clamped to `[0.0, 1.0]`; if multiple components passed the filter, use the largest one's area for this formula and cap the result at `0.5` (since multiple candidate regions is itself a signal of uncertainty, separate from the `MULTI_FACE` flag which is computed in TS from `faceCountOut` directly — see P2-09).
- Acceptance: on a synthetic mask with one square blob covering ~15% of the frame, returns `faceCount = 1` and `confidence` close to `1.0`. On an all-zero mask, returns `faceCount = 0`, `confidence = 0.0`.

**P1-08. Implement the exported `scoreFrame()` entry point**
- Exported function: `export function scoreFrame(rgbaPtr: usize, outPtr: usize): void`.
- `rgbaPtr` points to `ANALYSIS_BUFFER_BYTES` bytes of RGBA8 pixel data (already downscaled to `ANALYSIS_WIDTH x ANALYSIS_HEIGHT` by the TS caller — see P2-06). No width/height parameters needed since resolution is fixed (P1-01).
- Steps, in order:
  1. Convert `rgbaPtr` to grayscale into a local scratch buffer (P1-02).
  2. Compute `sharpness` (P1-04) from that grayscale buffer.
  3. Compute `motionDelta` (P1-05) from that grayscale buffer, using the still-unupdated previous-frame buffer.
  4. Copy the current grayscale buffer into the stored previous-frame buffer (P1-03), and set `hasPreviousFrame = true`.
  5. Run `segmentSkin` (P1-06) on `rgbaPtr` into a local scratch mask buffer.
  6. Run `estimateFaces` (P1-07) on that mask, getting `faceCount` and `faceConfidence`.
  7. Write four `f32` values to `outPtr`, in this exact order and byte offset: `outPtr+0`: `faceCount` (cast to `f32`), `outPtr+4`: `faceConfidence`, `outPtr+8`: `sharpness`, `outPtr+12`: `motionDelta`.
- Acceptance: calling this on a real buffer produces four plausible floats at `outPtr` in the documented order (verified in P1-09).

**P1-09. Write a bare TS test harness for the WASM module**
- Create `scripts/test-wasm-harness.ts` (new `scripts/` directory, not part of the main app).
- Use Node's built-in `WebAssembly` API to load `build/scorer.wasm` (built by P1-11 first).
- Construct two hand-made `160x90` RGBA8 test buffers in JS: one solid mid-gray color (should score low `sharpness`), one a hard black/white checkerboard pattern at every-other-pixel (should score high `sharpness`).
- Write each buffer into the WASM instance's memory, call `scoreFrame`, read back the four floats, `console.log` them labeled clearly (`"solid gray:"`, `"checkerboard:"`).
- Add an npm script `"test:wasm": "tsx scripts/test-wasm-harness.ts"` (requires `npm install --save-dev tsx`).
- Acceptance: `npm run test:wasm` prints two lines; the checkerboard buffer's `sharpness` value is visibly, substantially higher than the solid-gray buffer's.

**P1-10. Write `docs/THRESHOLDS.md`**
- Document every numeric constant introduced so far that's a placeholder needing empirical tuning: the `2%`/`40%` blob-size filter (P1-07), the `[8%,25%]` confidence sweet spot (P1-07). State plainly in this file that these were chosen as reasonable starting points, not derived from real data, and should be adjusted after running P1-09/P4 tests against the real sample clips from P0-08.
- Acceptance: file exists, lists both thresholds with their current values and a one-line justification each.

**P1-11. Add the WASM build script and build it**
- Add to `package.json` `"scripts"`: `"build:wasm": "asc assembly/index.ts --target release --runtime stub --exportRuntime -o build/scorer.wasm"`.
- Run `npm run build:wasm`.
- Acceptance: `build/scorer.wasm` exists and is non-empty; `npm run test:wasm` (P1-09) runs against it successfully.

**P1-12. Write `docs/MEMORY_LAYOUT.md`**
- Document, in plain terms, the exact memory contract for `scoreFrame`: input is `ANALYSIS_WIDTH x ANALYSIS_HEIGHT` (160x90) RGBA8 at `rgbaPtr`, output is 4 consecutive `f32`s (16 bytes total) at `outPtr` in the order `faceCount, faceConfidence, sharpness, motionDelta`. State explicitly that `motionDelta` depends on internal state (the previous frame) and that scoring frames out of chronological order, or from two different windows in the same WASM instance without resetting, will produce a meaningless `motionDelta` for the first frame of the second window (flag this as a known constraint the worker-assignment logic in P2 must respect — each worker should be assigned frames from only one contiguous window at a time, in order).
- Acceptance: file exists and covers both the byte layout and the ordering constraint above.

---

## Phase 2 — Windowed Decode + Worker Pool

**P2-01. Define shared TypeScript types**
- In `src/types.ts`, define exactly:
  ```typescript
  export type FrameFlag = 'BLUR' | 'NO_FACE' | 'MULTI_FACE' | 'LOW_CONFIDENCE' | 'HIGH_MOTION';

  export interface FrameScore {
    t: number;
    faceCount: number;
    faceConfidence: number;
    sharpness: number;
    motionDelta: number;
    flags: FrameFlag[];
  }

  export interface IngestVerdict {
    pass: boolean;
    frameScores: FrameScore[];
    badFrameRatio: number;
    dominantFlags: FrameFlag[];
  }

  export interface WorkerScoreRequest {
    type: 'SCORE_FRAME';
    taskId: number;
    timestamp: number;
    pixels: ArrayBuffer;
  }

  export interface WorkerScoreResponse {
    type: 'FRAME_SCORE';
    taskId: number;
    faceCount: number;
    faceConfidence: number;
    sharpness: number;
    motionDelta: number;
  }
  ```
- Note: `flags` is computed in TS (P2-09), not returned by the worker — the worker only returns the four raw numeric scores.
- Acceptance: file compiles with `strict: true`, matches exactly the shapes above.

**P2-02. Define threshold constants in TS**
- In `src/thresholds.ts`, define exactly:
  ```typescript
  export const BLUR_SHARPNESS_MAX = 15.0;
  export const LOW_CONFIDENCE_MAX = 0.4;
  export const HIGH_MOTION_MIN = 40.0;
  export const BAD_FRAME_RATIO_FAIL_THRESHOLD = 0.2;
  export const SAMPLE_FPS = 2;
  export const DEBOUNCE_MS = 300;
  export const MAX_IN_FLIGHT_FRAMES = 24;
  ```
- These mirror the ones in `docs/THRESHOLDS.md` (P1-10) plus the additional TS-side ones — update `docs/THRESHOLDS.md` in this same task to list all six with the same "placeholder, needs tuning" caveat.
- Acceptance: file exists with exactly these six exported constants; `docs/THRESHOLDS.md` updated.

**P2-03. Implement `loader.ts`**
- Export an async function `loadScorer(): Promise<ScorerExports>` where `ScorerExports` is a locally-defined interface exposing `scoreFrame(rgbaPtr: number, outPtr: number): void` and `memory: WebAssembly.Memory`.
- Internally: `fetch('/scorer.wasm')` (served from `build/` — add `build/scorer.wasm` to the Vite `publicDir` handling, or copy it into `test-assets/` at build time; simplest: set Vite's `publicDir` to serve both `test-assets/` and `build/` — if Vite only supports one `publicDir`, instead copy `build/scorer.wasm` into a new `public/` directory as a build step, and set `vite.config.ts`'s `publicDir` to `'public'`, moving the P0-08 test asset serving to also live under `public/test-assets/`). Resolve this exact mechanism in this task and document the final choice in `README.md` (P5-04).
- Use `WebAssembly.instantiateStreaming(fetch(...), {})`.
- Acceptance: calling `loadScorer()` from a temporary throwaway script in the browser console resolves without error and the returned object has a callable `scoreFrame`.

**P2-04. Implement `demux.ts`**
- Export an async generator function `demuxWindow(file: File, startSeconds: number, endSeconds: number): AsyncGenerator<EncodedVideoChunk>`.
- Use `mp4box` to parse the file's box structure from a `File.stream()` (do not load the whole file into memory — feed `mp4box` incrementally via its `appendBuffer` API as chunks arrive from the stream reader).
- Use `mp4box`'s sample table info to identify which samples fall within `[startSeconds, endSeconds]`, plus the necessary preceding keyframe if `startSeconds` doesn't land exactly on one (standard seek-to-nearest-keyframe-before behavior).
- Yield each relevant sample as a `EncodedVideoChunk` (constructed with the correct `type` (`'key'` or `'delta'`), `timestamp`, and `data`).
- Acceptance: iterating this generator against `test-assets/clean-sample.mp4` with `startSeconds=0, endSeconds=2` yields at least one chunk, logged with its `timestamp` and `type`.

**P2-05. Implement `decoder.ts`**
- Export an async generator function `decodeWindow(file: File, startSeconds: number, endSeconds: number): AsyncGenerator<VideoFrame>`.
- Internally: create a `VideoDecoder` configured from the file's codec info (read via `mp4box`'s track info — pull `codec` string, `codedWidth`, `codedHeight` from the parsed track).
- Feed it chunks from `demuxWindow` (P2-04) via `decoder.decode(chunk)`.
- Collect output `VideoFrame`s via the decoder's `output` callback, filtering to only those whose `.timestamp` (converted to seconds) falls within `[startSeconds, endSeconds]` — frames from the preceding keyframe that land before `startSeconds` should be decoded (needed for correctness) but not yielded.
- Call `decoder.flush()` after all chunks are fed, then close the decoder.
- Acceptance: iterating this generator against `test-assets/clean-sample.mp4` with a 2-second window yields a small number of real `VideoFrame` objects (log `.timestamp` and `.codedWidth`/`.codedHeight` for each).

**P2-06. Implement the downscale step**
- In a new exported function in `decoder.ts`, `downscaleFrame(frame: VideoFrame): Uint8ClampedArray`:
  - Create (once, module-level, reused across calls) an `OffscreenCanvas(160, 90)` and its `2d` context.
  - `ctx.drawImage(frame, 0, 0, 160, 90)` (this auto-scales regardless of source resolution).
  - `ctx.getImageData(0, 0, 160, 90).data` and return that `Uint8ClampedArray` (RGBA8, exactly `160*90*4 = 57600` bytes).
  - Explicitly note in a `docs/MEMORY_LAYOUT.md` addendum (append to the file from P1-12) that this step is **not** zero-copy — canvas readback involves a GPU→CPU copy and a format conversion. This is a deliberate, documented tradeoff for the POC, not an oversight; do not describe this pipeline as "fully zero-copy" anywhere else in the codebase or docs.
- Acceptance: calling this on a real decoded `VideoFrame` returns a `57600`-byte array; append written to `docs/MEMORY_LAYOUT.md`.

**P2-07. Implement `worker.ts`**
- This is the Web Worker entry file (loaded via `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` from the main thread — that instantiation itself happens in P2-08, not here).
- On worker startup: call `loadScorer()` (P2-03) once, store the result.
- On `self.onmessage`, expect a `WorkerScoreRequest` (P2-01). Steps:
  1. Get a `Uint8Array` view over the worker's own `scorerExports.memory.buffer` at a fixed scratch offset (define `const RGBA_SCRATCH_OFFSET = 1024;` and `const OUT_SCRATCH_OFFSET = 1024 + 57600;` as module-level constants in this file — chosen arbitrarily but must not collide with AssemblyScript's own internal memory usage; if `--runtime stub` places static data at low offsets, verify these constants sit above that by checking the actual compiled module's data-end via `asc`'s output, and adjust the constants here if a collision is found during P2-13 testing).
  2. Copy the incoming `request.pixels` (an `ArrayBuffer`, transferred, not cloned) into that memory view at `RGBA_SCRATCH_OFFSET`.
  3. Call `scorerExports.scoreFrame(RGBA_SCRATCH_OFFSET, OUT_SCRATCH_OFFSET)`.
  4. Read back four `f32`s from `OUT_SCRATCH_OFFSET` via a `Float32Array` view.
  5. Post a `WorkerScoreResponse` (P2-01) back to the main thread with `taskId` echoed and the four values.
- Acceptance: a standalone test (P2-13) confirms a worker instance correctly round-trips a known test buffer and returns plausible scores.

**P2-08. Implement `workerPool.ts`**
- Export a class `WorkerPool`:
  - Constructor takes no arguments; internally spawns `Math.max(1, navigator.hardwareConcurrency - 1)` workers via `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`, storing them in an array along with an `available: boolean` flag per worker.
  - Method `score(timestamp: number, pixels: ArrayBuffer): Promise<Omit<FrameScore, 'flags'>>`: picks the next available worker (round-robin over the `available` ones; if none available, queue the request in an internal FIFO array and dispatch it when a worker frees up), sends a `WorkerScoreRequest` with a locally incrementing `taskId`, transfers the `pixels` buffer (`postMessage(msg, [pixels])`), and returns a `Promise` that resolves when the matching `WorkerScoreResponse` (matched by `taskId`) arrives, marking the worker `available` again at that point.
  - Enforce `MAX_IN_FLIGHT_FRAMES` (from P2-02, `thresholds.ts`) as a hard cap on combined in-flight + queued requests — reject (via a thrown error, caught by the caller in P2-10) any `score()` call made while at that cap, rather than growing the queue unboundedly.
- Acceptance: a standalone test (P2-13) sends 30 synthetic frames through a `WorkerPool` and confirms all 30 resolve with plausible values, in the correct order relative to their `taskId`s where order matters (motion delta correctness — see P2-13's specific check).

**P2-09. Implement flag computation**
- In a new exported function in `thresholds.ts`, `computeFlags(faceCount: number, faceConfidence: number, sharpness: number, motionDelta: number): FrameFlag[]`:
  - Push `'NO_FACE'` if `faceCount === 0`.
  - Push `'MULTI_FACE'` if `faceCount > 1`.
  - Push `'BLUR'` if `sharpness < BLUR_SHARPNESS_MAX`.
  - Push `'LOW_CONFIDENCE'` if `faceConfidence < LOW_CONFIDENCE_MAX`.
  - Push `'HIGH_MOTION'` if `motionDelta > HIGH_MOTION_MIN`.
  - Return the array (may be empty, meaning the frame is clean).
- Acceptance: unit-style manual check with hand-picked inputs confirms each flag fires independently and in combination correctly.

**P2-10. Implement `orchestrator.ts`**
- Export a class `IngestOrchestrator`:
  - Constructor takes a `WorkerPool` instance (P2-08) as a dependency (constructed once in `main.ts`, passed in — not created internally, so it's reused across repeated `scoreWindow` calls rather than respawning workers every time).
  - Method `async scoreWindow(file: File, startSeconds: number, endSeconds: number): Promise<IngestVerdict>`:
    1. Compute the list of sample timestamps to analyze: every `1/SAMPLE_FPS` seconds from `startSeconds` to `endSeconds` inclusive.
    2. Iterate `decodeWindow(file, startSeconds, endSeconds)` (P2-05). For each yielded `VideoFrame`, check if its timestamp is within `1/(2*SAMPLE_FPS)` seconds of the next target sample timestamp from step 1; if so, downscale it (P2-06), submit it to the `WorkerPool` (P2-08), and advance to the next target timestamp. Always call `.close()` on every `VideoFrame` (matched or not) before moving to the next iteration — this is mandatory, not optional, to avoid GPU memory leaks.
    3. Await all submitted `WorkerPool.score()` promises (they can be awaited as they're submitted, in a `Promise.all`, since order doesn't need to be preserved for the final aggregation — each result already carries its own `timestamp` via the closure or via re-attaching it after resolution).
    4. For each resolved score, compute `flags` via `computeFlags` (P2-09), producing a full `FrameScore`.
    5. Compute `badFrameRatio` = (count of frames with at least one flag) / (total frames scored).
    6. Compute `pass` = `badFrameRatio <= BAD_FRAME_RATIO_FAIL_THRESHOLD`.
    7. Compute `dominantFlags`: the set of distinct flags that appear on more than half of the "bad" frames (frames with at least one flag) — empty array if `pass` is `true`.
    8. Return the assembled `IngestVerdict`.
- Acceptance: calling `scoreWindow` against `test-assets/clean-sample.mp4` for its full duration returns `pass: true` with an empty or near-empty `dominantFlags`; calling it against `test-assets/blurry-sample.mp4` returns `pass: false` with `'BLUR'` in `dominantFlags`.

**P2-11. Implement debouncing for repeated trim changes**
- In `orchestrator.ts`, add a method `scoreWindowDebounced(file: File, startSeconds: number, endSeconds: number, onResult: (v: IngestVerdict) => void): void` that wraps `scoreWindow` with a `DEBOUNCE_MS`-delay debounce (standard `setTimeout`/`clearTimeout` pattern keyed on a single pending-timer instance variable on the class) — if called again before the delay elapses, the previous pending call is cancelled and only the latest wins. Also cancel/ignore results from any *in-flight* `scoreWindow` call that's superseded by a newer one (guard with an incrementing generation counter compared before calling `onResult`).
- Acceptance: rapidly calling `scoreWindowDebounced` five times in under 300ms with different arguments results in exactly one call to `onResult`, using the arguments from the last call.

**P2-12. Wire error handling for decode failures**
- In `decodeWindow` (P2-05) and `demuxWindow` (P2-04), wrap the core logic in `try/catch`. On any error (unsupported codec, corrupted file, `mp4box` parse failure), the generator should `throw` a new `Error` with a clear message identifying which stage failed (`"demux failed: ..."` or `"decode failed: ..."`), rather than silently yielding nothing.
- In `orchestrator.ts`'s `scoreWindow`, catch that error and return a special `IngestVerdict` shape for this case: `{ pass: true, frameScores: [], badFrameRatio: 0, dominantFlags: [] }` plus a separate thrown/logged warning — i.e., **fail open**: if the gate itself breaks, don't block the person from generating; let them proceed as if ungated, and log the failure to the console for debugging. Document this fail-open behavior explicitly in `README.md` (P5-04).
- Acceptance: manually feeding a corrupted/non-video file into the pipeline results in a console-logged error and a `pass: true` verdict, not a thrown exception that breaks the UI.

**P2-13. Write and run the Phase 2 integration test**
- Create `scripts/test-pipeline-harness.ts` (or a temporary page reachable via the dev server, since Workers and WebCodecs need a real browser context — Node alone won't run this one, unlike P1-09).
- Steps to perform manually and record the outcome in this task's completion notes:
  1. Load `test-assets/clean-sample.mp4` via a `File` (e.g., via a temporary `<input type=file>` in a scratch HTML page, or `fetch` + convert to `File`), run `orchestrator.scoreWindow(file, 0, <full duration>)`, confirm `pass: true`.
  2. Repeat with `blurry-sample.mp4`, confirm `pass: false` and `'BLUR'` present in `dominantFlags`.
  3. Repeat with `no-face-sample.mp4`, confirm `pass: false` and `'NO_FACE'` present.
  4. Repeat with `multi-face-sample.mp4`, confirm `pass: false` and `'MULTI_FACE'` present.
  5. If any of these don't match expectations, revisit the threshold constants in `thresholds.ts` (P2-02) and `docs/THRESHOLDS.md` (P1-10) — this is the expected place to tune them, not a sign the pipeline itself is broken.
- Acceptance: all four checks pass, or thresholds have been adjusted and re-verified until they do.

---

## Phase 3 — Demo UI

**P3-01. Write `theme.css`**
- Define CSS custom properties at `:root`: `--bg: #000; --fg: #e0e0e0; --accent: #39ff14; --border: 1px solid #333; --font: 'JetBrains Mono', 'IBM Plex Mono', monospace;`.
- Global reset: `* { margin: 0; padding: 0; box-sizing: border-box; }`, `body { background: var(--bg); color: var(--fg); font-family: var(--font); }`.
- No `border-radius` anywhere in this file. No `transition` or `animation` properties anywhere in this file (per the brutalist/no-motion spec) except for the two explicitly allowed cases handled in P3-05 and P3-04 (both implemented as instant DOM updates, not CSS transitions, so this file should genuinely contain zero `transition`/`animation` rules).
- Acceptance: file contains the variables above and no `border-radius`/`transition`/`animation` declarations.

**P3-02. Write `index.html`**
- A minimal HTML shell: `<div id="app"></div>`, a `<link>` to `src/ui/theme.css`, a `<script type="module" src="/src/main.ts"></script>`.
- Add a Google Fonts (or self-hosted, agent's choice, document the choice in README) `<link>` for JetBrains Mono if not relying on system-installed monospace fallback — self-hosting preferred to avoid an external network dependency for the demo; if self-hosting, place font files under `public/fonts/` and `@font-face` them in `theme.css` (amend P3-01 to include this).
- Acceptance: `npm run dev` serves a page with the correct background/font applied, even before any UI components render content.

**P3-03. Implement `trimControls.ts`**
- Export a function `createTrimControls(container: HTMLElement, videoDuration: number, onChange: (start: number, end: number) => void): void`.
- Renders: a `<video>` element (muted, controls enabled, source set from the selected file — file selection itself handled in `app.ts`, P3-06, this function just renders the trim inputs alongside it), two `<input type="number">` fields labeled `Video start` and `Video end` (mirroring Magic Hour's own labels from the blueprint's UI reference), and a `Confirm Trim`-labeled `<button>`.
- On button click (or on `input` event for a live-updating feel — choose live `input` events, since the whole point is reacting to trim changes as they happen, matching the debounce design in P2-11), call `onChange(startValue, endValue)`.
- Validate: `start >= 0`, `end <= videoDuration`, `end > start` — if invalid, disable the button/ignore the change rather than calling `onChange` with bad values.
- Acceptance: manually typing values into both fields and observing (via a temporary `console.log` in the `onChange` callback passed from a test harness) that valid ranges trigger the callback and invalid ones don't.

**P3-04. Implement `metricsStrip.ts`**
- Export a function `createMetricsStrip(container: HTMLElement): { update: (fps: number, heapMB: number, faceConfidenceSeries: number[]) => void }`.
- Renders three labeled monospace text blocks in a horizontal flex row with `var(--border)` between them: `FRAMES/SEC ANALYZED`, `WASM HEAP (MB)`, and a placeholder `<div>` for the sparkline (actual sparkline rendering delegated to `sparkline.ts`, P3-05, called from within this `update` function).
- `update()` sets the text content of the first two directly (no animation, just `textContent = value.toFixed(1)`), and calls `renderSparkline` (P3-05) into the placeholder `<div>` with the `faceConfidenceSeries`.
- `heapMB` is computed by the caller (`app.ts`) from `scorerExports.memory.buffer.byteLength / (1024*1024)` — this function just displays whatever number it's given, it doesn't compute it.
- Acceptance: calling `update(2.0, 1.2, [0.9, 0.8, 0.95])` visibly updates all three fields with no flicker/animation.

**P3-05. Implement `sparkline.ts`**
- Export a function `renderSparkline(container: HTMLElement, values: number[]): void`.
- Render as monospace text using block characters mapped to 8 levels: `' ▁▂▃▄▅▆▇█'` (space plus 8 Unicode block-height characters), one character per value in `values`, each value in `[0,1]` mapped to `Math.floor(value * 8)` indexing into that string. Concatenate into a single string, set as `container.textContent`.
- This deliberately avoids SVG/canvas/any smoothing — it's meant to look like a monospace terminal sparkline, per the UI spec's explicit "not a smoothed SVG curve" requirement.
- Acceptance: calling with `[0, 0.5, 1.0]` renders three visibly different-height block characters in sequence, with no animation.

**P3-06. Implement `verdictPanel.ts`**
- Export a function `createVerdictPanel(container: HTMLElement): { appendLine: (score: FrameScore) => void; clear: () => void; showProceedButton: (onProceed: () => void) => void; hideProceedButton: () => void }`.
- Renders an empty `<pre>` or `<div>` styled as a terminal log (monospace, `var(--bg)` background, `var(--fg)` text, scrollable with `overflow-y: auto`, fixed `max-height`).
- `appendLine(score)`: constructs a line in exactly this format: `` `[t=${score.t.toFixed(1)}s] face=${score.faceCount} conf=${score.faceConfidence.toFixed(2)} sharp=${score.flags.includes('BLUR') ? 'BAD' : 'OK'}${score.flags.length ? ' REJECT: ' + score.flags.join(',') : ''}` ``. Appends it as a new `<div>` child, colored `var(--accent)` (green) if `score.flags.length === 0`, or a hardcoded red (`#ff3131`) if not — no CSS transition on the color change, it's just set directly via `style.color` on element creation. Auto-scrolls the container to the bottom after each append (`container.scrollTop = container.scrollHeight`, the one explicitly allowed non-static behavior from the UI spec).
- `clear()`: removes all child lines — called at the start of each new `scoreWindow` run (from `app.ts`, P3-07) so re-trims start a fresh log rather than appending forever.
- `showProceedButton`/`hideProceedButton`: renders/removes a single `<button>` labeled exactly `PROCEED ANYWAY`, styled with `var(--border)` and no `border-radius`, positioned directly below the log. `showProceedButton` takes the click handler as an argument and wires it directly.
- Acceptance: calling `appendLine` with a clean `FrameScore` and a flagged one produces two visually distinct (color-differentiated) lines in the correct format; `showProceedButton` renders a clickable button that fires the given callback.

**P3-07. Implement `app.ts`, wiring everything together**
- Export a function `initApp(root: HTMLElement): void`, called once from `main.ts` (P3-08).
- Steps:
  1. Render a file `<input type="file" accept="video/mp4">` at the top of `root`.
  2. On file selection: read the video's duration (via a throwaway `<video>` element's `loadedmetadata` event), then call `createTrimControls` (P3-03) with that duration, `createMetricsStrip` (P3-04), and `createVerdictPanel` (P3-06), all appended into `root` in that order, plus a `Generate Face Swap` `<button>` at the bottom (styled per `theme.css`, no functional backend call — see step 5).
  3. Construct one `WorkerPool` (P2-08) and one `IngestOrchestrator` (P2-10) instance, once, when the app initializes (not per-file, not per-trim-change) — pass the pool into the orchestrator's constructor as specified in P2-10.
  4. Wire `trimControls`'s `onChange` callback to: clear the verdict panel (P3-06's `clear()`), hide any visible proceed button, call `orchestrator.scoreWindowDebounced(file, start, end, (verdict) => { ...render... })` (P2-11). In the render callback: call `verdictPanel.appendLine` once per `verdict.frameScores` entry, in timestamp order; call `metricsStrip.update` with the sampled fps (`SAMPLE_FPS` from `thresholds.ts`), current heap size (computed from the loaded scorer's memory buffer — plumb a reference to it from `loader.ts` through to here, or re-fetch it via the orchestrator/pool if not already accessible; expose it via a new `WorkerPool.getApproxHeapMB(): number` method that reads `navigator.deviceMemory`-independent worker memory is not directly readable from the main thread — instead, have each worker report its own `scorerExports.memory.buffer.byteLength` once at startup via an initial handshake message, and have `WorkerPool` track and expose the sum across workers), and the array of `faceConfidence` values across `verdict.frameScores` for the sparkline; if `!verdict.pass`, call `verdictPanel.showProceedButton(...)` wired to unlock the `Generate Face Swap` button (see step 5).
  5. `Generate Face Swap` button: disabled by default whenever the latest verdict was `pass: false` and the person hasn't clicked `PROCEED ANYWAY` yet; enabled otherwise. On click, since this is a demo with no real backend integration, simply replace the button's content with a static `GENERATED (MOCK)` label and log the final verdict object to the console — do not attempt any real network call.
- Acceptance: the full flow works end to end in the browser: pick a file, see trim controls appear, adjust start/end, see the verdict panel populate live, see the `Generate Face Swap` button gate correctly on bad input and unlock via `PROCEED ANYWAY`.

**P3-08. Implement `main.ts`**
- The entire file: import `initApp` from `./ui/app`, call `initApp(document.getElementById('app')!)` once, at module load.
- Acceptance: loading the page in a browser runs this without error and results in the file-input UI appearing (confirms P3-02 through P3-07 are correctly wired).

---

## Phase 4 — Integration Testing

**P4-01. Full manual run: clean input**
- Using the running dev server: select `clean-sample.mp4`, leave the trim at its full default range, observe the verdict panel fill with mostly/entirely `OK` lines and no `PROCEED ANYWAY` button appearing, `Generate Face Swap` enabled by default.
- Acceptance: matches the description above; if not, revisit Phase 1/2 thresholds before touching UI code.

**P4-02. Full manual run: blurry input**
- Select `blurry-sample.mp4`, observe `REJECT: BLUR` lines appearing, `PROCEED ANYWAY` button appearing, `Generate Face Swap` disabled until it's clicked.
- Acceptance: matches the description above.

**P4-03. Full manual run: no-face input**
- Select `no-face-sample.mp4`, observe `REJECT: NO_FACE` lines and the same gating behavior as P4-02.
- Acceptance: matches the description above.

**P4-04. Full manual run: multi-face input**
- Select `multi-face-sample.mp4`, observe `REJECT: MULTI_FACE` lines and the same gating behavior as P4-02.
- Acceptance: matches the description above.

**P4-05. Re-trim behavior test**
- With `blurry-sample.mp4` loaded and rejected, change the trim window to a different sub-range of the same file (if the source has any in-focus moment) or reselect `clean-sample.mp4` in the same session without reloading the page, and confirm the verdict panel clears and re-populates correctly for the new window, and the `Generate Face Swap` button's enabled/disabled state updates accordingly.
- Acceptance: matches the description above — this is the test that most directly validates the POC's actual value proposition (re-scoring on re-trim), so don't skip it.

**P4-06. Rapid trim-drag debounce test**
- Rapidly change the start/end number inputs several times within under a second (simulating dragging), and confirm via browser dev tools' console (temporary logging is fine here) that `scoreWindow` only actually runs once, for the final values, not once per keystroke.
- Acceptance: confirmed via console log count.

**P4-07. Corrupted-file fail-open test**
- Rename an arbitrary non-video file to have a `.mp4` extension and attempt to select it in the app.
- Confirm the app doesn't crash or hang, logs an error to the console, and leaves `Generate Face Swap` enabled (fail-open, per P2-12).
- Acceptance: matches the description above.

---

## Phase 5 — Demo & Documentation

**P5-01. Record the pitch demo**
- Screen-record a short (under 2 minutes) walkthrough: load `clean-sample.mp4`, show it passing; switch to `blurry-sample.mp4` (or re-trim to a blurry section), show it failing with the verdict panel populating live, show `PROCEED ANYWAY` unlocking generation.
- Acceptance: a video file exists showing this flow start to finish, no narration required but helpful if included.

**P5-02. Take the "output was actually low quality" screenshot, if pursuing that open item**
- If closing out the still-open item from the verification protocol (independently confirming output quality) is in scope, capture the actual rendered output frame from a real Magic Hour job next to its source frame, side by side, as a separate image asset — this is unrelated to the POC codebase itself, just supporting evidence for the pitch.
- Acceptance: image exists, if pursued (optional — flag as skipped if not pursued, don't silently omit).

**P5-03. Write `docs/THRESHOLDS.md` final pass**
- After Phase 4's manual tests, update this file (first created in P1-10, added to in P2-02) with the *final* values used for all six constants (three AS-side, three-plus TS-side), and a one-line note per constant on whether it was left at its original placeholder or adjusted, and why.
- Acceptance: file reflects the actual final constant values in the codebase, not the original placeholders, if any were changed.

**P5-04. Write `README.md`**
- Cover, in order: what this POC demonstrates (one paragraph, referencing the confirmed finding it's built on); setup (`npm install`, `npm run build:wasm`, `npm run dev`); how to run the Phase 1/2 test harnesses (`npm run test:wasm`, and the manual steps from P2-13); the fail-open behavior (P2-12) stated explicitly so nobody mistakes a decode error for "the gate passed everything on purpose"; the non-zero-copy caveat on the downscale step (P2-06) stated explicitly; a link to `magic-hour-wasm-ingest-blueprint.md` for the full architectural rationale.
- Acceptance: a person with no prior context could clone the repo, follow this file, and get the demo running.

---

## Explicit Non-Goals (do not build these, even if a task above seems to gesture at them)

- No real integration with Magic Hour's actual API or servers. The "Generate" button is always a mock.
- No upload-time interception or upload-byte-range changes of any kind.
- No neural-network face detector. The classical CV approach (P1-06, P1-07) is the entire scope for this POC.
- No cross-worker shared memory / `SharedArrayBuffer` / COOP-COEP configuration. Each worker's WASM instance is fully private, per P2-07/P2-08.
- No mobile-specific UI work or responsive breakpoints — this is a desktop-browser demo.