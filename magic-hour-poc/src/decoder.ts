import { demuxWindow, getVideoConfig } from './demux';
import { log } from './log';

export interface DecodedFramePixels {
  timestampSec: number;
  pixels: Uint8ClampedArray;
}

let offscreenCanvas: OffscreenCanvas | null = null;
let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

export function downscaleFrame(source: VideoFrame | HTMLVideoElement): Uint8ClampedArray {
  if (offscreenCanvas === null || offscreenCtx === null) {
    offscreenCanvas = new OffscreenCanvas(160, 90);
    const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) {
      throw new Error('downscaleFrame: Failed to get 2d context');
    }
    offscreenCtx = ctx;
  }

  offscreenCtx.drawImage(source, 0, 0, 160, 90);
  const imageData = offscreenCtx.getImageData(0, 0, 160, 90);
  return imageData.data;
}

export async function* decodeWindowLegacy(
  file: File,
  targetTimestamps: number[],
  signal: AbortSignal,
): AsyncGenerator<DecodedFramePixels> {
  if (signal.aborted) {
    throw new Error('decodeWindowLegacy: Aborted via signal');
  }

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = (): void => resolve();
      video.onerror = (): void => reject(new Error('Failed to load video for legacy decoding'));
      video.load();
    });

    for (const t of targetTimestamps) {
      if (signal.aborted) {
        throw new Error('decodeWindowLegacy: Aborted via signal');
      }

      await new Promise<void>((resolve, reject) => {
        const onSeeked = (): void => {
          video.removeEventListener('seeked', onSeeked);
          video.removeEventListener('error', onError);
          resolve();
        };
        const onError = (): void => {
          video.removeEventListener('seeked', onSeeked);
          video.removeEventListener('error', onError);
          reject(new Error(`Failed to seek video to ${t}`));
        };
        video.addEventListener('seeked', onSeeked);
        video.addEventListener('error', onError);
        video.currentTime = t;
      });

      const pixels = downscaleFrame(video);
      yield { timestampSec: t, pixels };
    }
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}

export async function* decodeWindow(
  file: File,
  targetTimestamps: number[],
  signal: AbortSignal,
): AsyncGenerator<DecodedFramePixels> {
  if (targetTimestamps.length === 0) return;

  const startSeconds = targetTimestamps[0];
  const endSeconds = targetTimestamps[targetTimestamps.length - 1];

  let config: VideoDecoderConfig;
  try {
    config = await getVideoConfig(file);
  } catch (err) {
    log.warn(
      'decoder',
      'WebCodecs getVideoConfig failed, falling back to legacy video decoder',
      err,
    );
    yield* decodeWindowLegacy(file, targetTimestamps, signal);
    return;
  }

  if (signal.aborted) {
    throw new Error('decodeWindow: Aborted via signal before decode');
  }

  const frameQueue: DecodedFramePixels[] = [];
  let decodeError: Error | null = null;
  let isFlushed = false;
  let resolveWaiter: (() => void) | null = null;

  let nextTargetIndex = 0;
  const tolerance = 0.25;

  const notifyWaiter = (): void => {
    if (resolveWaiter !== null) {
      const r = resolveWaiter;
      resolveWaiter = null;
      r();
    }
  };

  const decoder = new VideoDecoder({
    output: (frame: VideoFrame): void => {
      const frameTimeSec = frame.timestamp / 1000000;

      if (nextTargetIndex < targetTimestamps.length) {
        let targetTimeSec = targetTimestamps[nextTargetIndex];

        while (
          nextTargetIndex < targetTimestamps.length &&
          frameTimeSec > targetTimeSec + tolerance
        ) {
          nextTargetIndex++;
          if (nextTargetIndex < targetTimestamps.length) {
            targetTimeSec = targetTimestamps[nextTargetIndex];
          }
        }

        if (
          nextTargetIndex < targetTimestamps.length &&
          Math.abs(frameTimeSec - targetTimeSec) <= tolerance
        ) {
          try {
            const pixels = downscaleFrame(frame);
            frameQueue.push({ timestampSec: targetTimeSec, pixels });
            nextTargetIndex++;
          } catch (err) {
            decodeError = err instanceof Error ? err : new Error(String(err));
          }
        }
      }

      frame.close();
      notifyWaiter();
    },
    error: (e: Error): void => {
      decodeError = e;
      notifyWaiter();
    },
  });

  try {
    decoder.configure(config);
  } catch (err) {
    log.warn('decoder', 'VideoDecoder configure failed, falling back to legacy decoder', err);
    yield* decodeWindowLegacy(file, targetTimestamps, signal);
    return;
  }

  const decodeTask = (async (): Promise<void> => {
    try {
      const demuxer = demuxWindow(file, startSeconds, endSeconds, signal);
      for await (const chunk of demuxer) {
        if (signal.aborted) {
          throw new Error('decodeWindow: Aborted via signal during demux');
        }
        while (decoder.decodeQueueSize >= 24) {
          await new Promise<void>((r) => setTimeout(r, 10));
        }
        decoder.decode(chunk);
      }
      await decoder.flush();
    } catch (err) {
      decodeError = err instanceof Error ? err : new Error(String(err));
    } finally {
      isFlushed = true;
      notifyWaiter();
    }
  })();

  let yieldedCount = 0;

  try {
    while (true) {
      if (decodeError !== null) {
        throw new Error(`decode failed: ${String(decodeError)}`, { cause: decodeError });
      }
      if (signal.aborted) {
        throw new Error('decodeWindow: Aborted via signal');
      }

      if (frameQueue.length > 0) {
        const item = frameQueue.shift() as DecodedFramePixels;
        yieldedCount++;
        yield item;
      } else if (isFlushed) {
        if (frameQueue.length > 0) {
          const item = frameQueue.shift() as DecodedFramePixels;
          yieldedCount++;
          yield item;
        } else {
          break;
        }
      } else {
        await new Promise<void>((resolve) => {
          resolveWaiter = resolve;
        });
      }
    }

    await decodeTask;
  } finally {
    frameQueue.length = 0;
    if (decoder.state !== 'closed') {
      try {
        decoder.close();
      } catch {
        /* empty */
      }
    }
  }

  if (yieldedCount === 0 && !signal.aborted) {
    log.warn('decoder', 'WebCodecs yielded 0 frames, falling back to legacy video decoder');
    yield* decodeWindowLegacy(file, targetTimestamps, signal);
  }
}
