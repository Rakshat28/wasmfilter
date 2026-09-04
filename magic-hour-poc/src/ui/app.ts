import { WorkerPool } from '../workerPool';
import { MlWorkerPool } from '../mlWorkerPool';
import { IngestOrchestrator } from '../orchestrator';
import { createTrimControls } from './trimControls';
import { createMetricsStrip } from './metricsStrip';
import { createVerdictPanel } from './verdictPanel';
import { SAMPLE_FPS } from '../thresholds';

export function initApp(root: HTMLElement): void {
  const pool = new WorkerPool();
  const fullPool = new MlWorkerPool();
  const orchestrator = new IngestOrchestrator(pool, fullPool);

  root.innerHTML = `
    <div class="app-header">
      <div class="app-title">WASMFilter.</div>
      <div class="file-upload-wrapper">
        <div class="file-upload-btn">Upload Video</div>
        <input type="file" accept="video/mp4" class="file-input" />
      </div>
    </div>
    <div class="main-content" id="main-content" style="display: none;">
      <div class="video-section">
        <div class="video-container glass-panel" id="video-container"></div>
        <div class="trim-controls-wrapper glass-panel" id="controls-container"></div>
      </div>
      <div class="side-panel">
        <div class="metrics-strip glass-panel" id="metrics-container"></div>
        <div class="verdict-panel-wrapper glass-panel" id="verdict-container">
          <div class="verdict-header">LIVE INGEST LOG</div>
        </div>
        <button class="btn btn-primary" id="generate-btn" disabled>Generate Face Swap</button>
      </div>
    </div>
  `;

  const fileInput = root.querySelector('.file-input') as HTMLInputElement;
  const mainContent = root.querySelector('#main-content') as HTMLElement;
  const videoContainer = root.querySelector('#video-container') as HTMLElement;
  const controlsContainer = root.querySelector('#controls-container') as HTMLElement;
  const metricsContainer = root.querySelector('#metrics-container') as HTMLElement;
  const verdictContainer = root.querySelector('#verdict-container') as HTMLElement;
  const generateBtn = root.querySelector('#generate-btn') as HTMLButtonElement;

  let fileUrl: string | null = null;
  let fullCheckController: AbortController | null = null;

  fileInput.addEventListener('change', (e: Event): void => {
    void (async (): Promise<void> => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      if (fileUrl) {
        URL.revokeObjectURL(fileUrl);
      }
      fileUrl = URL.createObjectURL(file);

      // Read duration
      const tempVideo = document.createElement('video');
      tempVideo.src = fileUrl;
      
      await new Promise<void>((resolve, reject) => {
        tempVideo.onloadedmetadata = (): void => resolve();
        tempVideo.onerror = (): void => reject(new Error('Failed to load video metadata'));
      });

    const duration = tempVideo.duration;

    // Reset button state for new video
    generateBtn.disabled = true;
    generateBtn.textContent = 'GENERATE FACE SWAP';

    // Show main content
    mainContent.style.display = 'grid';

    // Render components
    videoContainer.innerHTML = '';
    const video = document.createElement('video');
    video.src = fileUrl;
    video.muted = true;
    video.controls = true;
    video.className = 'trim-video';
    videoContainer.appendChild(video);

    const metricsStrip = createMetricsStrip(metricsContainer);
    const verdictPanel = createVerdictPanel(verdictContainer);

    createTrimControls(
      controlsContainer,
      duration,
      (start, end) => {
        orchestrator.abortCurrent();
        verdictPanel.clear();
        verdictPanel.hideProceedButton();
        generateBtn.disabled = true;

        const promptLine = document.createElement('div');
        promptLine.textContent = '> RUNNING FULL ML CHECK (MediaPipe)...';
        promptLine.style.color = 'var(--fg-muted)';
        promptLine.style.fontStyle = 'italic';
        document.querySelector('#verdict-log')?.appendChild(promptLine);

        if (fullCheckController) {
          fullCheckController.abort();
        }
        fullCheckController = new AbortController();

        void orchestrator.scoreWindowFull(file, start, end, fullCheckController.signal).then((verdict) => {
          verdictPanel.clear();

          verdict.frameScores.forEach((score) => {
            verdictPanel.appendLine(score);
          });

          if (verdict.pass && verdict.frameScores.length === 0) {
            const errLine = document.createElement('div');
            errLine.textContent = `> [WARN] Pipeline encountered a fatal decoding error. Failing open (security safety hatch activated). Error: ${verdict.errorMsg}`;
            errLine.style.color = 'var(--danger)';
            errLine.style.fontWeight = 'bold';
            document.querySelector('#verdict-log')?.appendChild(errLine);
          }

          metricsStrip.update(
            SAMPLE_FPS,
            fullPool.getApproxHeapMB() + pool.getApproxHeapMB(),
            verdict.frameScores.map((s) => s.faceConfidence)
          );

          if (!verdict.pass) {
            generateBtn.disabled = true;
            verdictPanel.showProceedButton(() => {
              verdictPanel.hideProceedButton();
              generateBtn.disabled = false;
            });
          } else {
            generateBtn.disabled = false;
          }
        }).catch((err) => {
          if (err instanceof Error && err.message.includes('Aborted')) return;
          // Use console error only sparingly or replace with log.error. But we can't import log here easily if we haven't. Let's just catch it.
        });
      },
      (start, end) => {
        if (fullCheckController) {
          fullCheckController.abort();
        }
        generateBtn.disabled = true;
        
        orchestrator.scoreWindowFastDebounced(file, start, end, (verdict) => {
          verdictPanel.clear();
          verdictPanel.hideProceedButton();

          verdict.frameScores.forEach((score) => {
            verdictPanel.appendLine(score);
          });
          
          metricsStrip.update(
            SAMPLE_FPS,
            pool.getApproxHeapMB() + fullPool.getApproxHeapMB(),
            []
          );
          
          const promptLine = document.createElement('div');
          promptLine.textContent = '> FAST CHECK COMPLETE. Press CONFIRM TRIM to run full ML validation...';
          promptLine.style.color = 'var(--fg-muted)';
          promptLine.style.fontStyle = 'italic';
          document.querySelector('#verdict-log')?.appendChild(promptLine);
        });
      }
    );

    // Instructional text before the user types
    verdictPanel.clear();
    const promptLine = document.createElement('div');
    promptLine.textContent = '> WAITING FOR CONFIRMATION: Press CONFIRM TRIM to begin analysis...';
    promptLine.style.color = 'var(--fg-muted)';
    promptLine.style.fontStyle = 'italic';
    document.querySelector('#verdict-log')?.appendChild(promptLine);

    generateBtn.addEventListener('click', () => {
      generateBtn.textContent = 'GENERATED (MOCK)';
    });
    })();
  });
}
