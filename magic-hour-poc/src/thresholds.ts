export const BLUR_SHARPNESS_MAX = 15.0;
export const LOW_CONFIDENCE_MAX = 0.4;
export const HIGH_MOTION_MIN = 40.0;
export const BAD_FRAME_RATIO_FAIL_THRESHOLD = 0.2;
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
  sharpness: number,
  motionDelta: number,
): FrameFlag[] {
  const flags: FrameFlag[] = [];

  if (faceCount === 0) {
    flags.push('NO_FACE');
  } else if (faceCount > 1) {
    flags.push('MULTI_FACE');
  }

  if (sharpness < BLUR_SHARPNESS_MAX) {
    flags.push('BLUR');
  }

  // The plan says "Push 'LOW_CONFIDENCE' if faceConfidence < LOW_CONFIDENCE_MAX."
  // However, logically it shouldn't trigger if there is no face at all.
  if (faceCount > 0 && faceConfidence < LOW_CONFIDENCE_MAX) {
    flags.push('LOW_CONFIDENCE');
  }

  if (motionDelta > HIGH_MOTION_MIN) {
    flags.push('HIGH_MOTION');
  }

  return flags;
}
