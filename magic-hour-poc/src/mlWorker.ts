import { loadScorer, ScorerExports } from './loader';
import { WorkerScoreRequest, WorkerScoreResponse, WorkerResponse } from './types';
import { FaceDetector, FilesetResolver, FaceDetectorResult } from '@mediapipe/tasks-vision';
import { log } from './log';

const workerGlobal = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerScoreRequest>) => Promise<void>) | null;
  postMessage: (msg: WorkerResponse) => void;
};

const RGBA_SCRATCH_OFFSET = 131072;
const OUT_SCRATCH_OFFSET = 131072 + 57600;

let scorerPromise: Promise<ScorerExports> | null = null;
let faceDetectorPromise: Promise<{ detector: FaceDetector; delegate: 'GPU' | 'CPU' }> | null = null;

class PerformanceTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PerformanceTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ]);
}

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

async function getFaceDetector(): Promise<{ detector: FaceDetector; delegate: 'GPU' | 'CPU' }> {
  if (faceDetectorPromise === null) {
    faceDetectorPromise = (async (): Promise<{
      detector: FaceDetector;
      delegate: 'GPU' | 'CPU';
    }> => {
      try {
        const vision = await withTimeout(
          FilesetResolver.forVisionTasks(self.location.origin + '/wasm', true),
          5000,
          'FilesetResolver hung',
        );
        try {
          const detector = await withTimeout(
            FaceDetector.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: '/models/blaze_face_short_range.tflite',
                delegate: 'GPU',
              },
              runningMode: 'IMAGE',
              minDetectionConfidence: 0.5,
            }),
            5000,
            'GPU delegate init hung',
          );
          return { detector, delegate: 'GPU' as const };
        } catch (err) {
          log.warn('mlWorker', 'GPU delegate failed or hung, falling back to CPU', err);
          const detector = await withTimeout(
            FaceDetector.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: '/models/blaze_face_short_range.tflite',
                delegate: 'CPU',
              },
              runningMode: 'IMAGE',
              minDetectionConfidence: 0.5,
            }),
            5000,
            'CPU delegate init hung',
          );
          return { detector, delegate: 'CPU' as const };
        }
      } catch (initErr) {
        faceDetectorPromise = null;
        throw initErr;
      }
    })();
  }
  return faceDetectorPromise;
}

void Promise.all([getScorer(), getFaceDetector()])
  .then(([scorer]) => {
    workerGlobal.postMessage({
      type: 'WORKER_INIT',
      heapBytes: scorer.memory.buffer.byteLength,
    });
  })
  .catch((err) => {
    log.error('mlWorker', 'Worker failed to init', err);
  });

let consecutiveSlowFrames = 0;

workerGlobal.onmessage = async (
  e: MessageEvent<import('./types').WorkerRequest>,
): Promise<void> => {
  const request = e.data;

  if (request.type === 'RESET_KILL_SWITCH') {
    consecutiveSlowFrames = 0;
    return;
  }

  try {
    const [scorer, { detector, delegate }] = await Promise.all([getScorer(), getFaceDetector()]);

    const incomingPixels = new Uint8ClampedArray(request.pixels);
    const wasmMem8 = new Uint8Array(scorer.memory.buffer);
    wasmMem8.set(incomingPixels, RGBA_SCRATCH_OFFSET);

    scorer.scoreFrame(RGBA_SCRATCH_OFFSET, OUT_SCRATCH_OFFSET);
    const outView = new Float32Array(scorer.memory.buffer, OUT_SCRATCH_OFFSET, 4);
    const sharpness = outView[2];
    const motionDelta = outView[3];

    const imageData = new ImageData(incomingPixels, request.width, request.height);

    const startTime = performance.now();
    const detections: FaceDetectorResult = detector.detect(imageData);
    const elapsed = performance.now() - startTime;

    if (elapsed > 500) {
      consecutiveSlowFrames++;
      if (consecutiveSlowFrames >= 3) {
        throw new PerformanceTimeoutError(
          `FaceDetector took ${elapsed.toFixed(1)}ms on delegate ${delegate} for frame ${request.taskId}`,
        );
      }
    } else {
      consecutiveSlowFrames = 0;
    }

    let faceCount = 0;
    let faceConfidence = 0;
    let framingScore = 0;
    let isClipped = false;

    if (detections.detections && detections.detections.length > 0) {
      faceCount = detections.detections.length;
      let bestDetection = detections.detections[0];
      for (const d of detections.detections) {
        if (d.categories[0].score > bestDetection.categories[0].score) {
          bestDetection = d;
        }
      }
      faceConfidence = bestDetection.categories[0].score;
      const bb = bestDetection.boundingBox;
      if (bb) {
        const areaFraction = (bb.width * bb.height) / (request.width * request.height);
        framingScore = Math.max(0, 1.0 - Math.min(1.0, Math.abs(areaFraction - 0.165) / 0.165));
        if (
          bb.originX <= 1 ||
          bb.originY <= 1 ||
          bb.originX + bb.width >= request.width - 1 ||
          bb.originY + bb.height >= request.height - 1
        ) {
          isClipped = true;
        }
      }
    }

    const response: WorkerScoreResponse = {
      type: 'FRAME_SCORE',
      taskId: request.taskId,
      faceCount,
      faceConfidence,
      framingScore,
      isClipped,
      sharpness,
      motionDelta,
    };

    workerGlobal.postMessage(response);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (err instanceof PerformanceTimeoutError) {
      log.error('mlWorker', 'Kill switch tripped, failing open', errorMsg);
    }
    workerGlobal.postMessage({
      type: 'WORKER_ERROR',
      taskId: request.taskId,
      error: errorMsg,
    });
  }
};
