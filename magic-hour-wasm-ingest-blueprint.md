# Magic Hour — Client-Side Pre-Generation Quality Gate
### Technical Blueprint — 3-Day POC

---

## TL;DR

Confirmed via DevTools on the live product: a job with degraded input quality completed normally and billed full credits, with no rejection observed. This POC adds a browser-side WASM gate that scores the *currently selected trim window* right before "Generate" is clicked, and warns the user if it looks likely to produce output they won't want — with the option to proceed anyway, since they'd be charged the same either way. It runs entirely client-side and doesn't touch how uploading works.

---

## 1. Confirmed Findings

Captured directly from DevTools on the live site (Aug 29 2026). Nothing about Magic Hour's internal processing or server-side logic is claimed — only what's directly observable.

### Finding — A job with degraded input quality completed and billed full price

- Two 5-second jobs, same trim window, same target face: one with a clean source face, one with a degraded (described as blurry) source face.
- Both completed — result card rendered, download available, no error or rejection state.
- Both charged exactly 125 credits (account balance: 275 → 150 for the degraded-input job, consistent with an earlier 400 → 275 charge in the same session).
- **Scope**: confirmed for one degraded-quality input, tested once. Not tested: more extreme inputs (no face detected, several faces in frame). What's confirmed is narrow — for this one input, nothing stopped the job or the charge — not a blanket claim about every failure mode.
- **Not independently confirmed**: that the resulting output was actually low quality. That characterization came from the person testing it, not from anything verified pixel-level.

This is the one finding the POC is built on.

### Investigated and set aside — full-file upload

An earlier pass at this pitch treated "the entire source file uploads before any trim" as a bottleneck, and proposed uploading only the trimmed segment instead. That's dropped. The product lets a person re-trim and regenerate multiple times against a single uploaded file without re-uploading — which means uploading once and re-trimming for free is very likely a deliberate tradeoff, not an oversight. The math also doesn't favor changing it: segment-only uploads only save bytes if someone tries very few trim windows; past roughly two or three re-trims (using the ~7.4MB source / ~9%-per-trim numbers from testing), segment-only uploading would cost *more* total bytes than uploading once, on top of adding upload latency to what's currently an instant re-trim. Not part of this POC.

---

## 2. What the POC Does

One thing: score the currently selected trim window, client-side, right before generation — and re-score it every time the trim window changes, matching how the product is actually used.

1. The person picks (or already has) a local video file and a trim window — same as Magic Hour's own start/end trim controls.
2. WebCodecs decodes only the frames inside that window (seek-based, not the whole file).
3. A WASM module scores those sampled frames for face count, face stability, sharpness, and framing.
4. If the verdict looks bad, show it plainly with a `PROCEED ANYWAY` option before the (mocked, for the POC) generate action fires — since the finding above shows they'd be billed the same 125 credits regardless of what this gate decides.
5. If the person changes the trim window, the score reruns against the new window automatically.

No claim is made about upload bandwidth or server-side compute — neither is part of this pitch. This is a standalone demo (its own file-picker + trim UI, mimicking Magic Hour's), not a live integration — the "Generate" action in the POC is a stub, not a real call to their API.

---

## 3. Architecture

### 3.1 Toolchain

- **AssemblyScript** (`asc`) for the WASM module — a strict TypeScript subset compiled directly to WASM, so no second language enters the codebase.
- Compiled with `--runtime stub` (no GC). The scoring core works on raw pixel bytes, not AS-managed objects.
- Scoring core is hand-written classical CV, not a neural net: Laplacian-variance sharpness, frame-to-frame motion delta, and a skin-tone chroma segmentation + connected-component blob count as the face-region estimate. This is honest scope for a 3-day POC — it will miss angled or partially-occluded faces and can be fooled by skin-toned backgrounds. It's a gate for obvious problems (no face, multiple faces, heavy blur), not a replacement for a production model.
- TS: vanilla + Web Workers; a thin `loader.ts` wraps `WebAssembly.instantiateStreaming`; a thin UI shell for the trim controls + verdict panel.

### 3.2 Pipeline

```
Local file + selected trim window [start, end]
  -> demux (mp4box.js), seek to `start`
  -> WebCodecs VideoDecoder decodes only [start, end]
  -> VideoFrame
  -> copy into WASM linear memory (zero-copy, see 3.4)
  -> WASM scoring in worker pool
  -> small structured score posted back to main thread
  -> VideoFrame.close() [mandatory — GPU-backed, leaks otherwise]
  -> re-run automatically whenever [start, end] changes
```

Because scoring is bounded to the selected window (typically a few seconds, matching Magic Hour's own trim UI) rather than the whole source, this stays cheap enough to rerun live as the person drags the trim handles — no need for the multi-GB streaming/memory-ceiling machinery a full-file design would require.

### 3.3 Worker pool

- One `WorkerPool`, sized to `navigator.hardwareConcurrency - 1`.
- Each worker instantiates its own AS module with its own private linear memory — no `SharedArrayBuffer`, no COOP/COEP headers to configure.
- TS orchestrator (`IngestOrchestrator`) dispatches sampled frames from the current window to idle workers and debounces re-scoring while the trim handles are actively being dragged.
- Sampling: ~2fps within the window. Enough signal for face/motion/sharpness scoring; cheap enough to feel live.

```typescript
interface FrameScore {
  t: number;
  faceCount: number;
  faceConfidence: number;
  sharpness: number;
  motionDelta: number;
}

class IngestOrchestrator {
  private pool: Worker[];

  async scoreWindow(file: File, start: number, end: number): Promise<IngestVerdict> {
    const decoder = this.buildDecoder();
    const scores: FrameScore[] = [];
    for await (const frame of this.demuxAndDecode(file, decoder, start, end)) {
      this.dispatch(frame, scores);
    }
    return this.verdict(scores);
  }
}
```

### 3.4 Zero-copy memory management

- `VideoFrame.copyTo(ArrayBuffer)` writes raw planar pixel data directly into a pre-allocated buffer — skip `ImageBitmap`/canvas round-trips, which force a GPU→CPU→GPU copy.
- Each worker's WASM instance exports its own `memory`. The worker writes decoded pixels straight into a `Uint8Array` view over that instance's `memory.buffer` — no intermediate JS array, no `postMessage` structured-clone copy.
- `scoreFrame(ptr: usize, len: i32, width: i32, height: i32, outPtr: usize): void` reads pixels in place and writes four `f32` results to a fixed `outPtr` offset. TS reads them back as `new Float32Array(memory.buffer, outPtr, 4)` — no allocation, no serialization, on either side.
- Only that 16-byte result view crosses back over `postMessage` — the pixel buffer never does.

---

## 4. UI/UX Spec

Dark, brutalist, terminal-adjacent. No easing, no fades, no skeleton shimmer — state changes snap.

- **Typography**: monospace only (IBM Plex Mono / JetBrains Mono).
- **Palette**: `#000` background, one accent color, white/gray text, no gradients.
- **Layout**: fixed grid, hard 1px borders, no rounded corners, no shadows.
- **Trim controls**: mimic Magic Hour's own start/end inputs, so the demo reads as a drop-in addition to their existing screen, not a separate tool.
- **Live metrics strip** (updates in place, no animation):
  - `FRAMES/SEC ANALYZED`
  - `WASM HEAP (MB)`
  - `FACE CONFIDENCE` — live sparkline, monospace ASCII-bar / square-wave style, not a smoothed curve
- **Verdict panel**: terminal-log style, appends lines as they happen — `[t=0.5s] face=1 conf=0.94 sharp=OK`, `[t=1.0s] face=2 REJECT: multi-face` — hard color swap per line, no transition. Re-renders from scratch each time the trim window changes.
- On overall fail, a `PROCEED ANYWAY` button appears next to the verdict — same hard-edged style, no modal, no soft copy. It's a disclosed choice, not friction — see the confirmed finding above for why blocking outright isn't the right default.
- Only allowed motion: log auto-scroll and sparkline updates, both instant.

---

## 5. Three-Day Build Plan

**Day 1 — WASM core in AssemblyScript**
- `npx asinit .` to scaffold. Write `assembly/index.ts`: `sharpness()`, `motionDelta()`, `faceRegionEstimate()`, and `scoreFrame(ptr, len, width, height, outPtr)` tying them together.
- `asc assembly/index.ts --target release --runtime stub -o build/scorer.wasm`. Prove it from a bare TS harness against a static test image. No video pipeline yet.

**Day 2 — Windowed decode + worker pool**
- WebCodecs `VideoDecoder` + `mp4box.js`, seeking to a given `[start, end]` on a local file rather than decoding the whole thing.
- Worker pool, each worker with its own `loader.ts`-instantiated AS module.
- Zero-copy frame → WASM path working end-to-end; produce a real `FrameScore[]` for a real local file and window.

**Day 3 — Demo UI**
- Build the mimic trim UI (file picker, start/end controls, mocked "Generate" button) with live scoring wired in.
- Verdict panel + `PROCEED ANYWAY`, re-scoring automatically on trim change.
- Record a short before/after demo: dragging the trim window across a clean stretch vs. a bad stretch of the same source, showing the verdict update live.

---

## 6. Why This Is Worth Building

- **Disclosure over silent charging**: the confirmed finding shows a degraded-input job completed and billed the same as a clean one, with no warning. The gate doesn't change what gets billed — it changes whether the person finds out beforehand.
- **Fits how the product is actually used**: since it runs against whatever window is currently selected and reruns on every re-trim, it works naturally with a workflow that already involves picking different windows on one uploaded file — unlike an upload-time check, which would only ever see the first selection.
- **Zero backend risk**: purely client-side, sits in front of the existing "Generate" action. Nothing to migrate, nothing to roll back.

No claim is made about upload bandwidth or server-side compute savings — neither held up under scrutiny, and both are left out rather than assumed.

---

## 7. Risks and Open Items

- The classical CV core is a much cruder detector than a real neural model — it will miss angled/partially-occluded faces and can be fooled by skin-toned backgrounds. If real-world accuracy becomes a requirement, `onnxruntime-web`'s WASM backend is a swap-in behind the same `scoreFrame` interface, but that's a future step, not part of the 3-day scope.
- Safari's WebCodecs support and low-end device performance are the main compatibility tail — plan a fallback (skip the gate, generate as today) rather than blocking outright.
- **Still open from verification** — don't present these as settled: the "no rejection" result is confirmed for one degraded-input condition, not proven as a general rule; the low-quality-output characterization is unverified.