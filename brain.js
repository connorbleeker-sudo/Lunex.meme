/* ==========================================================================
   LUNA'S BRAIN: an open-source language model that runs on the visitor's own
   computer, inside the browser. Free, private, never queued.

   It steps down by itself instead of failing:
     max -> smart -> fast -> lite   (graphics card, WebGPU via WebLLM)
     -> cpu                          (processor only, WebAssembly via wllama;
                                      works in any browser, cannot crash the GPU)
   - no usable GPU            -> straight to cpu, no settings needed
   - load or answer errors    -> one step lighter, remembered for this browser
   - PC/tab crashed mid-load  -> a "pending" marker survives the crash, so the
                                 next visit starts one step lighter

   window.LunaBrain = { status, tier, backend, setTier(t), load(), chat(messages, onToken), retry() }
   ========================================================================== */
const WEBLLM = 'https://esm.run/@mlc-ai/web-llm@0.2.89';
const WLLAMA = 'https://cdn.jsdelivr.net/npm/@wllama/wllama@4.0.0/esm';

const TIERS = {
  max:   { label: 'Max',   size: '5.5 GB', gpu: ['Qwen3.5-9B', 'Qwen3-8B'] },
  smart: { label: 'Smart', size: '2.6 GB', gpu: ['Qwen3.5-4B', 'Qwen3-4B'] },
  fast:  { label: 'Fast',  size: '1.3 GB', gpu: ['Qwen3.5-2B', 'Qwen3-1.7B'] },
  lite:  { label: 'Lite',  size: '0.6 GB', gpu: ['Qwen3.5-0.8B', 'Qwen3-0.6B'] },
  cpu:   { label: 'CPU',   size: '0.4 GB', cpu: { repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF', file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf' } },
};
const LIGHTER = { max: 'smart', smart: 'fast', fast: 'lite', lite: 'cpu', cpu: null };
const DEFAULT_TIER = 'fast';

const LS = { tier: 'luna-brain-tier', pending: 'luna-brain-pending' };
const listeners = new Set();
const B = {
  status: 'idle',            // idle | loading | ready | error
  progress: 0, text: '', error: '', notice: '',
  tier: TIERS[localStorage.getItem(LS.tier)] ? localStorage.getItem(LS.tier) : DEFAULT_TIER,
  backend: null,             // 'gpu' | 'cpu'
  engine: null, worker: null, modelId: null, f16: true, loadingPromise: null,
  tiers: TIERS,
  on(fn) { listeners.add(fn); fn(B); return () => listeners.delete(fn); },
};
const emit = () => listeners.forEach(fn => { try { fn(B); } catch { } });
const saveTier = t => { B.tier = t; localStorage.setItem(LS.tier, t); };

// ---------------------------------------------------------------- crash memory
// Set right before the risky GPU phase (uploading/compiling the model, or answering) and cleared once it
// succeeds. If it's still there on the next visit, that phase took the tab or the PC down.
const markRisky = () => localStorage.setItem(LS.pending, B.tier);
const clearRisky = () => localStorage.removeItem(LS.pending);
{
  const crashed = localStorage.getItem(LS.pending);
  if (crashed && TIERS[crashed]) {
    const next = LIGHTER[crashed] || 'cpu';
    saveTier(next); clearRisky();
    B.notice = `Last time the ${TIERS[crashed].label} brain didn't finish loading, so Luna switched to the lighter ${TIERS[next].label} brain.`;
  }
}

// ---------------------------------------------------------------- GPU detection
async function gpuInfo() {
  if (!navigator.gpu) return null;
  for (const opts of [{ powerPreference: 'high-performance' }, {}]) {
    try { const a = await navigator.gpu.requestAdapter(opts); if (a && !a.isFallbackAdapter) return { f16: a.features.has('shader-f16') }; } catch { }
  }
  return null;
}

// ---------------------------------------------------------------- loaders
async function loadGpu() {
  const { CreateWebWorkerMLCEngine, prebuiltAppConfig } = await import(WEBLLM);
  const ids = new Set(prebuiltAppConfig.model_list.map(m => m.model_id)), quant = B.f16 ? 'q4f16_1' : 'q4f32_1';
  B.modelId = TIERS[B.tier].gpu.map(base => `${base}-${quant}-MLC`).find(id => ids.has(id));
  if (!B.modelId) throw new Error('no build of this size');
  const worker = B.worker = new Worker(new URL('./brain-worker.js', import.meta.url), { type: 'module' });
  const engine = await CreateWebWorkerMLCEngine(worker, B.modelId, {
    initProgressCallback: p => {
      B.progress = p.progress || 0; B.text = p.text || '';
      if (B.progress >= .95 || /loading model from cache|shader|compil/i.test(B.text)) markRisky();   // the GPU-heavy part
      emit();
    },
  }, { prefill_chunk_size: 256, context_window_size: 4096 });   // small chunks keep each GPU step short and light
  B.text = 'Warming up'; B.progress = .99; emit(); markRisky();
  await engine.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 4, extra_body: { enable_thinking: false } });
  clearRisky();
  B.engine = engine; B.backend = 'gpu';
}
async function loadCpu() {
  const { Wllama, LoggerWithoutDebug } = await import(`${WLLAMA}/index.js`);
  const wasm = (await import(`${WLLAMA}/wasm-from-cdn.js`)).default;
  const w = new Wllama(wasm, { logger: LoggerWithoutDebug });
  // strong processors (8+ cores, multi-threaded) get a smarter 1.5B model; everything else the tiny 0.5B
  const strong = self.crossOriginIsolated && (navigator.hardwareConcurrency || 2) >= 8;
  const src = strong ? { repo: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF', file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf' } : TIERS.cpu.cpu;
  B.modelId = src.file.replace(/\.gguf$/, '');
  await w.loadModelFromHF({ repo: src.repo, file: src.file }, {
    n_ctx: 2048, n_gpu_layers: 0,                                   // processor only, never touches the graphics card
    progressCallback: ({ loaded, total }) => { B.progress = total ? loaded / total : 0; B.text = 'Downloading'; emit(); },
  });
  B.engine = w; B.backend = 'cpu';
}

B.load = () => {
  if (B.engine) return Promise.resolve(B.engine);
  if (B.loadingPromise) return B.loadingPromise;
  B.loadingPromise = (async () => {
    B.status = 'loading'; B.progress = 0; B.text = 'Starting'; B.error = ''; emit();
    for (;;) {
      try {
        if (B.tier !== 'cpu') {
          const g = await gpuInfo();
          if (!g) { saveTier('cpu'); continue; }                    // no usable GPU: go straight to the processor brain
          B.f16 = g.f16; await loadGpu();
        } else await loadCpu();
        B.status = 'ready'; B.progress = 1; emit();
        return B.engine;
      } catch (e) {
        console.warn('[luna brain]', B.tier, e);
        clearRisky(); await freeEngine();
        const next = LIGHTER[B.tier];
        if (!next) throw e;                                        // even the CPU brain failed
        B.notice = `The ${TIERS[B.tier].label} brain couldn't run here, so Luna switched to the lighter ${TIERS[next].label} brain.`;
        saveTier(next); B.progress = 0; emit();
      }
    }
  })().catch(e => {
    B.loadingPromise = null; B.status = 'error'; B.error = (e && e.message) || String(e); emit();
    throw e;
  });
  return B.loadingPromise;
};
async function freeEngine() {
  const e = B.engine, w = B.worker;
  B.engine = null; B.worker = null; B.backend = null;
  try { if (e && e.unload) await e.unload(); } catch { }
  try { if (e && e.exit) await e.exit(); } catch { }
  try { if (w) w.terminate(); } catch { }
}

B.setTier = async t => {
  if (!TIERS[t] || t === B.tier || B.status === 'loading') return;
  saveTier(t); B.notice = '';
  await freeEngine();                                              // never two models in memory at once
  B.loadingPromise = null; B.status = 'idle'; emit();
  B.load().catch(() => { });
};
B.retry = () => { B.status = 'idle'; B.loadingPromise = null; B.error = ''; emit(); return B.load(); };

// ---------------------------------------------------------------- chat
// Streams the reply: onToken(fullTextSoFar) fires as words arrive. Returns the final text.
// Removes hidden reasoning, and cuts the reply off if the model starts copying its own instructions
// or data sections (small models sometimes do), so that never reaches the visitor.
const ECHO = /(\*\*)?\b(LIVE CONTEXT|TOOL RESULTS|YOUR WALLET:|Style: friendly|You have NO internet|Luna's current shortlist|Hottest Solana pairs|Freshest pump\.fun launches|These are the user's real holdings)/;
const strip = s => {
  s = s.replace(/<think>[\s\S]*?(<\/think>|$)/g, '');
  const m = s.match(ECHO); if (m) s = s.slice(0, m.index);
  return s.trim();
};
const echoed = s => ECHO.test(s.replace(/<think>[\s\S]*?(<\/think>|$)/g, ''));
async function chatGpu(messages, onToken) {
  // low temperature + repetition penalties: small models ramble and loop when they're allowed to be "creative"
  const stream = await B.engine.chat.completions.create({ messages, stream: true, temperature: .3, top_p: .85, frequency_penalty: .4, presence_penalty: .2, max_tokens: 600, extra_body: { enable_thinking: false } });
  let out = '';
  for await (const ch of stream) {
    out += ch.choices?.[0]?.delta?.content || ''; onToken && onToken(strip(out));
    if (B._stop || echoed(out)) { try { B.engine.interruptGenerate(); } catch { } break; }
  }
  return strip(out);
}
async function chatCpu(messages, onToken) {
  // a small CPU model reads slowly, so give it a short brief instead of the full live-data prompt
  // (reading the prompt is the slow part on a CPU: ~50 tokens/s, so every sentence here costs time)
  const sys = messages.find(m => m.role === 'system')?.content || '';
  const tools = (sys.match(/TOOL RESULTS:\n([\s\S]*?)\n\n(?:Style|$)/) || [])[1] || '';
  const brief = [{ role: 'system', content: 'You are Luna, the friendly AI helper on Lunex, a pump.fun memecoin site. Answer the question directly in plain, literal sentences. No slogans or riddles. Keep it short. If you don\'t know something about the user\'s wallet or trades, say so. Never ask for private keys.' +
    (tools && !/^\(none/.test(tools) ? '\nFacts just looked up: ' + tools.slice(0, 500) : '') +
    ((sys.match(/YOUR WALLET:\n([^\n]+)/) || [])[1] ? '\n' + sys.match(/YOUR WALLET:\n([^\n]+)/)[1].slice(0, 600) : '') }];
  // keep only the last exchange, clipped: a CPU reads every past token again on each question
  const recent = messages.filter(m => m.role !== 'system').slice(-3).map((m, i, a) => i === a.length - 1 ? m : { role: m.role, content: m.content.slice(0, 300) });
  const msgs = [...brief, ...recent];
  const res = await B.engine.createChatCompletion({ messages: msgs, max_tokens: 400, temperature: .3, top_p: .85, repeat_penalty: 1.15, stream: true });
  if (res && res[Symbol.asyncIterator]) {
    let out = '';
    for await (const ch of res) {
      out += ch.choices?.[0]?.delta?.content ?? ch.choices?.[0]?.text ?? ''; onToken && onToken(strip(out));
      if (B._stop || echoed(out)) { try { B.engine.cancelRequest?.(); } catch { } break; }
    }
    return strip(out);
  }
  const out = strip(res?.choices?.[0]?.message?.content || ''); onToken && onToken(out); return out;
}
// Stop button: ends the current answer right where it is.
B.stop = () => { B._stop = true; };
B.chat = async (messages, onToken, retried = 0) => {
  B._stop = false;
  await B.load();
  try {
    if (B.backend === 'gpu') { markRisky(); const out = await chatGpu(messages, onToken); clearRisky(); return out; }
    return await chatCpu(messages, onToken);
  } catch (e) {
    clearRisky();
    console.warn('[luna brain] chat failed on', B.tier, e);
    const next = LIGHTER[B.tier];
    if (retried > 2 || !next) throw e;
    B.notice = `The ${TIERS[B.tier].label} brain stumbled, so Luna switched to the lighter ${TIERS[next].label} brain.`;
    await freeEngine(); saveTier(next); B.loadingPromise = null; B.status = 'idle'; emit();
    return B.chat(messages, onToken, retried + 1);
  }
};

window.LunaBrain = B;
window.dispatchEvent(new Event('lunabrain'));
