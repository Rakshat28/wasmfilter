---
trigger: always_on
---

Where a rule and a task conflict, the rule wins — adjust the implementation, don't relax the rule.

0. Threat Model (why the security rules below exist)

No backend exists for this POC — the attack surface is: (1) a malicious or malformed video file causing a crash, hang, or resource exhaustion in the browser tab; (2) XSS via data (filenames, scores) rendered into the DOM; (3) supply-chain risk from npm dependencies (mp4box, AssemblyScript toolchain) and any CDN asset. Every rule in §4 maps to one of these three. Treat "it's just a local demo" as irrelevant — a demo that crashes or executes attacker-controlled content on a bad input isn't production-grade regardless of deployment context.

1. Code Style
Prettier: singleQuote: true, semi: true, tabWidth: 2, trailingComma: "all", printWidth: 100, arrowParens: "always". Scripts: format / format:check. Zero diffs required.
ESLint: eslint:recommended + @typescript-eslint/recommended + recommended-requires-type-checking. Force to "error": no-explicit-any, no-unused-vars, explicit-function-return-type, eqeqeq, no-var, prefer-const, no-console. Script: lint, must exit 0.
Naming: camelCase vars/functions/files (workerPool.ts). PascalCase classes/interfaces/types. SCREAMING_SNAKE_CASE for tunable constants — no magic numbers outside thresholds.ts / assembly/index.ts's constant block. Booleans prefixed is/has/should. No unclear abbreviations.
Named exports only — never export default.
No comments (existing project convention). Anything that would justify one goes in docs/*.md instead.
One way to do a thing, everywhere it's needed — duplicated logic is a defect, extract it.
2. Type Safety
strict: true in every tsconfig.json, no exceptions, no // @ts-ignore. A type error that seems to need any or a suppression means a boundary (WASM/JS, worker/main-thread, file input) isn't typed properly — fix the boundary, don't suppress.
No any; no unnarrowed unknown. Every cross-boundary value gets a concrete interface (types.ts) and a type guard, never a cast.
Discriminated unions for anything with a type field; every switch over one ends in default: assertNever(x) using a shared assertNever(x: never): never in types.ts.
FrameFlag stays a closed string-literal union everywhere it's consumed — never widened to string.
Use branded types for values that could otherwise be mixed up silently: type Seconds = number & { readonly __brand: 'Seconds' } for all timestamps/durations, so a raw millisecond value can never be passed where seconds are expected without an explicit, visible conversion.
Mark every field that isn't reassigned after construction readonly — FrameScore, IngestVerdict, and all types.ts interfaces are fully readonly. Arrays inside them are ReadonlyArray<T>.
3. Logical Correctness
Every function has explicit preconditions and throws on violation rather than returning a plausible wrong answer. E.g. worker.ts must assert pixels.byteLength === 57600 before writing into WASM memory and throw if not.
Boundary conditions get explicit handling: first frame of a window (no prior frame for motionDelta), zero-face masks, all-flagged windows, single-frame windows. Walk through empty/maximal/single-element inputs before calling a function done.
Concurrency: match every worker response to its taskId, never assume response order equals request order. The debounce generation counter is checked after an async scoreWindow resolves, immediately before calling onResult — a stale result must never overwrite a newer one, even if it resolves later due to timing. MAX_IN_FLIGHT_FRAMES is a hard cap enforced atomically at submission.
No silent fallback behavior anywhere except the one documented fail-open case (decode/demux error, task P2-12). Every other error path recovers verifiably or propagates loudly.
Pure functions wherever there's no reason for state (computeFlags, toGray, computeSharpness). The one deliberate exception (motionDelta's dependency on the stored previous frame) is documented in docs/MEMORY_LAYOUT.md, not silently different.
Determinism: given the same input buffer, every scoring function must return bit-identical output every time — no reliance on timing, iteration order, or uninitialized memory. If a test run ever produces different scores for the same file and window, treat that as a correctness bug to fix immediately, not noise to ignore.
4. Security

4.1 Untrusted file handling. Validate file type via magic bytes (check for the ftyp box signature) before handing a file to mp4box — never trust accept="video/mp4" or the extension, both are spoofable. Reject files above a defined sane size ceiling and videos above a defined sane resolution/duration ceiling before parsing — document both ceilings in docs/THRESHOLDS.md. mp4box's box-parsing loop must have an explicit iteration/byte-progress bound so a malformed or adversarially crafted box structure (e.g. a box claiming a size that never advances the read cursor) cannot hang the tab in an infinite loop.

4.2 Timeouts and cancellation. Every decode/score operation (scoreWindow and everything it calls) takes an AbortSignal and respects it. If the user selects a new file or changes the trim window while a previous scoreWindow call is still in flight, that call must be aborted, not left to run to completion and race the new one. Wrap the whole decode pipeline in an explicit wall-clock timeout (document the exact value in docs/THRESHOLDS.md) so a pathological file that doesn't crash but decodes pathologically slowly still fails safely into the fail-open path rather than hanging the UI indefinitely.

4.3 WASM memory safety. Every pointer/length pair passed into a WASM export is validated in TS first — exact expected byte length, and scratch offsets (RGBA_SCRATCH_OFFSET/OUT_SCRATCH_OFFSET) verified not to overlap each other or AssemblyScript's static data, checked against the actual compiled module, not assumed. --runtime stub gives no bounds checking beyond the page-level WASM sandbox — an out-of-bounds write is silent corruption, so this TS-side validation is a security control, not a nicety. Never grow WASM memory in response to attacker-influenced input (e.g. frame dimensions) without an explicit, pre-validated upper bound.

4.4 No dynamic code execution or injection. No eval, no new Function, no innerHTML with any non-hardcoded value, no template-literal HTML assembly. All data-derived DOM content (filenames, scores, flags) uses textContent or createElement + textContent — this applies even to values that look numeric/safe, since the rule is about the pattern being uniform and auditable, not about judging each value's actual risk case by case.

4.5 Supply chain. Commit package-lock.json; use npm ci (not npm install) for any reproducible/CI-style install so the lockfile is authoritative. Check npm ls <pkg> after any install to see what it pulled in transitively. Run npm audit before Phase 5 is done; fix any high/critical with an available patch — don't ship with one noted-and-ignored. No dependency beyond what's listed in the task breakdown without a documented reason in README.md. Pin the Node version via an "engines" field in package.json.

4.6 No secrets/credentials in source, ever. If a real API integration is added later, credentials go in an untracked .env, added to .gitignore in the same change — never hardcoded, never logged (§6), never committed even temporarily.

4.7 Static assets. Self-host fonts and any other static asset — no third-party CDN dependency for the demo, since each one is both an availability risk and an unnecessary trust extension for something that can just be a local file.

4.8 Least privilege. Workers get no access beyond what worker.ts needs — don't widen their scope by passing unnecessary references into worker messages. Don't request any browser permission (camera, microphone, storage, notifications) this feature doesn't use.

5. Error Handling
One pattern: try/catch at the failure boundary, throw new Error('<stage>: <what went wrong>'). Never a bare string throw, never an empty catch {}.
Every catch either recovers to the one documented fail-open state, or re-throws/logs. No silent swallowing.
Every Promise is awaited inside error-handled code or has its own .catch — no floating unhandled promises, including per-request WorkerPool promises and any AbortSignal-triggered rejection from §4.2.
6. Logging
Single module src/log.ts: log.info/warn/error(scope, message, data?), prefixed by scope. no-console enforced everywhere except src/log.ts and scripts/ (test harnesses).
Every fail-open path calls log.error with enough context (stage, file, window) to debug later — fail-open means the user isn't blocked, not that the failure is unrecorded.
Never log full file contents, raw pixel buffers, or anything that could be large or sensitive — log metadata (file name, size, dimensions, timestamps) only.
7. Resource Management
Every VideoFrame is .close()'d exactly once on every path, via try { } finally { frame.close(); } — not a bare call after the happy path that an early return could skip.
WorkerPool is constructed once at app startup, lives for the app's lifetime. beforeunload terminates all workers.
No unbounded growth: verdict log clears on every new scoreWindow run; pool queue capped by MAX_IN_FLIGHT_FRAMES. Any future buffer needs an explicit bound documented in docs/THRESHOLDS.md.
Superseded work (§4.2) is actively cancelled, not just ignored on completion — an aborted decode should stop consuming CPU/GPU resources promptly, not run to completion in the background.
8. Testing
Convert the WASM test harness from print-and-eyeball to explicit assertions (if (result !== expected) throw) — printing without asserting isn't a test.
All four Phase 4 scenarios (clean/blurry/no-face/multi-face) must pass with recorded actual output before Phase 3/4 is complete.
Add at least one adversarial-input test per §4.1/§4.2: a truncated/corrupted MP4, and a file renamed to .mp4 that isn't a video at all — confirm both fail closed into the documented fail-open UX state, not into a crash or hang.
Any bug found in manual testing gets a note in docs/ describing what broke and what changed — not a silent fix with no trace.
9. Documentation
README.md is the single entry point: setup, run instructions, link to the blueprint doc, fail-open behavior, non-zero-copy downscale caveat, and the file-size/resolution/duration ceilings from §4.1 — kept current, never stale against actual scripts.
Every non-obvious decision lives in exactly one docs/*.md file, never duplicated, never a comment. Add a new file rather than forcing an unrelated decision into an existing one.
10. Definition of Done (every task, in addition to its own acceptance criteria)
format:check clean. 2. lint exits 0. 3. tsc --noEmit and build:wasm both succeed. 4. No new any/@ts-ignore/eslint-disable without a docs/ entry justifying it. 5. No console.* outside log.ts/scripts/. 6. Resource cleanup and cancellation manually verified for any task touching VideoFrame/Worker/WASM memory/AbortSignal. 7. Task's own acceptance criteria checked and recorded, not assumed.