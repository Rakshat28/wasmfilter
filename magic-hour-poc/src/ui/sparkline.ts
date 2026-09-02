export function renderSparkline(container: HTMLElement, values: number[]): void {
  const chars = '  ▂▃▄▅▆▇█';
  let result = '';

  for (const value of values) {
    let index = Math.floor(value * 8);
    if (index < 0) index = 0;
    if (index > 8) index = 8;
    result += chars[index];
  }

  container.textContent = result;
}
