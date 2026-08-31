import { computeFlags } from './src/thresholds.ts';

function assertFlags(expected: string[], actual: string[]) {
  if (expected.length !== actual.length || !expected.every(e => actual.includes(e))) {
    console.error(`FAILED: Expected [${expected.join(',')}], got [${actual.join(',')}]`);
    process.exit(1);
  }
}

// NO_FACE
assertFlags(['NO_FACE'], computeFlags(0, 0, 100, 0));

// MULTI_FACE
assertFlags(['MULTI_FACE'], computeFlags(2, 0.99, 100, 0));

// BLUR
assertFlags(['BLUR'], computeFlags(1, 0.99, 10, 0)); // Assuming BLUR_SHARPNESS_MAX > 10

// LOW_CONFIDENCE
assertFlags(['LOW_CONFIDENCE'], computeFlags(1, 0.1, 100, 0));

// HIGH_MOTION
assertFlags(['HIGH_MOTION'], computeFlags(1, 0.99, 100, 1000));

// COMBINATION: NO_FACE + BLUR + HIGH_MOTION
// faceConfidence < LOW_CONFIDENCE_MAX is ignored if NO_FACE is true
assertFlags(['NO_FACE', 'BLUR', 'HIGH_MOTION'], computeFlags(0, 0, 10, 1000));

console.log('SUCCESS: All computeFlags tests passed!');
