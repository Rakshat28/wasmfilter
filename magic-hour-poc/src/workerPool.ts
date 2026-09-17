import { log } from './log';
import { MAX_IN_FLIGHT_FRAMES } from './thresholds';
import {
  FrameScore,
  Seconds,
  WorkerScoreRequest,
  WorkerResponse,
  WorkerScoreResponse,
} from './types';

interface WorkerState {
  worker: Worker;
  available: boolean;
}

interface QueuedRequest {
  taskId: number;
  timestamp: Seconds;
  pixels: ArrayBuffer;
  width: number;
  height: number;
  resolve: (score: Omit<FrameScore, 'flags'>) => void;
  reject: (err: Error) => void;
}

export class WorkerPool {
  private workers: WorkerState[] = [];
  private queue: QueuedRequest[] = [];
  private pendingResolvers = new Map<
    number,
    {
      timestamp: Seconds;
      resolve: (score: Omit<FrameScore, 'flags'>) => void;
      reject: (err: Error) => void;
    }
  >();
  private nextTaskId = 0;
  private inFlightCount = 0;
  private totalHeapBytes = 0;

  constructor() {
    const numWorkers = Math.max(1, navigator.hardwareConcurrency - 1);

    for (let i = 0; i < numWorkers; i++) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

      worker.onmessage = (e: MessageEvent<WorkerResponse>): void => {
        const data = e.data;
        if (data.type === 'WORKER_INIT') {
          this.totalHeapBytes += data.heapBytes;
        } else if (data.type === 'FRAME_SCORE') {
          this.handleResponse(data, i);
        }
      };

      worker.onerror = (err: ErrorEvent): void => {
        log.error('WorkerPool', 'Worker failed unconditionally', err.message);
        for (const [taskId, state] of this.pendingResolvers.entries()) {
          state.reject(new Error(`Worker crashed: ${err.message}`));
          this.pendingResolvers.delete(taskId);
          this.inFlightCount--;
        }
        for (const queued of this.queue) {
          queued.reject(new Error(`Worker crashed: ${err.message}`));
        }
        this.queue = [];
      };

      this.workers.push({ worker, available: true });
    }
  }

  public getApproxHeapMB(): number {
    return this.totalHeapBytes / (1024 * 1024);
  }

  public score(
    timestamp: number,
    pixels: ArrayBuffer,
    width: number,
    height: number,
  ): Promise<Omit<FrameScore, 'flags'>> {
    if (this.inFlightCount + this.queue.length >= MAX_IN_FLIGHT_FRAMES) {
      return Promise.reject(
        new Error(`WorkerPool: MAX_IN_FLIGHT_FRAMES (${MAX_IN_FLIGHT_FRAMES}) exceeded`),
      );
    }

    const taskId = this.nextTaskId++;
    const tsSeconds = timestamp as Seconds;

    return new Promise((resolve, reject) => {
      const availableIndex = this.workers.findIndex((w) => w.available);

      if (availableIndex !== -1) {
        this.dispatch(availableIndex, taskId, tsSeconds, pixels, width, height, resolve, reject);
      } else {
        this.queue.push({ taskId, timestamp: tsSeconds, pixels, width, height, resolve, reject });
      }
    });
  }

  private dispatch(
    workerIndex: number,
    taskId: number,
    timestamp: Seconds,
    pixels: ArrayBuffer,
    width: number,
    height: number,
    resolve: (score: Omit<FrameScore, 'flags'>) => void,
    reject: (err: Error) => void,
  ): void {
    this.workers[workerIndex].available = false;
    this.inFlightCount++;
    this.pendingResolvers.set(taskId, { timestamp, resolve, reject });

    const request: WorkerScoreRequest = {
      type: 'SCORE_FRAME',
      taskId,
      timestamp,
      pixels,
      width,
      height,
    };

    this.workers[workerIndex].worker.postMessage(request, [pixels]);
  }

  private handleResponse(response: WorkerScoreResponse, workerIndex: number): void {
    const state = this.pendingResolvers.get(response.taskId);
    if (state !== undefined) {
      this.pendingResolvers.delete(response.taskId);
      this.inFlightCount--;

      const score: Omit<FrameScore, 'flags'> = {
        t: state.timestamp,
        faceCount: response.faceCount,
        faceConfidence: response.faceConfidence,
        framingScore: response.framingScore,
        isClipped: response.isClipped,
        sharpness: response.sharpness,
        motionDelta: response.motionDelta,
      };

      state.resolve(score);
    }

    this.workers[workerIndex].available = true;

    if (this.queue.length > 0) {
      const nextTask = this.queue.shift() as QueuedRequest;
      this.dispatch(
        workerIndex,
        nextTask.taskId,
        nextTask.timestamp,
        nextTask.pixels,
        nextTask.width,
        nextTask.height,
        nextTask.resolve,
        nextTask.reject,
      );
    }
  }
}
