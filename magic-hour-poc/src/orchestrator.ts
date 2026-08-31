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
      t <= endSeconds + 0.0001; // epsilon for float math
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

        // Check if within tolerance
        if (Math.abs(frameTimeSec - targetTimeSec) <= tolerance) {
          try {
            const pixels = downscaleFrame(frame);
            // Copy pixels to a fresh buffer to ensure it's precisely 57600 bytes and safe to transfer
            // without inadvertently transferring a larger shared canvas backing buffer if the browser did that.
            const transferBuffer = new Uint8ClampedArray(pixels).buffer;

            scorePromises.push(this.pool.score(targetTimeSec, transferBuffer));
            nextTargetIndex++;
          } catch (err) {
            log.error('IngestOrchestrator', 'Failed to downscale/submit frame', err);
          }
        }

        // Always close the frame
        frame.close();
      }
    } catch (err) {
      // Decode or demux failed. Re-throw to be caught by P2-12 error handling wrapper.
      // Wait, P2-12 says "In orchestrator.ts's scoreWindow, catch that error and return a special IngestVerdict... i.e. fail open"
      // I will implement P2-12 logic here directly to satisfy the "fail open" rule.
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

    // Await all submissions
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
      // If we got no frames at all, it's functionally a failure to read, but fail open per P2-12.
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

    // Abort any currently in-flight process
    if (this.activeController !== null) {
      this.activeController.abort();
    }

    const currentGeneration = ++this.debounceGeneration;
    this.activeController = new AbortController();
    const signal = this.activeController.signal;

    // We use window.setTimeout because Node.js setTimeout returns a Timeout object,
    // which fails TypeScript if we try to assign it to `number | null` unless we typecast.
    // Since this runs in browser, `window.setTimeout` strictly returns `number`.
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;

      void this.scoreWindow(file, startSeconds, endSeconds, signal)
        .then((verdict) => {
          if (currentGeneration === this.debounceGeneration) {
            onResult(verdict);
          }
        })
        .catch((err) => {
          // If aborted, we just ignore. Other errors should have failed open.
          if (err instanceof Error && err.message.includes('Aborted')) {
            return;
          }
          log.error('IngestOrchestrator', 'Unexpected error from scoreWindow', err);
        });
    }, DEBOUNCE_MS);
  }
}
