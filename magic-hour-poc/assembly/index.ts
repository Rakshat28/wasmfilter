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
const tempGray = new StaticArray<u8>(ANALYSIS_PIXEL_COUNT);

export function resetState(): void {
  hasPreviousFrame = false;
}

function applyGaussianBlur(src: usize, dst: usize): void {
  // Apply 3x3 Gaussian kernel (1/16)
  for (let y: i32 = 1; y < ANALYSIS_HEIGHT - 1; y++) {
    const rowOffset = y * ANALYSIS_WIDTH;
    for (let x: i32 = 1; x < ANALYSIS_WIDTH - 1; x++) {
      const idx = rowOffset + x;

      const top_left = i32(load<u8>(src + idx - ANALYSIS_WIDTH - 1));
      const top = i32(load<u8>(src + idx - ANALYSIS_WIDTH));
      const top_right = i32(load<u8>(src + idx - ANALYSIS_WIDTH + 1));
      
      const left = i32(load<u8>(src + idx - 1));
      const center = i32(load<u8>(src + idx));
      const right = i32(load<u8>(src + idx + 1));
      
      const bottom_left = i32(load<u8>(src + idx + ANALYSIS_WIDTH - 1));
      const bottom = i32(load<u8>(src + idx + ANALYSIS_WIDTH));
      const bottom_right = i32(load<u8>(src + idx + ANALYSIS_WIDTH + 1));

      const sum = top_left + (top << 1) + top_right +
                  (left << 1) + (center << 2) + (right << 1) +
                  bottom_left + (bottom << 1) + bottom_right;

      store<u8>(dst + idx, u8(sum >> 4));
    }
  }

  // Copy borders directly to avoid bounds checks
  for (let x: i32 = 0; x < ANALYSIS_WIDTH; x++) {
    store<u8>(dst + x, load<u8>(src + x));
    const bottomIdx = (ANALYSIS_HEIGHT - 1) * ANALYSIS_WIDTH + x;
    store<u8>(dst + bottomIdx, load<u8>(src + bottomIdx));
  }
  for (let y: i32 = 1; y < ANALYSIS_HEIGHT - 1; y++) {
    const leftIdx = y * ANALYSIS_WIDTH;
    const rightIdx = leftIdx + ANALYSIS_WIDTH - 1;
    store<u8>(dst + leftIdx, load<u8>(src + leftIdx));
    store<u8>(dst + rightIdx, load<u8>(src + rightIdx));
  }
}

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

  let totalMagnitude: f32 = 0.0;
  let validBlocks: i32 = 0;

  // 160x90 image, 10x10 blocks -> 16 cols, 9 rows
  const BLOCK_SIZE: i32 = 10;
  const COLS: i32 = ANALYSIS_WIDTH / BLOCK_SIZE;
  const ROWS: i32 = ANALYSIS_HEIGHT / BLOCK_SIZE;

  for (let by: i32 = 0; by < ROWS; by++) {
    for (let bx: i32 = 0; bx < COLS; bx++) {
      let sum_Ix2: f32 = 0.0;
      let sum_Iy2: f32 = 0.0;
      let sum_IxIy: f32 = 0.0;
      let sum_IxIt: f32 = 0.0;
      let sum_IyIt: f32 = 0.0;

      // Inside the block, skip the absolute edges of the image to avoid boundary issues
      const byStart = by * BLOCK_SIZE;
      const byEnd = (by + 1) * BLOCK_SIZE;
      const bxStart = bx * BLOCK_SIZE;
      const bxEnd = (bx + 1) * BLOCK_SIZE;
      
      const startY = byStart < 1 ? 1 : byStart;
      const endY = byEnd > ANALYSIS_HEIGHT - 1 ? ANALYSIS_HEIGHT - 1 : byEnd;
      const startX = bxStart < 1 ? 1 : bxStart;
      const endX = bxEnd > ANALYSIS_WIDTH - 1 ? ANALYSIS_WIDTH - 1 : bxEnd;

      for (let y: i32 = startY; y < endY; y++) {
        const rowOffset = y * ANALYSIS_WIDTH;
        for (let x: i32 = startX; x < endX; x++) {
          const idx = rowOffset + x;

          // Spatial derivatives (Ix, Iy) using central difference
          const right = f32(load<u8>(gray + idx + 1));
          const left = f32(load<u8>(gray + idx - 1));
          const bottom = f32(load<u8>(gray + idx + ANALYSIS_WIDTH));
          const top = f32(load<u8>(gray + idx - ANALYSIS_WIDTH));

          const Ix = (right - left) / 2.0;
          const Iy = (bottom - top) / 2.0;

          // Temporal derivative (It)
          const curr = f32(load<u8>(gray + idx));
          const prev = f32(previousFrameGray[idx]);
          const It = curr - prev;

          sum_Ix2 += Ix * Ix;
          sum_Iy2 += Iy * Iy;
          sum_IxIy += Ix * Iy;
          sum_IxIt += Ix * It;
          sum_IyIt += Iy * It;
        }
      }

      // Solve 2x2 linear system for (u, v)
      const det = sum_Ix2 * sum_Iy2 - sum_IxIy * sum_IxIy;
      
      // If determinant is too small (e.g. flat region or no texture), skip to avoid division by zero/noise
      if (det > 1.0) {
        // Cramer's rule
        const u = (sum_Iy2 * (-sum_IxIt) - sum_IxIy * (-sum_IyIt)) / det;
        const v = (sum_Ix2 * (-sum_IyIt) - sum_IxIy * (-sum_IxIt)) / det;
        
        const mag = Math.sqrt(u * u + v * v);
        totalMagnitude += f32(mag);
        validBlocks++;
      }
    }
  }

  if (validBlocks === 0) {
    return 0.0;
  }
  return totalMagnitude / f32(validBlocks);
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
    let conf: f64 = 0.90;
    if (areaFraction < 0.02) {
      conf = Math.max(0.1, areaFraction / 0.02);
    } else if (areaFraction > 0.25) {
      conf = Math.max(0.1, 1.0 - (areaFraction - 0.25) / 0.25);
    }

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
  const tempGrayPtr = changetype<usize>(tempGray);
  toGray(rgbaPtr, grayPtr);
  
  applyGaussianBlur(grayPtr, tempGrayPtr);
  const sharpness = computeSharpness(tempGrayPtr);
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
