import { WorkerPool } from '../workerPool';
import { MlWorkerPool } from '../mlWorkerPool';
import { IngestOrchestrator } from '../orchestrator';
import { createTrimControls } from './trimControls';
import { createMetricsStrip } from './metricsStrip';
import { createVerdictPanel } from './verdictPanel';
import { SAMPLE_FPS } from '../thresholds';
import { log } from '../log';
import { IngestVerdict } from '../types';

const IS_GATEKEEPER_ENABLED = true;

async function checkGatekeeperEnabled(): Promise<boolean> {
  // Mocking a network request to LaunchDarkly / internal feature flags
  await new Promise((r) => setTimeout(r, 100));
  return IS_GATEKEEPER_ENABLED;
}

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
  let latestVerdict: IngestVerdict | null = null;

  fileInput.addEventListener('change', (e: Event): void => {
    void (async (): Promise<void> => {
      const isGatekeeperEnabled = await checkGatekeeperEnabled();

      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      if (fileUrl) {
        URL.revokeObjectURL(fileUrl);
      }
      fileUrl = URL.createObjectURL(file);

      const tempVideo = document.createElement('video');
      tempVideo.src = fileUrl;

      await new Promise<void>((resolve, reject) => {
        tempVideo.onloadedmetadata = (): void => resolve();
        tempVideo.onerror = (): void => reject(new Error('Failed to load video metadata'));
      });

      const duration = tempVideo.duration;

      generateBtn.disabled = true;
      generateBtn.textContent = 'GENERATE FACE SWAP';

      mainContent.style.display = 'grid';

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
          promptLine.id = 'ml-status-line';
          promptLine.textContent = '> RUNNING FULL ML CHECK (MediaPipe)...';
          promptLine.style.color = 'var(--fg-muted)';
          promptLine.style.fontStyle = 'italic';
          document.querySelector('#verdict-log')?.appendChild(promptLine);

          if (fullCheckController) {
            fullCheckController.abort();
          }
          fullCheckController = new AbortController();

          void orchestrator
            .scoreWindowFull(file, start, end, fullCheckController.signal)
            .then((verdict) => {
              latestVerdict = verdict;
              verdictPanel.clear();

              verdict.frameScores.forEach((score) => {
                verdictPanel.appendLine(score);
              });

              if (verdict.frameScores.length === 0) {
                const errLine = document.createElement('div');
                errLine.textContent = `> [WARN] Pipeline returned 0 scores. ${verdict.errorMsg ? 'Error: ' + verdict.errorMsg : 'No frames in window / fail-open activated.'}`;
                errLine.style.color = 'var(--danger)';
                errLine.style.fontWeight = 'bold';
                document.querySelector('#verdict-log')?.appendChild(errLine);
              }

              metricsStrip.update(
                SAMPLE_FPS,
                fullPool.getApproxHeapMB() + pool.getApproxHeapMB(),
                verdict.frameScores.map((s) => s.faceConfidence),
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
            })
            .catch((err) => {
              if (err instanceof Error && err.message.includes('Aborted')) return;
              log.error('App', 'Full ML check failed', err);
              verdictPanel.clear();
              const errLine = document.createElement('div');
              errLine.textContent = `> [ERROR] ML pipeline failed: ${err instanceof Error ? err.message : String(err)}`;
              errLine.style.color = 'var(--danger)';
              errLine.style.fontWeight = 'bold';
              document.querySelector('#verdict-log')?.appendChild(errLine);
              verdictPanel.showProceedButton(() => {
                verdictPanel.hideProceedButton();
                generateBtn.disabled = false;
              });
            });
        },
        (start, end) => {
          if (!isGatekeeperEnabled) return;
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

            if (verdict.frameScores.length === 0) {
              const errLine = document.createElement('div');
              errLine.textContent = `> [WARN] Fast check returned 0 scores. ${verdict.errorMsg ? 'Error: ' + verdict.errorMsg : 'No frames in window / fail-open activated.'}`;
              errLine.style.color = 'var(--danger)';
              errLine.style.fontWeight = 'bold';
              document.querySelector('#verdict-log')?.appendChild(errLine);
            }

            metricsStrip.update(
              SAMPLE_FPS,
              pool.getApproxHeapMB() + fullPool.getApproxHeapMB(),
              [],
            );

            const promptLine = document.createElement('div');
            promptLine.textContent =
              '> FAST CHECK COMPLETE. Press CONFIRM TRIM to run full ML validation...';
            promptLine.style.color = 'var(--fg-muted)';
            promptLine.style.fontStyle = 'italic';
            document.querySelector('#verdict-log')?.appendChild(promptLine);
          });
        },
      );

      verdictPanel.clear();

      if (!isGatekeeperEnabled) {
        generateBtn.disabled = false;
        const disabledLine = document.createElement('div');
        disabledLine.textContent = '> GATEKEEPER REMOTELY DISABLED. Proceeding without checks...';
        disabledLine.style.color = 'var(--warning)';
        document.querySelector('#verdict-log')?.appendChild(disabledLine);
      } else {
        const promptLine = document.createElement('div');
        promptLine.textContent =
          '> WAITING FOR CONFIRMATION: Press CONFIRM TRIM to begin analysis...';
        promptLine.style.color = 'var(--fg-muted)';
        promptLine.style.fontStyle = 'italic';
        document.querySelector('#verdict-log')?.appendChild(promptLine);
      }

      generateBtn.onclick = async (): Promise<void> => {
        generateBtn.disabled = true;
        generateBtn.textContent = 'UPLOADING...';

        // Phase 4: Mock Google Cloud Storage Resumable Upload
        log.info('App', 'Mocking POST to internal getResumableUploadUrl API...');
        await new Promise((r) => setTimeout(r, 600));

        // Construct privacy-safe telemetry payload
        const telemetryPayload =
          latestVerdict && isGatekeeperEnabled
            ? {
                badFrameRatio: latestVerdict.badFrameRatio,
                dominantFlags: latestVerdict.dominantFlags,
                totalFramesAnalyzed: latestVerdict.frameScores.length,
              }
            : null;

        log.info(
          'App',
          'Mocking PUT to storage.googleapis.com (magic-hour-prod-project-outputs)...',
          { telemetryPayload },
        );
        await new Promise((r) => setTimeout(r, 1200));

        generateBtn.textContent = 'GENERATED (MOCK)';
      };
    })();
  });
}
