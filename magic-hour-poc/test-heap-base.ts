import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmBuffer = fs.readFileSync(path.join(__dirname, 'build/scorer.wasm'));
const wasmModule = await WebAssembly.instantiate(wasmBuffer, { env: { abort: () => {} } });
console.log('heap_base:', (wasmModule.instance.exports as any).__heap_base);
console.log('memory size:', (wasmModule.instance.exports.memory as WebAssembly.Memory).buffer.byteLength);
