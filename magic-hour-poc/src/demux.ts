import * as MP4Box from 'mp4box';
import type { MP4ArrayBuffer, MP4File, MP4Info, MP4Sample } from 'mp4box';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  MAX_VIDEO_RESOLUTION_HEIGHT,
  MAX_VIDEO_RESOLUTION_WIDTH,
} from './thresholds';

function createChunk(sample: MP4Sample): EncodedVideoChunk {
  const type: EncodedVideoChunkType = sample.is_sync ? 'key' : 'delta';
  return new EncodedVideoChunk({
    type,
    timestamp: (sample.cts / sample.timescale) * 1000000,
    duration: (sample.duration / sample.timescale) * 1000000,
    data: sample.data,
  });
}

export async function* demuxWindow(
  file: File,
  startSeconds: number,
  endSeconds: number,
  signal: AbortSignal,
): AsyncGenerator<EncodedVideoChunk> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`demuxWindow: File size ${file.size} exceeds maximum ${MAX_FILE_SIZE_BYTES}`);
  }

  const header = await file.slice(0, 8).arrayBuffer();
  if (header.byteLength < 8) {
    throw new Error('demuxWindow: File too small to be a valid MP4');
  }

  const headerView = new Uint8Array(header);
  if (
    headerView[4] !== 0x66 ||
    headerView[5] !== 0x74 ||
    headerView[6] !== 0x79 ||
    headerView[7] !== 0x70
  ) {
    throw new Error('demuxWindow: Invalid magic bytes; not an MP4 (missing ftyp box)');
  }

  const mp4boxfile: MP4File = MP4Box.createFile();
  const stream = file.stream();
  const reader = stream.getReader();

  let offset = 0;
  let videoTrackId = -1;

  let lastKeyframeBeforeStart: MP4Sample | null = null;
  let yieldedKeyframe = false;
  let done = false;

  const pendingSamples: MP4Sample[] = [];
  let errorObj: Error | null = null;

  mp4boxfile.onReady = (info: MP4Info): void => {
    if (info.videoTracks.length === 0) {
      errorObj = new Error('demuxWindow: No video tracks found');
      return;
    }
    const track = info.videoTracks[0];
    videoTrackId = track.id;

    const durationSec =
      track.nb_samples > 0 && info.duration > 0 ? info.duration / info.timescale : 0;

    if (durationSec > MAX_VIDEO_DURATION_SECONDS) {
      errorObj = new Error(
        `demuxWindow: Video duration ${durationSec} exceeds max ${MAX_VIDEO_DURATION_SECONDS}`,
      );
      return;
    }

    if (track.video) {
      if (
        track.video.width > MAX_VIDEO_RESOLUTION_WIDTH ||
        track.video.height > MAX_VIDEO_RESOLUTION_HEIGHT
      ) {
        errorObj = new Error(
          `demuxWindow: Video resolution ${track.video.width}x${track.video.height} exceeds max ${MAX_VIDEO_RESOLUTION_WIDTH}x${MAX_VIDEO_RESOLUTION_HEIGHT}`,
        );
        return;
      }
    }

    mp4boxfile.setExtractionOptions(videoTrackId, null, { nbSamples: track.nb_samples });
    mp4boxfile.start();
  };

  mp4boxfile.onError = (e: string | Error): void => {
    errorObj = e instanceof Error ? e : new Error(String(e));
  };

  mp4boxfile.onSamples = (id: number, user: unknown, samples: MP4Sample[]): void => {
    if (id !== videoTrackId) return;
    for (const sample of samples) {
      pendingSamples.push(sample);
    }
  };

  try {
    while (!done) {
      if (signal.aborted) {
        throw new Error('demuxWindow: Aborted via signal');
      }
      if (errorObj !== null) {
        throw new Error(String(errorObj));
      }

      while (pendingSamples.length > 0) {
        const sample = pendingSamples.shift() as MP4Sample;
        const timeSec = sample.cts / sample.timescale;

        if (timeSec < startSeconds) {
          if (sample.is_sync || sample.is_rap) {
            lastKeyframeBeforeStart = sample;
          }
        } else if (timeSec >= startSeconds && timeSec <= endSeconds) {
          if (!yieldedKeyframe) {
            if (lastKeyframeBeforeStart && !sample.is_sync && !sample.is_rap) {
              yield createChunk(lastKeyframeBeforeStart);
            }
            yieldedKeyframe = true;
          }
          yield createChunk(sample);
        } else if (timeSec > endSeconds) {
          done = true;
          break;
        }
      }

      if (done) break;

      const { done: readerDone, value } = await reader.read();
      if (readerDone) {
        break;
      }

      const chunk = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const buffer = chunk.buffer as MP4ArrayBuffer;
      buffer.fileStart = offset;

      offset = mp4boxfile.appendBuffer(buffer);

      if (offset < 0) {
        throw new Error('mp4box appendBuffer error');
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Aborted')) {
      throw err;
    }
    throw new Error(`demux failed: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  } finally {
    reader.releaseLock();
    mp4boxfile.stop();
    mp4boxfile.flush();
  }
}

export async function getVideoConfig(file: File): Promise<VideoDecoderConfig> {
  return new Promise((resolve, reject) => {
    const mp4boxfile = MP4Box.createFile();
    const reader = file.stream().getReader();
    let offset = 0;
    let trackId = -1;

    mp4boxfile.onReady = (info: MP4Info): void => {
      if (info.videoTracks.length === 0) {
        reject(new Error('getVideoConfig: No video tracks found'));
        return;
      }
      const track = info.videoTracks[0];

      let description: Uint8Array | undefined;
      

      const trak = (mp4boxfile as any).moov.traks.find((t: any) => t.tkhd.track_id === track.id);
      if (trak) {
        const entries = trak.mdia.minf.stbl.stsd.entries;
        for (const entry of entries) {
          const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
          if (box) {
            const DataStream = (MP4Box as any).DataStream;
            const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
            box.write(stream);

            description = new Uint8Array(stream.buffer, 8);
            break;
          }
        }
      }

      const config: VideoDecoderConfig = {
        codec: track.codec,
        codedWidth: track.video?.width,
        codedHeight: track.video?.height,
        description: description,
      };

      reader.releaseLock();
      resolve(config);
    };

    mp4boxfile.onError = (e: string | Error): void => {
      reader.releaseLock();
      reject(e instanceof Error ? e : new Error(String(e)));
    };

    async function readLoop(): Promise<void> {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            mp4boxfile.flush();
            reject(new Error('getVideoConfig: Stream ended without firing onReady'));
            break;
          }
          const chunk = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
          const buffer = chunk.buffer as MP4ArrayBuffer;
          buffer.fileStart = offset;
          offset = mp4boxfile.appendBuffer(buffer);
        }
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }

    readLoop().catch((err) => reject(err instanceof Error ? err : new Error(String(err))));
  });
}
