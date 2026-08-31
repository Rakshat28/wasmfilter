import { WorkerPool } from './src/workerPool.ts';
import { WorkerScoreResponse } from './src/types.ts';

// Mock Web Worker
global.Worker = class Worker {
  onmessage: any;
  onerror: any;
  
  constructor() {}
  
  postMessage(data: any) {
    // Simulate async processing
    setTimeout(() => {
      if (this.onmessage) {
        const response: WorkerScoreResponse = {
          type: 'FRAME_SCORE',
          taskId: data.taskId,
          faceCount: 1,
          faceConfidence: 0.99,
          sharpness: 100,
          motionDelta: data.taskId * 0.5,
        };
        this.onmessage({ data: response });
      }
    }, 10);
  }
} as any;

async function runTest() {
  const pool = new WorkerPool();
  const promises: Promise<any>[] = [];
  
  console.log('Dispatching 30 frames...');
  
  // Dispatch up to 24, then wait for some to finish, then dispatch the rest
  for (let i = 0; i < 30; i++) {
    const pixels = new ArrayBuffer(57600);
    
    // Simple backpressure for the test
    if (i >= 24) {
      await promises[i - 24]; 
    }
    
    promises.push(
      pool.score(i, pixels).then(score => {
        return { taskId: i, score };
      })
    );
  }
  
  const results = await Promise.all(promises);
  results.sort((a, b) => a.taskId - b.taskId);
  
  let valid = true;
  for (let i = 0; i < 30; i++) {
    const res = results[i].score;
    if (res.t !== i) valid = false;
    if (res.motionDelta !== i * 0.5) valid = false;
  }
  
  if (valid && results.length === 30) {
    console.log('SUCCESS: 30 frames resolved correctly!');
    process.exit(0);
  } else {
    console.log('FAILED: Results did not match expected values.');
    process.exit(1);
  }
}

runTest();
