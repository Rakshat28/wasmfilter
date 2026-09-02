import { decodeWindow, downscaleFrame } from './decoder';
import { log } from './log';
import { BAD_FRAME_RATIO_FAIL_THRESHOLD, DEBOUNCE_MS, SAMPLE_FPS } from './thresholds';
import { computeFlags } from './thresholds';
import { FrameFlag, FrameScore, IngestVerdict } from './types';
import { WorkerPool } from './workerPool';

export class IngestOrchestrator {
  private pool: WorkerPool;

  constructor(pool: WorkerPool) {
    this.pool = pool;
  }

  public async scoreWindow(
    file: File,
    startSeconds: number,
    endSeconds: number,
    signal: AbortSignal,
  ): Promise<IngestVerdict> {
    const targetTimestamps: number[] = [];
    for (
      let t = startSeconds;
      t <= endSeconds + 0.0001;
      t += 1 / SAMPLE_FPS
    ) {
      targetTimestamps.push(t);
    }

    let nextTargetIndex = 0;
    const scorePromises: Promise<Omit<FrameScore, 'flags'>>[] = [];
    const tolerance = 1 / (2 * SAMPLE_FPS);

    try {
      const generator = decodeWindow(file, startSeconds, endSeconds, signal);
      for await (const frame of generator) {
        if (signal.aborted) {
          frame.close();
          throw new Error('scoreWindow: Aborted via signal');
        }

        if (nextTargetIndex >= targetTimestamps.length) {
          frame.close();
          continue;
        }

        const frameTimeSec = frame.timestamp / 1000000;
        const targetTimeSec = targetTimestamps[nextTargetIndex];


        if (Math.abs(frameTimeSec - targetTimeSec) <= tolerance) {
          try {
            const pixels = downscaleFrame(frame);

            const transferBuffer = new Uint8ClampedArray(pixels).buffer;

            scorePromises.push(this.pool.score(targetTimeSec, transferBuffer));
            nextTargetIndex++;
          } catch (err) {
            log.error('IngestOrchestrator', 'Failed to downscale/submit frame', err);
          }
        }


        frame.close();
      }
    } catch (err) {

      log.error('IngestOrchestrator', 'Pipeline failed, failing open', err);
      return {
        pass: true,
        frameScores: [],
        badFrameRatio: 0,
        dominantFlags: [],
      };
    }

    if (signal.aborted) {
      throw new Error('scoreWindow: Aborted via signal');
    }


    const rawScores = await Promise.all(scorePromises);

    const frameScores: FrameScore[] = rawScores.map((raw) => {
      const flags = computeFlags(raw.faceCount, raw.faceConfidence, raw.sharpness, raw.motionDelta);
      return {
        ...raw,
        flags,
      };
    });

    const totalFrames = frameScores.length;
    if (totalFrames === 0) {

      return { pass: true, frameScores: [], badFrameRatio: 0, dominantFlags: [] };
    }

    let badFramesCount = 0;
    const flagCounts = new Map<FrameFlag, number>();

    for (const score of frameScores) {
      if (score.flags.length > 0) {
        badFramesCount++;
        for (const flag of score.flags) {
          flagCounts.set(flag, (flagCounts.get(flag) || 0) + 1);
        }
      }
    }

    const badFrameRatio = badFramesCount / totalFrames;
    const pass = badFrameRatio <= BAD_FRAME_RATIO_FAIL_THRESHOLD;

    const dominantFlags: FrameFlag[] = [];
    if (!pass) {
      const dominantThreshold = badFramesCount / 2;
      for (const [flag, count] of flagCounts.entries()) {
        if (count > dominantThreshold) {
          dominantFlags.push(flag);
        }
      }
    }

    return {
      pass,
      frameScores,
      badFrameRatio,
      dominantFlags,
    };
  }

  private debounceTimer: number | null = null;
  private debounceGeneration = 0;
  private activeController: AbortController | null = null;

  public scoreWindowDebounced(
    file: File,
    startSeconds: number,
    endSeconds: number,
    onResult: (v: IngestVerdict) => void,
  ): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }


    if (this.activeController !== null) {
      this.activeController.abort();
    }

    const currentGeneration = ++this.debounceGeneration;
    this.activeController = new AbortController();
    const signal = this.activeController.signal;


    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;

      void this.scoreWindow(file, startSeconds, endSeconds, signal)
        .then((verdict) => {
          if (currentGeneration === this.debounceGeneration) {
            onResult(verdict);
          }
        })
        .catch((err) => {

          if (err instanceof Error && err.message.includes('Aborted')) {
            return;
          }
          log.error('IngestOrchestrator', 'Unexpected error from scoreWindow', err);
        });
    }, DEBOUNCE_MS);
  }
}
