async function testWasm() {
  try {
    const res = await fetch('http://localhost:5173/scorer.wasm');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const imports = { env: { abort: () => {} } };
    const { instance } = await WebAssembly.instantiateStreaming(res, imports);
    if (typeof instance.exports.scoreFrame === 'function') {
      console.log('SUCCESS: scoreFrame is callable!');
      process.exit(0);
    } else {
      console.log('FAILED: scoreFrame is not a function');
      process.exit(1);
    }
  } catch (err) {
    console.error('FAILED:', err.message);
    process.exit(1);
  }
}
testWasm();
