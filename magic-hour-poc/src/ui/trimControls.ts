export function createTrimControls(
  container: HTMLElement,
  videoDuration: number,
  onChange: (start: number, end: number) => void,
  onInput: () => void
): void {
  container.innerHTML = `
    <div class="trim-inputs" style="flex-direction: column; width: 100%;">
      <div class="trim-input-group" style="width: 100%;">
        <label>Video Start</label>
        <div style="display: flex; gap: 12px; align-items: center;">
          <input type="range" step="0.1" min="0" max="${videoDuration}" value="0" id="trim-start-range" style="flex: 1; cursor: pointer;" />
          <input type="number" step="0.1" min="0" max="${videoDuration}" value="0" id="trim-start" style="width: 100px;" />
        </div>
      </div>
      <div class="trim-input-group" style="width: 100%;">
        <label>Video End</label>
        <div style="display: flex; gap: 12px; align-items: center;">
          <input type="range" step="0.1" min="0" max="${videoDuration}" value="${videoDuration}" id="trim-end-range" style="flex: 1; cursor: pointer;" />
          <input type="number" step="0.1" min="0" max="${videoDuration}" value="${videoDuration}" id="trim-end" style="width: 100px;" />
        </div>
      </div>
      <button id="confirm-trim-btn" class="btn btn-primary" style="margin-top: 8px;">CONFIRM TRIM</button>
    </div>
  `;

  const startInput = container.querySelector('#trim-start') as HTMLInputElement;
  const endInput = container.querySelector('#trim-end') as HTMLInputElement;
  const startRange = container.querySelector('#trim-start-range') as HTMLInputElement;
  const endRange = container.querySelector('#trim-end-range') as HTMLInputElement;
  const confirmBtn = container.querySelector('#confirm-trim-btn') as HTMLButtonElement;

  let isInitialized = false;

  const errorDiv = document.createElement('div');
  errorDiv.style.color = 'var(--danger)';
  errorDiv.style.fontSize = '12px';
  errorDiv.style.marginTop = '8px';
  errorDiv.style.display = 'none';
  // Insert before the confirm button
  const confirmBtnEl = container.querySelector('#confirm-trim-btn');
  if (confirmBtnEl && confirmBtnEl.parentNode) {
    confirmBtnEl.parentNode.insertBefore(errorDiv, confirmBtnEl);
  }

  function validateInputs(): void {
    const startVal = parseFloat(startInput.value);
    const endVal = parseFloat(endInput.value);

    let isValid = true;
    let errorMessage = '';

    if (isNaN(startVal) || isNaN(endVal)) isValid = false;
    if (startVal < 0) isValid = false;
    if (endVal > videoDuration) isValid = false;
    if (endVal <= startVal) isValid = false;
    
    if (isValid && endVal - startVal < 0.5) {
      isValid = false;
      errorMessage = 'Trim window must be at least 0.5 seconds.';
    }

    confirmBtn.disabled = !isValid;

    if (isValid) {
      startInput.style.borderColor = 'rgba(255, 255, 255, 0.2)';
      endInput.style.borderColor = 'rgba(255, 255, 255, 0.2)';
      errorDiv.style.display = 'none';
    } else {
      startInput.style.borderColor = 'var(--danger)';
      endInput.style.borderColor = 'var(--danger)';
      if (errorMessage) {
        errorDiv.textContent = errorMessage;
        errorDiv.style.display = 'block';
      } else {
        errorDiv.style.display = 'none';
      }
    }

    if (isInitialized) {
      onInput();
    }
  }

  confirmBtn.addEventListener('click', () => {
    const startVal = parseFloat(startInput.value);
    const endVal = parseFloat(endInput.value);
    if (!confirmBtn.disabled && !isNaN(startVal) && !isNaN(endVal)) {
      onChange(startVal, endVal);
    }
  });

  // Sync range to number
  startRange.addEventListener('input', () => {
    let sVal = parseFloat(startRange.value);
    const eVal = parseFloat(endRange.value);
    if (eVal - sVal < 0.5) {
      sVal = Math.max(0, eVal - 0.5);
      startRange.value = sVal.toFixed(1);
    }
    startInput.value = startRange.value;
    validateInputs();
  });
  endRange.addEventListener('input', () => {
    let eVal = parseFloat(endRange.value);
    const sVal = parseFloat(startRange.value);
    if (eVal - sVal < 0.5) {
      eVal = Math.min(videoDuration, sVal + 0.5);
      endRange.value = eVal.toFixed(1);
    }
    endInput.value = endRange.value;
    validateInputs();
  });

  // Sync number to range
  startInput.addEventListener('input', () => {
    let sVal = parseFloat(startInput.value);
    const eVal = parseFloat(endInput.value);
    if (!isNaN(sVal) && !isNaN(eVal) && eVal - sVal < 0.5) {
      sVal = Math.max(0, eVal - 0.5);
      startInput.value = sVal.toFixed(1);
    }
    startRange.value = startInput.value;
    validateInputs();
  });
  endInput.addEventListener('input', () => {
    let eVal = parseFloat(endInput.value);
    const sVal = parseFloat(startInput.value);
    if (!isNaN(sVal) && !isNaN(eVal) && eVal - sVal < 0.5) {
      eVal = Math.min(videoDuration, sVal + 0.5);
      endInput.value = eVal.toFixed(1);
    }
    endRange.value = endInput.value;
    validateInputs();
  });

  // Run initial validation to unlock button on load
  validateInputs();
  isInitialized = true;
}
