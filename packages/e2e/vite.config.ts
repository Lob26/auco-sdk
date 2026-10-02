import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Host pages on :5173; the fake frame is served on :5174 by its own package,
// so host and frame are different origins, as with a real Auco frame.
const HOST_PORT = 5173;

// The pages exercise what ships: the BUILT dist of embed and compat, never
// their sources. A missing dist fails here, at startup, instead of silently
// resolving to something else.
const built = (entry: string): string => {
  const path = fileURLToPath(new URL(entry, import.meta.url));
  if (!existsSync(path)) {
    throw new Error(
      `${path} is missing: build first (bash scripts/ci.sh build e2e)`
    );
  }
  return path;
};

export default defineConfig({
  root: 'pages',
  resolve: {
    alias: [
      {
        find: /^@lob26\/auco-embed$/,
        replacement: built('../embed/dist/index.mjs'),
      },
      {
        find: /^@lob26\/auco-compat$/,
        replacement: built('../compat/dist/index.mjs'),
      },
    ],
  },
  // Dependency discovery can full-reload a page mid-test when it finds a new
  // dep; the pages import only the aliased dist files above.
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { port: HOST_PORT, strictPort: true },
});
