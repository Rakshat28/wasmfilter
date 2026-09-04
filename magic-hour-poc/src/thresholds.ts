export const BLUR_SHARPNESS_MAX = 4500.0;
// We no longer need MULTI_FACE_SHARPNESS_CHEAT since MediaPipe handles multi-face directly
export const BAD_FRAMING_MIN = 0.5; // Placeholder, to be calibrated with dataset
export const HIGH_MOTION_MIN = 40.0;
export const BAD_FRAME_RATIO_FAIL_THRESHOLD = 0.4;
export const SAMPLE_FPS = 2;
export const DEBOUNCE_MS = 300;
export const MAX_IN_FLIGHT_FRAMES = 24;
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_DURATION_SECONDS = 300;
export const MAX_VIDEO_RESOLUTION_WIDTH = 4096;
export const MAX_VIDEO_RESOLUTION_HEIGHT = 4096;
export const PIPELINE_TIMEOUT_MS = 15000;

import { FrameFlag } from './types';

export function computeFlags(
  faceCount: number,
  faceConfidence: number,
  framingScore: number,
  isClipped: boolean,
  sharpness: number,
  motionDelta: number,
): FrameFlag[] {
  const flags: FrameFlag[] = [];

  if (faceCount === 0) {
    flags.push('NO_FACE');
  } else if (faceCount > 1) {
    flags.push('MULTI_FACE');
  }

  // We only care about blur and framing if there is a face (or multiple faces)
  if (faceCount > 0) {
    if (sharpness < BLUR_SHARPNESS_MAX) {
      flags.push('BLUR');
    }

    if (framingScore < BAD_FRAMING_MIN) {
      flags.push('BAD_FRAMING');
    }

    if (isClipped) {
      flags.push('FACE_CLIPPED');
    }
  }

  if (motionDelta > HIGH_MOTION_MIN) {
    flags.push('HIGH_MOTION');
  }

  return flags;
}
