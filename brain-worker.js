// Luna's brain runs here, off the main thread, so the site never freezes while the model thinks.
// Keep this version in step with brain.js.
import { WebWorkerMLCEngineHandler } from 'https://esm.run/@mlc-ai/web-llm@0.2.89';
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = msg => handler.onmessage(msg);
