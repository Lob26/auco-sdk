import { defineConfig } from 'vite';
import { FAKE_FRAME_PORT } from './src/contract.ts';

// The e2e needs host and frame on different origins; ports are the contract.
// Host pages: http://localhost:5173 (packages/e2e). Fake frame: this server.
export { FAKE_FRAME_PORT };

export default defineConfig({
  server: { port: FAKE_FRAME_PORT, strictPort: true },
  preview: { port: FAKE_FRAME_PORT, strictPort: true },
});
