/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTest() {
  const wasmBuffer = fs.readFileSync(path.join(__dirname, '../build/scorer.wasm'));
  const wasmModule = await WebAssembly.instantiate(wasmBuffer, {
    env: {
      abort: () => {
        throw new Error('WASM aborted');
      }
    }
  });

  const exports = wasmModule.instance.exports as any;
  const scoreFrame = exports.scoreFrame;
  const memory = exports.memory as WebAssembly.Memory;

  const ANALYSIS_WIDTH = 160;
  const ANALYSIS_HEIGHT = 90;
  const ANALYSIS_PIXEL_COUNT = ANALYSIS_WIDTH * ANALYSIS_HEIGHT;
  const ANALYSIS_BUFFER_BYTES = ANALYSIS_PIXEL_COUNT * 4;

  const rgbaPtr = 131072;
  const outPtr = rgbaPtr + ANALYSIS_BUFFER_BYTES;
  const requiredMemory = outPtr + 16;
  
  if (memory.buffer.byteLength < requiredMemory) {
    const pagesNeeded = Math.ceil((requiredMemory - memory.buffer.byteLength) / 65536);
    memory.grow(pagesNeeded);
  }

  const memArray = new Uint8Array(memory.buffer);
  const outArray = new Float32Array(memory.buffer, outPtr, 4);

  for (let i = 0; i < ANALYSIS_PIXEL_COUNT; i++) {
    const offset = rgbaPtr + i * 4;
    memArray[offset] = 128;
    memArray[offset + 1] = 128;
    memArray[offset + 2] = 128;
    memArray[offset + 3] = 255;
  }

  scoreFrame(rgbaPtr, outPtr);
  const solidGrayFaceCount = outArray[0];
  const solidGrayFaceConf = outArray[1];
  const solidGraySharpness = outArray[2];
  const solidGrayMotion = outArray[3];

  console.log(`solid gray: faceCount=${solidGrayFaceCount}, conf=${solidGrayFaceConf}, sharpness=${solidGraySharpness}, motionDelta=${solidGrayMotion}`);

  for (let y = 0; y < ANALYSIS_HEIGHT; y++) {
    for (let x = 0; x < ANALYSIS_WIDTH; x++) {
      const idx = y * ANALYSIS_WIDTH + x;
      const offset = rgbaPtr + idx * 4;
      const val = (x + y) % 2 === 0 ? 0 : 255;
      memArray[offset] = val;
      memArray[offset + 1] = val;
      memArray[offset + 2] = val;
      memArray[offset + 3] = 255;
    }
  }

  scoreFrame(rgbaPtr, outPtr);
  const checkerFaceCount = outArray[0];
  const checkerFaceConf = outArray[1];
  const checkerSharpness = outArray[2];
  const checkerMotion = outArray[3];

  console.log(`checkerboard: faceCount=${checkerFaceCount}, conf=${checkerFaceConf}, sharpness=${checkerSharpness}, motionDelta=${checkerMotion}`);

  if (checkerSharpness <= solidGraySharpness) {
    throw new Error('test-wasm-harness: checkerboard sharpness should be strictly greater than solid gray sharpness');
  }
}

runTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
