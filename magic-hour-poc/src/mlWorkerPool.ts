import { log } from './log';
import { MAX_IN_FLIGHT_FRAMES } from './thresholds';
import {
  FrameScore,
  Seconds,
  WorkerScoreRequest,
  WorkerResponse,
  WorkerScoreResponse,
} from './types';

interface QueuedRequest {
  taskId: number;
  timestamp: Seconds;
  pixels: ArrayBuffer;
  width: number;
  height: number;
  resolve: (score: Omit<FrameScore, 'flags'>) => void;
  reject: (err: Error) => void;
}

export class MlWorkerPool {
  private worker: Worker;
  private workerAvailable = true;
  private queue: QueuedRequest[] = [];
  private pendingResolver: {
    taskId: number;
    timestamp: Seconds;
    resolve: (score: Omit<FrameScore, 'flags'>) => void;
    reject: (err: Error) => void;
  } | null = null;
  private nextTaskId = 0;
  private inFlightCount = 0;
  private totalHeapBytes = 0;

  constructor() {
    this.worker = new Worker(new URL('./mlWorker.ts', import.meta.url), { type: 'module' });

    this.worker.onmessage = (e: MessageEvent<WorkerResponse>): void => {
      const data = e.data;
      if (data.type === 'WORKER_INIT') {
        this.totalHeapBytes += data.heapBytes;
      } else if (data.type === 'FRAME_SCORE') {
        this.handleResponse(data);
      } else if (data.type === 'WORKER_ERROR') {
        this.handleError(data);
      }
    };

    this.worker.onerror = (err: ErrorEvent): void => {
      log.error('MlWorkerPool', 'Worker failed unconditionally', err.message);
      if (this.pendingResolver !== null) {
        this.pendingResolver.reject(new Error(`ML Worker crashed: ${err.message}`));
        this.pendingResolver = null;
        this.inFlightCount--;
      }
      for (const queued of this.queue) {
        queued.reject(new Error(`ML Worker crashed: ${err.message}`));
      }
      this.queue = [];
      this.workerAvailable = true;
    };
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
        new Error(`MlWorkerPool: MAX_IN_FLIGHT_FRAMES (${MAX_IN_FLIGHT_FRAMES}) exceeded`),
      );
    }

    const taskId = this.nextTaskId++;
    const tsSeconds = timestamp as Seconds;

    return new Promise((resolve, reject) => {
      if (this.workerAvailable) {
        this.dispatch(taskId, tsSeconds, pixels, width, height, resolve, reject);
      } else {
        this.queue.push({ taskId, timestamp: tsSeconds, pixels, width, height, resolve, reject });
      }
    });
  }

  private dispatch(
    taskId: number,
    timestamp: Seconds,
    pixels: ArrayBuffer,
    width: number,
    height: number,
    resolve: (score: Omit<FrameScore, 'flags'>) => void,
    reject: (err: Error) => void,
  ): void {
    this.workerAvailable = false;
    this.inFlightCount++;
    this.pendingResolver = { taskId, timestamp, resolve, reject };

    const request: WorkerScoreRequest = {
      type: 'SCORE_FRAME',
      taskId,
      timestamp,
      pixels,
      width,
      height,
    };

    this.worker.postMessage(request, [pixels]);
  }

  private handleResponse(response: WorkerScoreResponse): void {
    const state = this.pendingResolver;
    if (state !== null && state.taskId === response.taskId) {
      this.pendingResolver = null;
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

    this.workerAvailable = true;

    if (this.queue.length > 0) {
      const nextTask = this.queue.shift() as QueuedRequest;
      this.dispatch(
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

  private handleError(response: { taskId: number; error: string }): void {
    const state = this.pendingResolver;
    if (state !== null && state.taskId === response.taskId) {
      this.pendingResolver = null;
      this.inFlightCount--;
      state.reject(new Error(`Worker error: ${response.error}`));
    }

    this.workerAvailable = true;

    if (this.queue.length > 0) {
      const nextTask = this.queue.shift() as QueuedRequest;
      this.dispatch(
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

  public resetKillSwitch(): void {
    this.worker.postMessage({ type: 'RESET_KILL_SWITCH' });
  }
}
