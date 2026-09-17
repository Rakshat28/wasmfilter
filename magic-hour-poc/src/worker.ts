import { loadScorer, ScorerExports } from './loader';
import { WorkerScoreRequest, WorkerScoreResponse, WorkerResponse } from './types';
import { log } from './log';

const workerGlobal = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerScoreRequest>) => Promise<void>) | null;
  postMessage: (msg: WorkerResponse) => void;
};

const RGBA_SCRATCH_OFFSET = 131072;
const OUT_SCRATCH_OFFSET = 131072 + 57600;

let scorerPromise: Promise<ScorerExports> | null = null;

async function getScorer(): Promise<ScorerExports> {
  if (scorerPromise === null) {
    scorerPromise = loadScorer().then((scorer) => {
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

void getScorer()
  .then((scorer) => {
    workerGlobal.postMessage({
      type: 'WORKER_INIT',
      heapBytes: scorer.memory.buffer.byteLength,
    });
  })
  .catch((err) => {
    log.error('Worker', 'Worker failed to init', err);
  });

workerGlobal.onmessage = async (e: MessageEvent<WorkerScoreRequest>): Promise<void> => {
  const request = e.data;

  try {
    const scorer = await getScorer();

    const wasmMem8 = new Uint8Array(scorer.memory.buffer);
    const incomingPixels = new Uint8Array(request.pixels);
    wasmMem8.set(incomingPixels, RGBA_SCRATCH_OFFSET);

    scorer.scoreFrame(RGBA_SCRATCH_OFFSET, OUT_SCRATCH_OFFSET);

    const outView = new Float32Array(scorer.memory.buffer, OUT_SCRATCH_OFFSET, 4);

    const response: WorkerScoreResponse = {
      type: 'FRAME_SCORE',
      taskId: request.taskId,
      faceCount: outView[0],
      faceConfidence: outView[1],
      framingScore: 1.0,
      isClipped: false,
      sharpness: outView[2],
      motionDelta: outView[3],
    };

    workerGlobal.postMessage(response);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Worker failed on taskId ${request.taskId}: ${errorMsg}`, { cause: err });
  }
};
