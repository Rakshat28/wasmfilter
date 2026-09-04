# Magic Hour: Path to Production (ML Integration Plan)
### Revised and fact-checked

Original plan direction confirmed sound: replace the POC's hand-rolled heuristics (YCbCr skin blobs, Laplacian sharpness, raw pixel-diff motion) with real, lightweight ML models. This version corrects several overclaims and factual errors, updates browser-support claims against current data, and adds production considerations the original plan didn't cover — particularly around latency, privacy, and the business context we already confirmed during the POC investigation.

---

## Phase 1: Replacing Heuristics with Machine Learning

### 1. Robust Face Detection (MediaPipe / TensorFlow.js)

**The problem** (unchanged, accurate): YCbCr skin segmentation flags hands, beige walls, and wood furniture as faces, and degrades under unusual lighting.

**The fix**: MediaPipe Face Detection or a lightweight BlazeFace model via TFJS, using MediaPipe's WASM/WebGL/WebGPU backends.

**Corrected claims**:
- Multi-face detection is *substantially more reliable*, not "100% accurate" — no detector is. It will still miss occluded faces, extreme angles, and very small/distant faces. Budget for this in the confidence scoring, don't treat detection as ground truth.
- Bounding-box-area-to-frame-ratio is a good *heuristic* for framing (too close/far), not a "perfect" assessment — a face at an angle, or a face plus visible shoulders, changes the box size without changing whether the framing is actually usable.

### 2. Upgrading Blur Detection (IQA Models)

**The problem** (unchanged, accurate): raw Laplacian variance is noise- and compression-artifact-sensitive.

**Option A (tuned math)**: Gaussian blur pass before computing variance, to suppress compression-artifact noise — legitimate, standard technique. Tradeoff worth stating explicitly: this also suppresses genuine fine detail, so the threshold recalibration has to happen *after* adding the blur pass, not reuse the POC's threshold unchanged.

**Option B, corrected**: BRISQUE is a *classical statistical* method (natural-scene-statistics features fed into a trained SVR), not a neural network — "quantized BRISQUE" isn't a coherent idea, since quantization (INT8 weight compression) is specifically a neural-net technique. If a genuinely quantizable deep model is wanted, that's a small CNN trained directly on sharp-vs-blurry frame classification (the second half of the original Option B), or a real NR-IQA neural model like NIMA. Pick one lane — classical BRISQUE (cheap, no training data needed, not quantizable) or a small trained classifier (needs a labeled dataset, but fits the GPU pipeline in Phase 2) — not a hybrid that doesn't technically make sense.

### 3. Upgrading Motion Tracking (Optical Flow)

**The problem and fix are accurate as stated**: raw pixel-diff motion can't distinguish camera shake from a lighting flash; sparse optical flow (Lucas-Kanade) tracks actual feature displacement, which a flash won't produce.

**One gap to add**: optical flow solves the flash/strobe false-positive, but it does *not* by itself distinguish "camera is shaking" from "the subject is moving their head normally." Both produce real, coherent flow vectors. If that distinction matters for the gate (probably yes — a moving subject is normal, a shaking camera isn't), it needs a second signal: e.g., checking whether flow vectors are spatially uniform across the whole frame (camera shake) versus concentrated in the face region only (subject motion). Not solved by adding optical flow alone.

---

## Phase 2: Architecture & Web Worker Refactoring

### 1. Shifting from CPU Workers to WebGPU/WebGL

Direction is reasonable — GPU inference benefits from one dedicated context rather than being split across many workers the way the POC's CPU math was. One correction: the POC spec sizes the worker pool at `navigator.hardwareConcurrency - 1`, not `navigator.hardwareConcurrency` — keep that reserved core for the main thread when this gets rebuilt around a single ML worker too.

**Real gap not addressed — live re-scoring latency.** The whole reason the POC re-scores on every trim-handle drag, debounced at 300ms, is that the original WASM math was cheap enough to run in real time. Neural inference — even a lightweight BlazeFace/MobileNet-class model — is meaningfully heavier per frame. Swapping in ML models without addressing this will either make trim-dragging feel laggy, or silently force a much longer debounce that defeats the "live feedback" point of the feature. Recommended fix: **two-tier scoring**. Keep a cheap, fast heuristic (the POC's existing Laplacian/motion math, or a downsampled/cheaper variant) running live during drag for immediate visual feedback, and run the full ML models once, right before the "Generate" click is actually committed, as the real gate. This keeps the UI responsive while still using real models for the decision that actually matters.

### 2. Fallback Mechanisms

**Corrected browser-support claims** (checked against current data, not assumed): as of the current state of major browsers, WebCodecs is Baseline across Chrome/Edge, Firefox desktop (since Firefox 130), and Safari (full parity including audio since Safari 26) — but **Firefox on Android does not support WebCodecs at all**, not partially, not behind a flag — it's simply absent. WebGPU shipped by default across Chrome, Edge, Firefox, and Safari as of November 2025, but Firefox's rollout is Windows and Apple-Silicon-macOS so far (Linux and Android still catching up), and general mobile GPU driver coverage lags desktop regardless of browser. The fallback plan needs to name these specific gaps — "some mobile browsers" is too vague to build a real fallback against. Concretely: detect Firefox Android and go straight to the CPU/WASM-SIMD fallback without attempting WebCodecs at all; detect WebGPU absence via `navigator.gpu` and fall back to WebGL; detect both GPU paths failing or the `>500ms/frame` threshold being exceeded and fail open, per the original plan.

**XNNPACK claim is accurate** — TFJS's WASM backend does use XNNPACK, this is a real, correct fallback path.

---

## Phase 3: Data-Driven Threshold Calibration

Methodology (dataset curation, offline inference, ROC analysis) is sound and standard practice. One addition that meaningfully changes how the resulting threshold should be chosen:

**Tie the operating point to what we already know, not just statistical optimality.** A generic ROC analysis says "minimize false negatives while maximizing true positives" as if both error types cost the same. They don't, and we have direct evidence from testing the live product: credits are charged in full regardless of whether the output turns out usable, and `PROCEED ANYWAY` already exists as a disclosed override. That means the cost of a **false positive** (rejecting a genuinely fine video) is a real, immediate annoyance to a paying user, while the cost of a **false negative** (letting a bad video through the gate) is already mitigated by the fact that the person can always see a warning and choose to proceed anyway — the gate was never a hard block. This argues for calibrating the threshold toward **higher precision / lower false-positive rate**, even if that means catching somewhat fewer bad videos, rather than an arbitrary equal-weighting ROC optimum. State this explicitly when picking the operating point in step 4, don't just take whatever point "the curve" suggests.

---

## Phase 4: Production Integration & Telemetry

### 1. Real Backend Integration — corrected to the actual confirmed infrastructure

The original plan says "pre-signed S3/Cloud Storage upload URL" as a generic placeholder. We don't need to guess — this was confirmed directly via DevTools earlier in this project: Magic Hour uses **Google Cloud Storage's resumable-upload JSON API**, bucket `magic-hour-prod-project-outputs`, via an internal `getResumableUploadUrl`-style endpoint followed by a direct `PUT` to `storage.googleapis.com`. Any real integration should target this confirmed flow specifically, not a generic S3-shaped placeholder.

**Telemetry payload — privacy gap not addressed at all in the original plan.** Once real face detection is running and its output (bounding boxes, confidence scores, flags) gets sent to a backend as telemetry, this is biometric-adjacent data under laws like Illinois's BIPA and the EU's GDPR (which treats facial geometry data as a special category). Before shipping the telemetry payload described here:
- Send aggregate flags and scores (`BLUR`, `faceConfidence: 0.82`), never raw bounding-box coordinates or anything resembling a face embedding, unless a privacy/legal review has explicitly signed off on it.
- Never send the actual frame pixels or thumbnails as part of telemetry.
- Document what's being collected and why, in a form a privacy review can actually evaluate — this needs to happen before Shadow Mode, not after.

### 2. Shadow Mode Deployment

Sound approach, no correction needed to the method itself. One addition: **a kill switch**. Once the gate is live (shadow or enforced), there needs to be a way to disable it instantly — a remote feature flag, not a code deploy — if the ML models start misbehaving in production (crashing on certain devices, flagging a surprising fraction of real uploads, a browser update breaking WebGPU support unexpectedly). Shadow Mode reduces the risk of *deciding* to enforce a bad gate; a kill switch reduces the risk of an *already-enforced* gate going wrong after the two-week observation window ends.

### 3. E2E Testing Pipeline — corrected to match the actual UI

Playwright, headless Chrome/WebKit/Firefox, testing all four sample videos through the real DOM — sound plan. 
**Addition**: given Firefox Android's WebCodecs gap (Phase 2), the E2E suite should include an explicit test asserting the fallback path activates correctly on that combination — not just that the three desktop-class browsers behave, since the mobile gap is the one most likely to be missed without a dedicated test.