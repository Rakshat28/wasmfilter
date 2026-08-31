import { IngestOrchestrator } from './src/orchestrator';
import { WorkerPool } from './src/workerPool';
import { IngestVerdict } from './src/types';

// Mock Web Worker and window
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

// Mock WorkerPool since we are just testing debouncing logic
class MockWorkerPool extends WorkerPool {
  constructor() {
    super();
  }
  public async score(): Promise<any> {
    return Promise.resolve();
  }
}

// Mock the orchestrator's scoreWindow to simulate work
class TestOrchestrator extends IngestOrchestrator {
  public async scoreWindow(): Promise<IngestVerdict> {
    // Simulate some work taking 100ms
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      pass: true,
      frameScores: [],
      badFrameRatio: 0,
      dominantFlags: [],
    };
  }
}

async function runDebounceTest() {
  const pool = new MockWorkerPool();
  const orchestrator = new TestOrchestrator(pool);
  
  let callCount = 0;
  
  const onResult = (verdict: IngestVerdict) => {
    callCount++;
    console.log(`onResult called (Total times: ${callCount})`);
  };

  const fakeFile = {} as File;

  console.log('Rapidly calling scoreWindowDebounced 5 times...');
  
  // Call 5 times in rapid succession (under DEBOUNCE_MS which is 300ms)
  orchestrator.scoreWindowDebounced(fakeFile, 0, 1, onResult);
  orchestrator.scoreWindowDebounced(fakeFile, 0, 2, onResult);
  orchestrator.scoreWindowDebounced(fakeFile, 0, 3, onResult);
  orchestrator.scoreWindowDebounced(fakeFile, 0, 4, onResult);
  orchestrator.scoreWindowDebounced(fakeFile, 0, 5, onResult);

  // Wait 1000ms to ensure everything has settled
  await new Promise((resolve) => setTimeout(resolve, 1000));
  
  if (callCount === 1) {
    console.log('SUCCESS: onResult was called exactly once for the last invocation.');
    process.exit(0);
  } else {
    console.log(`FAILED: onResult was called ${callCount} times. Expected exactly 1.`);
    process.exit(1);
  }
}

runDebounceTest();
