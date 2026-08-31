export type Seconds = number & { readonly __brand: 'Seconds' };

export type FrameFlag = 'BLUR' | 'NO_FACE' | 'MULTI_FACE' | 'LOW_CONFIDENCE' | 'HIGH_MOTION';

export interface FrameScore {
  readonly t: Seconds;
  readonly faceCount: number;
  readonly faceConfidence: number;
  readonly sharpness: number;
  readonly motionDelta: number;
  readonly flags: ReadonlyArray<FrameFlag>;
}

export interface IngestVerdict {
  readonly pass: boolean;
  readonly frameScores: ReadonlyArray<FrameScore>;
  readonly badFrameRatio: number;
  readonly dominantFlags: ReadonlyArray<FrameFlag>;
}

export interface WorkerScoreRequest {
  readonly type: 'SCORE_FRAME';
  readonly taskId: number;
  readonly timestamp: Seconds;
  readonly pixels: ArrayBuffer;
}

export interface WorkerScoreResponse {
  readonly type: 'FRAME_SCORE';
  readonly taskId: number;
  readonly faceCount: number;
  readonly faceConfidence: number;
  readonly sharpness: number;
  readonly motionDelta: number;
}

export function assertNever(x: never): never {
  throw new Error('Unexpected value: ' + String(x));
}
