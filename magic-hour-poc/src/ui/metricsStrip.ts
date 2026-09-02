import { renderSparkline } from './sparkline';

export function createMetricsStrip(container: HTMLElement): {
  update: (fps: number, heapMB: number, faceConfidenceSeries: number[]) => void;
} {
  container.innerHTML = `
    <div class="metric-block">
      <div class="metric-label">FRAMES/SEC ANALYZED</div>
      <div class="metric-value" id="fps-val">0.0</div>
    </div>
    <div class="metric-block">
      <div class="metric-label">WASM HEAP (MB)</div>
      <div class="metric-value" id="heap-val">0.0</div>
    </div>
    <div class="metric-block">
      <div class="metric-label">CONFIDENCE SPARKLINE</div>
      <div class="metric-value sparkline" id="spark-val"></div>
    </div>
  `;

  const fpsValue = container.querySelector('#fps-val') as HTMLElement;
  const heapValue = container.querySelector('#heap-val') as HTMLElement;
  const sparklineValue = container.querySelector('#spark-val') as HTMLElement;

  return {
    update: (fps: number, heapMB: number, faceConfidenceSeries: number[]): void => {
      fpsValue.textContent = fps.toFixed(1);
      heapValue.textContent = heapMB.toFixed(1);
      renderSparkline(sparklineValue, faceConfidenceSeries);
    },
  };
}
