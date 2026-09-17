import { FrameFlag } from './types';

const BLUR_SHARPNESS_MAX = 60.0;
const BAD_FRAMING_MIN = 0.5;
const HIGH_MOTION_MIN = 7.0;
export const BAD_FRAME_RATIO_FAIL_THRESHOLD = 0.3;
export const SAMPLE_FPS = 2;
export const DEBOUNCE_MS = 300;
export const MAX_IN_FLIGHT_FRAMES = 24;
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_DURATION_SECONDS = 300;
export const MAX_VIDEO_RESOLUTION_WIDTH = 4096;
export const MAX_VIDEO_RESOLUTION_HEIGHT = 4096;

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
