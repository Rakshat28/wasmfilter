import { File } from 'buffer';
import { readFileSync } from 'fs';
import { decodeWindow, downscaleFrame } from './src/decoder.ts';

// Mock WebCodecs and DOM objects
global.EncodedVideoChunk = class EncodedVideoChunk {
  constructor(init: any) {
    (this as any).type = init.type;
    (this as any).timestamp = init.timestamp;
    (this as any).duration = init.duration;
  }
} as any;

global.VideoFrame = class VideoFrame {
  timestamp: number;
  codedWidth: number;
  codedHeight: number;
  constructor(init: any) {
    this.timestamp = init.timestamp;
    this.codedWidth = 1920;
    this.codedHeight = 1080;
  }
  close() {}
} as any;

let decodeCallback: any = null;
global.VideoDecoder = class VideoDecoder {
  constructor(init: any) {
    decodeCallback = init.output;
  }
  configure() {}
  decode(chunk: any) {
    // Simulate decoding by returning a frame for each chunk
    setTimeout(() => {
      decodeCallback(new (global as any).VideoFrame({ timestamp: chunk.timestamp }));
    }, 10);
  }
  async flush() {
    return new Promise((resolve) => setTimeout(resolve, 50));
  }
  close() {}
} as any;

global.OffscreenCanvas = class OffscreenCanvas {
  constructor() {}
  getContext() {
    return {
      drawImage() {},
      getImageData() {
        return { data: new Uint8ClampedArray(57600) };
      }
    };
  }
} as any;

async function testDecoder() {
  const buffer = readFileSync('./public/test-assets/clean-sample.mp4');
  const file = new File([buffer], 'clean-sample.mp4', { type: 'video/mp4' });
  const controller = new AbortController();

  try {
    let count = 0;
    for await (const frame of decodeWindow(file as any, 0, 2, controller.signal)) {
      console.log(`Frame ${count++}: timestamp=${frame.timestamp}, size=${frame.codedWidth}x${frame.codedHeight}`);
      
      const downscaled = downscaleFrame(frame);
      if (downscaled.byteLength !== 57600) {
        throw new Error(`Invalid downscale size: ${downscaled.byteLength}`);
      }
      console.log(`  -> Downscaled to ${downscaled.byteLength} bytes`);
      
      if (count >= 5) break;
    }
    
    if (count > 0) {
      console.log('SUCCESS: Generated and downscaled frames!');
      process.exit(0);
    } else {
      console.log('FAILED: No frames yielded.');
      process.exit(1);
    }
  } catch (err) {
    console.error('FAILED with error:', err);
    process.exit(1);
  }
}

testDecoder();
