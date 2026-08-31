import { demuxWindow, getVideoConfig } from './demux';

export async function* decodeWindow(
  file: File,
  startSeconds: number,
  endSeconds: number,
  signal: AbortSignal,
): AsyncGenerator<VideoFrame> {
  const config = await getVideoConfig(file);

  if (signal.aborted) {
    throw new Error('decodeWindow: Aborted via signal before decode');
  }

  const frameQueue: VideoFrame[] = [];
  let decodeError: Error | null = null;
  let isFlushed = false;
  const state: { resolveNext: (() => void) | null } = { resolveNext: null };

  const decoder = new VideoDecoder({
    output: (frame: VideoFrame): void => {
      // Time in microseconds to seconds
      const timeSec = frame.timestamp / 1000000;
      if (timeSec >= startSeconds && timeSec <= endSeconds) {
        frameQueue.push(frame);
      } else {
        frame.close();
      }
      if (state.resolveNext !== null) {
        state.resolveNext();
      }
    },
    error: (e: Error): void => {
      decodeError = e;
      if (state.resolveNext !== null) {
        state.resolveNext();
      }
    },
  });

  decoder.configure(config);

  const demuxer = demuxWindow(file, startSeconds, endSeconds, signal);

  // Background task to feed the decoder
  void (async (): Promise<void> => {
    try {
      for await (const chunk of demuxer) {
        if (signal.aborted) {
          throw new Error('decodeWindow: Aborted via signal during demux');
        }
        decoder.decode(chunk);
      }
      await decoder.flush();
      isFlushed = true;
    } catch (err) {
      decodeError = err instanceof Error ? err : new Error(String(err));
    } finally {
      if (state.resolveNext !== null) state.resolveNext();
    }
  })();

  try {
    while (true) {
      if (decodeError !== null) {
        throw new Error(`decode failed: ${String(decodeError)}`, { cause: decodeError });
      }
      if (signal.aborted) {
        throw new Error('decodeWindow: Aborted via signal');
      }

      if (frameQueue.length > 0) {
        const frame = frameQueue.shift() as VideoFrame;
        yield frame;
      } else if (isFlushed) {
        break;
      } else {
        // Wait for more frames or error or flush
        await new Promise<void>((resolve) => {
          state.resolveNext = resolve;
        });
        state.resolveNext = null;
      }
    }
  } finally {
    decoder.close();
  }
}

// Module-level OffscreenCanvas for P2-06
let offscreenCanvas: OffscreenCanvas | null = null;
let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

export function downscaleFrame(frame: VideoFrame): Uint8ClampedArray {
  if (offscreenCanvas === null || offscreenCtx === null) {
    offscreenCanvas = new OffscreenCanvas(160, 90);
    const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) {
      throw new Error('downscaleFrame: Failed to get 2d context');
    }
    offscreenCtx = ctx;
  }

  offscreenCtx.drawImage(frame, 0, 0, 160, 90);
  const imageData = offscreenCtx.getImageData(0, 0, 160, 90);
  return imageData.data;
}
