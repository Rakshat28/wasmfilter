declare module 'mp4box' {
  export interface MP4VideoTrack {
    width: number;
    height: number;
  }

  export interface MP4Track {
    id: number;
    codec: string;
    nb_samples: number;
    video?: MP4VideoTrack;
  }

  export interface MP4Info {
    duration: number;
    timescale: number;
    tracks: MP4Track[];
    videoTracks: MP4Track[];
  }

  export interface MP4Sample {
    track_id: number;
    description: unknown;
    is_rap: boolean;
    is_sync: boolean;
    timescale: number;
    dts: number;
    cts: number;
    duration: number;
    size: number;
    data: ArrayBuffer;
    offset: number;
  }

  export interface MP4ArrayBuffer extends ArrayBuffer {
    fileStart: number;
  }

  export interface MP4File {
    onReady: ((info: MP4Info) => void) | undefined;
    onError: ((e: string | Error) => void) | undefined;
    onSamples: ((id: number, user: unknown, samples: MP4Sample[]) => void) | undefined;

    appendBuffer(data: MP4ArrayBuffer): number;
    setExtractionOptions(id: number, user: unknown, options: { nbSamples: number }): void;
    start(): void;
    stop(): void;
    flush(): void;
  }

  export function createFile(): MP4File;
}
