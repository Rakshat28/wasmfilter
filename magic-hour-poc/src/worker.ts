import { loadScorer, ScorerExports } from './loader';
import { WorkerScoreRequest, WorkerScoreResponse } from './types';

// Cast self to a basic Worker-like interface to satisfy DOM typings
const workerGlobal = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerScoreRequest>) => Promise<void>) | null;
  postMessage: (msg: WorkerScoreResponse) => void;
};

// Use Page 3 to avoid AssemblyScript static data collision (as documented in MEMORY_LAYOUT.md)
const RGBA_SCRATCH_OFFSET = 131072;
const OUT_SCRATCH_OFFSET = 131072 + 57600;

let scorerPromise: Promise<ScorerExports> | null = null;

async function getScorer(): Promise<ScorerExports> {
  if (scorerPromise === null) {
    scorerPromise = loadScorer().then((scorer) => {
      // Ensure memory is at least 3 pages (196,608 bytes)
      const currentPages = scorer.memory.buffer.byteLength / 65536;
      const requiredPages = 3;
      if (currentPages < requiredPages) {
        scorer.memory.grow(requiredPages - currentPages);
      }
      return scorer;
    });
  }
  return scorerPromise;
}

// Start loading immediately on worker startup
void getScorer();

workerGlobal.onmessage = async (e: MessageEvent<WorkerScoreRequest>): Promise<void> => {
  const request = e.data;

  try {
    const scorer = await getScorer();

    // 1. Copy incoming pixels into WASM memory
    const wasmMem8 = new Uint8Array(scorer.memory.buffer);
    const incomingPixels = new Uint8Array(request.pixels);
    wasmMem8.set(incomingPixels, RGBA_SCRATCH_OFFSET);

    // 2. Call scoring function
    scorer.scoreFrame(RGBA_SCRATCH_OFFSET, OUT_SCRATCH_OFFSET);

    // 3. Read back 4 f32s (16 bytes)
    const outView = new Float32Array(scorer.memory.buffer, OUT_SCRATCH_OFFSET, 4);

    const response: WorkerScoreResponse = {
      type: 'FRAME_SCORE',
      taskId: request.taskId,
      faceCount: outView[0],
      faceConfidence: outView[1],
      sharpness: outView[2],
      motionDelta: outView[3],
    };

    // 4. Post response
    workerGlobal.postMessage(response);
  } catch (err) {
    // Pass error back so the orchestrator can reject the promise
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Worker failed on taskId ${request.taskId}: ${errorMsg}`, { cause: err });
  }
};
