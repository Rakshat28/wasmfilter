import { IngestOrchestrator } from './src/orchestrator.ts';
import { WorkerPool } from './src/workerPool.ts';
import { readFileSync, writeFileSync } from 'fs';
import { File } from 'buffer';

// Mocks to simulate browser environment in Node
global.Worker = class Worker {
  constructor() {}
  onmessage: any;
  onerror: any;
  postMessage() {}
} as any;

global.window = {
  setTimeout: setTimeout as any,
  clearTimeout: clearTimeout as any
} as any;

// Mock WebCodecs and DOM objects so demux/decode can run and fail
global.EncodedVideoChunk = class EncodedVideoChunk {
  constructor(init: any) {}
} as any;

global.VideoFrame = class VideoFrame {
  constructor(init: any) {}
  close() {}
} as any;

global.VideoDecoder = class VideoDecoder {
  constructor(init: any) {}
  configure() {}
  decode() {}
  async flush() {}
  close() {}
} as any;

global.OffscreenCanvas = class OffscreenCanvas {
  constructor() {}
  getContext() {
    return { drawImage() {}, getImageData() { return { data: new Uint8ClampedArray(57600) }; } };
  }
} as any;

async function runFailOpenTest() {
  // 1. Create a fake corrupted file (less than 8 bytes to trigger demux failure)
  const corruptedPath = './public/test-assets/corrupted.mp4';
  writeFileSync(corruptedPath, Buffer.from([0x00, 0x01]));
  
  const buffer = readFileSync(corruptedPath);
  const file = new File([buffer], 'corrupted.mp4', { type: 'video/mp4' });

  const pool = new WorkerPool();
  const orchestrator = new IngestOrchestrator(pool);
  const controller = new AbortController();

  console.log('Feeding corrupted file to orchestrator...');
  
  try {
    const verdict = await orchestrator.scoreWindow(file as any, 0, 5, controller.signal);
    
    // We expect the orchestrator to fail open and return a passing verdict, rather than throwing!
    if (verdict.pass === true && verdict.frameScores.length === 0) {
      console.log('SUCCESS: Orchestrator failed open and returned a clean passing verdict!');
      process.exit(0);
    } else {
      console.error('FAILED: Orchestrator did not return the expected fail-open verdict.');
      process.exit(1);
    }
  } catch (err) {
    console.error('FAILED: Orchestrator threw an exception instead of failing open!', err);
    process.exit(1);
  }
}

runFailOpenTest();
