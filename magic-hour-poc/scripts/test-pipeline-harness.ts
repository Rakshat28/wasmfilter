import { IngestOrchestrator } from '../src/orchestrator';
import { WorkerPool } from '../src/workerPool';

async function fetchVideoAsFile(filename: string): Promise<File> {
  const response = await fetch(`/test-assets/${filename}`);
  const blob = await response.blob();
  return new File([blob], filename, { type: 'video/mp4' });
}

function printOut(msg: string) {
  const el = document.getElementById('output');
  if (el) el.innerText += msg + '\n';
  console.log(msg);
}

// Hook console.error to print to screen for debugging
const originalConsoleError = console.error;
console.error = function (...args) {
  printOut(`[CONSOLE ERROR] ${args.map(a => (a instanceof Error ? a.stack || a.message : String(a))).join(' ')}`);
  originalConsoleError.apply(console, args);
};

// Also hook console.warn just in case
const originalConsoleWarn = console.warn;
console.warn = function (...args) {
  printOut(`[CONSOLE WARN] ${args.map(a => (a instanceof Error ? a.stack || a.message : String(a))).join(' ')}`);
  originalConsoleWarn.apply(console, args);
};

async function runTest() {
  printOut('Starting Pipeline Integration Test...\n');
  
  const pool = new WorkerPool();
  const orchestrator = new IngestOrchestrator(pool);

  const tests = [
    { file: 'clean-sample.mp4', expectedPass: true, expectedFlag: undefined },
    { file: 'blurry-sample.mp4', expectedPass: false, expectedFlag: 'BLUR' },
    { file: 'no-face-sample.mp4', expectedPass: false, expectedFlag: 'NO_FACE' },
    { file: 'multiple-face-sample.mp4', expectedPass: false, expectedFlag: 'MULTI_FACE' },
  ];

  let allPassed = true;

  for (const t of tests) {
    try {
      printOut(`Fetching ${t.file}...`);
      const file = await fetchVideoAsFile(t.file);
      const controller = new AbortController();
      
      printOut(`Scoring ${t.file}...`);
      // We score 5 seconds just as a quick test, or 10 if needed. Let's score first 5 seconds.
      const start = performance.now();
      const verdict = await orchestrator.scoreWindow(file, 0, 5, controller.signal);
      const end = performance.now();
      
      printOut(`-> Time taken: ${((end - start) / 1000).toFixed(2)}s`);
      printOut(`-> Verdict: pass=${verdict.pass}, framesAnalyzed=${verdict.frameScores.length}, dominantFlags=[${verdict.dominantFlags.join(',')}]`);
      if (verdict.frameScores.length > 0) {
        const scores = verdict.frameScores.map(s => `fc:${s.faceCount}, sh:${s.sharpness.toFixed(1)}`).join(' | ');
        printOut(`   Scores: ${scores}`);
      }
      
      let passMatch = verdict.pass === t.expectedPass;
      let flagMatch = true;
      if (t.expectedFlag) {
        if (!verdict.dominantFlags.includes(t.expectedFlag as any)) {
          flagMatch = false;
        }
      }
      
      if (passMatch && flagMatch) {
        printOut(`-> [OK] Matches expectations\n`);
      } else {
        printOut(`-> [FAIL] Expected pass=${t.expectedPass}, flag=${t.expectedFlag}\n`);
        allPassed = false;
      }
    } catch (err) {
      printOut(`-> [ERROR] Exception testing ${t.file}: ${err instanceof Error ? err.message : String(err)}\n`);
      allPassed = false;
    }
  }

  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.innerText = allPassed ? '✅ All tests passed' : '❌ Tests failed. See output.';
    statusEl.style.color = allPassed ? 'green' : 'red';
  }
}

runTest().catch((err) => {
  printOut(`CRITICAL ERROR: ${err}`);
});
