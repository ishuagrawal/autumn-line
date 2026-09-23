import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only: lets the page POST a PNG of the canvas so renders can be compared
// against the reference photograph outside the browser.
function capture(): Plugin {
  const dir = process.env.CAPTURE_DIR || path.resolve(__dirname, '.captures');
  return {
    name: 'capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const name = (new URL(req.url ?? '', 'http://x').searchParams.get('name') || 'capture').replace(/[^\w.-]/g, '_');
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `${name}.png`);
          fs.writeFileSync(file, Buffer.concat(chunks));
          res.end(file);
        });
      });
    },
  };
}

// ARTIFACT=1 builds a variant that leaves three.js external (loaded from a CDN
// through an import map) so the shipped bundle is only this project's code.
const artifact = process.env.ARTIFACT === '1';

export default defineConfig({
  base: './',
  plugins: [capture()],
  build: artifact
    ? { outDir: 'dist-artifact', rollupOptions: { external: ['three'] }, minify: false, modulePreload: { polyfill: false } }
    : {},
});
