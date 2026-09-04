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
      
      const tStr = score.t.toFixed(1);
      const confStr = score.faceConfidence.toFixed(2);
      const framingStr = score.framingScore.toFixed(2);
      const sharpStr = score.flags.includes('BLUR') ? 'BAD' : 'OK';
      const rejectStr = score.flags.length > 0 ? ' REJECT: ' + score.flags.join(',') : '';
      
      line.textContent = `[t=${tStr}s] face=${score.faceCount} conf=${confStr} frame=${framingStr} sharp=${sharpStr}${rejectStr}`;
      
      if (score.flags.length === 0) {
        line.style.color = 'var(--success)';
      } else {
        line.style.color = 'var(--danger)';
      }

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
    }
  };
}
