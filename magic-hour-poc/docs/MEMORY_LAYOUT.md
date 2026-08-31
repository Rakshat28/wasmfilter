# Magic Hour POC: WASM Memory Layout and Execution Contract

This document explicitly defines the WebAssembly (WASM) memory architecture for the Proof of Concept. Because we are compiling AssemblyScript with the `--runtime stub` flag, we are operating in a bare-metal environment with **no garbage collection, no heap allocation bounds checking, and no automatic memory management**. 

The JavaScript (TypeScript) wrapper is entirely responsible for allocating memory, choosing exact byte offsets, and writing/reading data without corrupting the WASM instance's internal state. 

This document explains exactly how memory is laid out, why every single number was chosen, and exactly what will break if those numbers are changed. Assume absolutely nothing is done for you automatically.

---

## 1. The Core Function Signature

The primary entry point exposed to JavaScript is:
```typescript
export function scoreFrame(rgbaPtr: usize, outPtr: usize): void
```
- **`usize`**: In AssemblyScript, `usize` is an unsigned 32-bit integer representing a direct byte offset (an index) inside the shared `WebAssembly.Memory` flat array buffer.
- **Why it's designed this way**: Instead of passing complex objects (which `--runtime stub` does not support), JavaScript tells WASM: *"I have already written my input data starting at byte `rgbaPtr`. Please execute your math, and write your answers starting exactly at byte `outPtr`."*
- **What happens if you pass wrong pointers**: If you pass an invalid `usize`, WASM will blindly read or write from that location. It will not throw a standard error. It will simply corrupt memory or read garbage data, leading to wildly inaccurate scores or a silent crash.

---

## 2. Input Memory Contract (`rgbaPtr`)

The `rgbaPtr` parameter tells WASM exactly where to begin reading the video frame's pixel data. 

**The Numbers Explained:**
- **`160` and `90` (Resolution)**: The fixed width (`160`) and height (`90`) of the frame, yielding a 16:9 aspect ratio.
  - **Why these values?** Video processing in WASM is CPU-bound. Analyzing a full 1920x1080 frame would require checking over 2 million pixels per frame, resulting in massive UI lag. Downscaling to 160x90 reduces the mathematical workload by roughly 144x while retaining enough structural detail for the Laplacian variance (sharpness) and YCbCr skin tone detection algorithms to function properly.
  - **What if you change it?** If you increase the resolution without updating WASM constants, WASM will only read the top-left 160x90 corner of the image. If you decrease it, WASM will read past the end of the image buffer into garbage memory.
- **`4` (Bytes Per Pixel)**: The data format is `RGBA8`.
  - **Why this value?** JavaScript's native HTML5 canvas APIs (`OffscreenCanvas`, `ImageData`) extract pixels strictly in an RGBA format (Red, Green, Blue, Alpha). Each channel uses 1 byte (an 8-bit integer from 0-255).
  - **What if you change it?** If you attempted to feed RGB data (3 bytes per pixel) to save memory, the WASM loops (which advance by `4` bytes each iteration) would instantly fall out of alignment. Red would be read as Green, Green as Blue, and the image would visually scramble in memory, destroying all analysis.
- **`57,600` (Total Input Bytes)**: The mathematical product of `160 * 90 * 4`.
  - **Why this value?** This is the exact, unyielding footprint of one frame in memory.
  - **What if you change it?** If JavaScript writes 57,600 bytes but the image was actually a different size, the data is malformed. If JS writes less than 57,600 bytes, WASM will read leftover garbage data at the end of the buffer.

**JS Responsibility:**
Before calling `scoreFrame`, the TypeScript host must write exactly 57,600 bytes of sequential RGBA data into the `WebAssembly.Memory.buffer` starting at the exact `rgbaPtr` offset. 

---

## 3. Output Memory Contract (`outPtr`)

The `outPtr` parameter tells WASM where it is safely allowed to write its final calculated scores. 

**The Numbers Explained:**
- **`16` (Total Output Bytes)**: The total footprint required to store four 32-bit floating-point numbers (`f32`).
  - **Why this value?** A 32-bit float (`f32`) consumes exactly 4 bytes of memory. We are returning exactly four distinct metrics. `4 * 4 = 16`.
  - **What if you change it?** If WASM was hardcoded to write 5 floats (20 bytes) but JS only allocated space for 16, WASM would overwrite whatever data lived in the 4 bytes immediately following the output buffer.
- **`+0`, `+4`, `+8`, `+12` (Byte Offsets)**: The strict, tightly packed order of the output block.
  - `outPtr + 0`: `faceCount` (The number of valid human faces found, mathematically cast to a float for uniform output).
  - `outPtr + 4`: `faceConfidence` (A `0.0` to `1.0` score judging framing).
  - `outPtr + 8`: `sharpness` (The Laplacian variance score).
  - `outPtr + 12`: `motionDelta` (The mean pixel difference compared to the previous frame).
  - **Why these exact offsets?** Memory is a 1-dimensional line of bytes. To store four 4-byte numbers sequentially, you must advance the pointer by exactly 4 bytes each time.
  - **What if you change it?** If JS tries to read `faceConfidence` from `outPtr + 3` instead of `+4`, it will read a misaligned, corrupted amalgamation of bytes from both the `faceCount` and `faceConfidence` values, resulting in random, nonsensical numbers (like `2.45e-14`).

---

## 4. Memory Safety and Pointer Selection (CRITICAL)

Because we use `--runtime stub`, AssemblyScript places all of its internal static arrays (like the grayscale scratch buffers and flood-fill stacks used for computer vision math) at the **very bottom of linear memory** (from offset `0`).

**The Numbers Explained:**
- **`116,000` (Approximate Static Data Size)**: AssemblyScript allocates arrays for `previousFrameGray`, `currentGray`, `skinMask`, `visitedMask`, and `floodStackIdx`. Added together, these take up roughly 116,000 bytes.
  - **What if JS uses `rgbaPtr = 1024`?** If JavaScript tells WASM to read input data at offset `1024`, JS will write the video frame directly on top of AssemblyScript's internal math buffers. WASM will execute using a corrupted state, and the output will be meaningless.
- **`65,536` (WASM Page Size)**: WebAssembly memory is allocated in blocks called "pages". One page is exactly 64 Kilobytes (65,536 bytes).
- **`131,072` (The Recommended `rgbaPtr`)**: This is `65536 * 2`. 
  - **Why this value?** Since AssemblyScript's static data consumes ~116,000 bytes, it spills across Page 1 and Page 2. By setting our input pointer to exactly `131,072`, we force the video frame data to start cleanly at the very beginning of Page 3. This guarantees it will never collide with the static data.
  - **What if you change it?** If you set it to `100,000`, it collides with the static data. If you set it to `500,000`, you are wasting memory and forcing the browser to allocate unnecessary pages.
- **Memory Growth Constraint**: Because `131,072` (Start offset) + `57,600` (Input size) + `16` (Output size) equals `188,688` bytes, the WASM memory buffer must be at least 3 full pages (`196,608` bytes) to prevent an out-of-bounds crash. JavaScript must dynamically call `memory.grow(pagesNeeded)` if the initial memory buffer is too small.

---

## 5. Statefulness and the `motionDelta` Ordering Constraint

This WASM module is **Stateful**. It intentionally stores the grayscale data of the *previous* frame it processed in the `previousFrameGray` static buffer.

**The Logic:**
- **Why?** The `motionDelta` metric is calculated by finding the absolute difference in pixel brightness between the current frame and the previous frame. 
- On the very first frame sent to a fresh WASM instance, there is no previous frame. `motionDelta` correctly returns `0.0`. After processing, the current frame is saved. 
- When the *next* frame is processed, `motionDelta` compares it against the saved frame.

**The Hard Constraint for Phase 2 Workers:**
Because of this stateful internal memory, **you absolutely cannot process frames out of chronological order** within the same WASM instance. 
- **What happens if you break this rule?** If a Worker processes Frame 10, and then is immediately assigned to process Frame 500, the `motionDelta` for Frame 500 will be compared against Frame 10. The system will falsely report an explosive, massive spike in motion (a scene change), ruining the data.
- **The Worker Assignment Rule**: When the Web Worker pool is built in Phase 2, each Worker (and its embedded WASM instance) must be assigned a single, contiguous "window" of video frames. It must process that entire window sequentially (e.g., Frame 1, Frame 2, Frame 3). If a Worker jumps to a new segment, the very first frame of that new segment will unavoidably generate a corrupted `motionDelta` (which must be ignored or flagged by the Orchestrator).

---

## 6. Downscaling and the "Zero-Copy" Tradeoff (Phase 2 Addendum)

During the decoding phase, the raw `VideoFrame` must be downscaled to exactly 160x90 to match our fixed 57,600-byte input buffer. This downscaling is achieved by drawing the `VideoFrame` onto an `OffscreenCanvas` and reading the pixels back via `getImageData`.

**Crucial Architecture Note:**
This specific step is **not** zero-copy. Reading from a canvas (`getImageData`) forces a GPU-to-CPU memory copy, and often involves a format conversion (e.g., YUV to RGBA). 
This is a deliberate, documented tradeoff for this Proof-of-Concept. It allows us to seamlessly downscale video of *any* arbitrary resolution into our strict 160x90 WASM contract without writing a complex, manual YUV resampler in WebAssembly. Because of this readback penalty, this pipeline should not be described as "fully zero-copy".
