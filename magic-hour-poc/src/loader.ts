export interface ScorerExports {
  scoreFrame(rgbaPtr: number, outPtr: number): void;
  resetState?: () => void;
  memory: WebAssembly.Memory;
}

export async function loadScorer(): Promise<ScorerExports> {
  const response = await fetch('/scorer.wasm');
  if (!response.ok) {
    throw new Error(
      `loadScorer: Failed to fetch WASM binary: ${response.status} ${response.statusText}`,
    );
  }

  const imports = {
    env: {
      abort(message: number, fileName: number, line: number, column: number): void {
        throw new Error(`WASM Abort at ${fileName}:${line}:${column}`);
      },
    },
  };

  const { instance } = await WebAssembly.instantiateStreaming(response, imports);
  return instance.exports as unknown as ScorerExports;
}
