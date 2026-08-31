export const ANALYSIS_WIDTH: i32 = 160;
export const ANALYSIS_HEIGHT: i32 = 90;
export const ANALYSIS_PIXEL_COUNT: i32 = ANALYSIS_WIDTH * ANALYSIS_HEIGHT;
export const ANALYSIS_BUFFER_BYTES: i32 = ANALYSIS_PIXEL_COUNT * 4;

function toGray(rgba: usize, out: usize): void {
  for (let i: i32 = 0; i < ANALYSIS_PIXEL_COUNT; i++) {
    const offset = i << 2;
    const r = f32(load<u8>(rgba + offset));
    const g = f32(load<u8>(rgba + offset + 1));
    const b = f32(load<u8>(rgba + offset + 2));
    
    const gray = u8(r * 0.299 + g * 0.587 + b * 0.114);
    store<u8>(out + i, gray);
  }
}

let hasPreviousFrame: bool = false;
const previousFrameGray = new StaticArray<u8>(ANALYSIS_PIXEL_COUNT);

function computeSharpness(gray: usize): f32 {
  let sum_x: i64 = 0;
  let sum_x2: i64 = 0;

  for (let y: i32 = 1; y < ANALYSIS_HEIGHT - 1; y++) {
    const rowOffset = y * ANALYSIS_WIDTH;
    for (let x: i32 = 1; x < ANALYSIS_WIDTH - 1; x++) {
      const idx = rowOffset + x;
      const top = i32(load<u8>(gray + idx - ANALYSIS_WIDTH));
      const bottom = i32(load<u8>(gray + idx + ANALYSIS_WIDTH));
      const left = i32(load<u8>(gray + idx - 1));
      const right = i32(load<u8>(gray + idx + 1));
      const center = i32(load<u8>(gray + idx));

      const val = top + bottom + left + right - (center << 2);
      sum_x += i64(val);
      sum_x2 += i64(val) * i64(val);
    }
  }

  const count = f32((ANALYSIS_WIDTH - 2) * (ANALYSIS_HEIGHT - 2));
  const mean = f32(sum_x) / count;
  return (f32(sum_x2) / count) - (mean * mean);
}

function computeMotionDelta(gray: usize): f32 {
  if (!hasPreviousFrame) {
    return 0.0;
  }

  let sum: i64 = 0;
  for (let i: i32 = 0; i < ANALYSIS_PIXEL_COUNT; i++) {
    const current = i32(load<u8>(gray + i));
    const previous = i32(previousFrameGray[i]);
    const diff = current - previous;
    sum += i64(diff < 0 ? -diff : diff);
  }

  return f32(sum) / f32(ANALYSIS_PIXEL_COUNT);
}

function segmentSkin(rgba: usize, mask: usize): void {
  for (let i: i32 = 0; i < ANALYSIS_PIXEL_COUNT; i++) {
    const offset = i << 2;
    const r = f64(load<u8>(rgba + offset));
    const g = f64(load<u8>(rgba + offset + 1));
    const b = f64(load<u8>(rgba + offset + 2));

    const cb = 128.0 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128.0 + 0.5 * r - 0.418688 * g - 0.081312 * b;

    let isSkin: u8 = 0;
    if (cb >= 77.0 && cb <= 127.0 && cr >= 133.0 && cr <= 173.0) {
      isSkin = 1;
    }
    store<u8>(mask + i, isSkin);
  }
}

const visitedMask = new StaticArray<u8>(ANALYSIS_PIXEL_COUNT);
const floodStackIdx = new StaticArray<i32>(ANALYSIS_PIXEL_COUNT);

function estimateFaces(mask: usize, faceCountOut: usize, confidenceOut: usize): void {
  for (let i: i32 = 0; i < ANALYSIS_PIXEL_COUNT; i++) {
    visitedMask[i] = 0;
  }

  let faceCount: i32 = 0;
  let maxValidArea: i32 = 0;

  for (let y: i32 = 0; y < ANALYSIS_HEIGHT; y++) {
    const rowOffset = y * ANALYSIS_WIDTH;
    for (let x: i32 = 0; x < ANALYSIS_WIDTH; x++) {
      const idx = rowOffset + x;
      if (load<u8>(mask + idx) === 1 && visitedMask[idx] === 0) {
        let area: i32 = 0;
        let stackPtr: i32 = 0;

        floodStackIdx[stackPtr] = idx;
        stackPtr++;
        visitedMask[idx] = 1;

        while (stackPtr > 0) {
          stackPtr--;
          const cIdx = floodStackIdx[stackPtr];
          area++;

          const cx = cIdx % ANALYSIS_WIDTH;
          const cy = cIdx / ANALYSIS_WIDTH;

          if (cx > 0) {
            const nIdx = cIdx - 1;
            if (load<u8>(mask + nIdx) === 1 && visitedMask[nIdx] === 0) {
              visitedMask[nIdx] = 1;
              floodStackIdx[stackPtr] = nIdx;
              stackPtr++;
            }
          }
          if (cx < ANALYSIS_WIDTH - 1) {
            const nIdx = cIdx + 1;
            if (load<u8>(mask + nIdx) === 1 && visitedMask[nIdx] === 0) {
              visitedMask[nIdx] = 1;
              floodStackIdx[stackPtr] = nIdx;
              stackPtr++;
            }
          }
          if (cy > 0) {
            const nIdx = cIdx - ANALYSIS_WIDTH;
            if (load<u8>(mask + nIdx) === 1 && visitedMask[nIdx] === 0) {
              visitedMask[nIdx] = 1;
              floodStackIdx[stackPtr] = nIdx;
              stackPtr++;
            }
          }
          if (cy < ANALYSIS_HEIGHT - 1) {
            const nIdx = cIdx + ANALYSIS_WIDTH;
            if (load<u8>(mask + nIdx) === 1 && visitedMask[nIdx] === 0) {
              visitedMask[nIdx] = 1;
              floodStackIdx[stackPtr] = nIdx;
              stackPtr++;
            }
          }
        }

        const areaFraction = f64(area) / f64(ANALYSIS_PIXEL_COUNT);
        if (areaFraction >= 0.02 && areaFraction <= 0.40) {
          faceCount++;
          if (area > maxValidArea) {
            maxValidArea = area;
          }
        }
      }
    }
  }

  let confidence: f64 = 0.0;
  if (faceCount > 0) {
    const areaFraction = f64(maxValidArea) / f64(ANALYSIS_PIXEL_COUNT);
    let dev = (areaFraction - 0.165) / 0.165;
    if (dev < 0.0) dev = -dev;
    let conf = 1.0 - (dev > 1.0 ? 1.0 : dev);
    
    if (faceCount > 1 && conf > 0.5) {
      conf = 0.5;
    }
    confidence = conf;
  }

  store<i32>(faceCountOut, faceCount);
  store<f32>(confidenceOut, f32(confidence));
}

const currentGray = new StaticArray<u8>(ANALYSIS_PIXEL_COUNT);
const skinMask = new StaticArray<u8>(ANALYSIS_PIXEL_COUNT);
const faceStats = new StaticArray<u8>(8);

export function scoreFrame(rgbaPtr: usize, outPtr: usize): void {
  const grayPtr = changetype<usize>(currentGray);
  toGray(rgbaPtr, grayPtr);
  
  const sharpness = computeSharpness(grayPtr);
  const motionDelta = computeMotionDelta(grayPtr);
  
  for (let i = 0; i < ANALYSIS_PIXEL_COUNT; i++) {
    previousFrameGray[i] = currentGray[i];
  }
  hasPreviousFrame = true;
  
  const maskPtr = changetype<usize>(skinMask);
  segmentSkin(rgbaPtr, maskPtr);
  
  const statsPtr = changetype<usize>(faceStats);
  estimateFaces(maskPtr, statsPtr, statsPtr + 4);
  
  const faceCount = load<i32>(statsPtr);
  const faceConfidence = load<f32>(statsPtr + 4);
  
  store<f32>(outPtr, f32(faceCount));
  store<f32>(outPtr + 4, faceConfidence);
  store<f32>(outPtr + 8, sharpness);
  store<f32>(outPtr + 12, motionDelta);
}
