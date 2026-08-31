import { readFileSync } from 'fs';
import { File } from 'buffer';
import { demuxWindow } from './src/demux.ts';

// Mock EncodedVideoChunk for Node.js testing
global.EncodedVideoChunk = class EncodedVideoChunk {
  constructor(init) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration;
    this.byteLength = init.data.byteLength;
  }
} as any;

async function testDemux() {
  const buffer = readFileSync('./public/test-assets/clean-sample.mp4');
  const file = new File([buffer], 'clean-sample.mp4', { type: 'video/mp4' });
  const controller = new AbortController();

  try {
    let count = 0;
    for await (const chunk of demuxWindow(file as any, 0, 2, controller.signal)) {
      console.log(`Chunk ${count++}: type=${chunk.type}, timestamp=${chunk.timestamp}`);
      if (count >= 5) break; // just test the first few
    }
    
    if (count > 0) {
      console.log('SUCCESS: Generated at least one chunk!');
      process.exit(0);
    } else {
      console.log('FAILED: No chunks generated.');
      process.exit(1);
    }
  } catch (err) {
    console.error('FAILED with error:', err);
    process.exit(1);
  }
}

testDemux();
