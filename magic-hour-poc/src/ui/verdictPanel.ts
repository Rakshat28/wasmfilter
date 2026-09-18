import { FrameScore } from '../types';

export function createVerdictPanel(container: HTMLElement): {
  appendLine: (score: FrameScore) => void;
  clear: () => void;
  showProceedButton: (onProceed: () => void) => void;
  hideProceedButton: () => void;
} {
  container.innerHTML = `
    <div class="verdict-log" id="verdict-log"></div>
    <div class="verdict-button-container" id="verdict-btn-container" style="margin-top: 16px; display: none;">
      <button class="btn btn-danger" id="proceed-btn">PROCEED ANYWAY</button>
    </div>
  `;

  const logContainer = container.querySelector('#verdict-log') as HTMLElement;
  const btnContainer = container.querySelector('#verdict-btn-container') as HTMLElement;
  const proceedBtn = container.querySelector('#proceed-btn') as HTMLButtonElement;

  return {
    appendLine: (score: FrameScore): void => {
      const line = document.createElement('div');

      line.textContent = `[t=${score.t}s] faceCount=${score.faceCount} confidence=${score.faceConfidence.toFixed(2)} sharpness=${score.sharpness.toFixed(1)} motion=${score.motionDelta.toFixed(1)}`;

      logContainer.appendChild(line);
      logContainer.scrollTop = logContainer.scrollHeight;
    },

    clear: (): void => {
      logContainer.innerHTML = '';
    },

    showProceedButton: (onProceed: () => void): void => {
      btnContainer.style.display = 'block';
      proceedBtn.onclick = onProceed;
    },

    hideProceedButton: (): void => {
      btnContainer.style.display = 'none';
      proceedBtn.onclick = null;
    },
  };
}
