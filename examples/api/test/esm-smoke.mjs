// Boots the built app (`pnpm build` first) as a plain Node ESM process and walks the profiler UI.
//
// The Jest e2e suite runs as CommonJS, so it reaches the packages' CommonJS build. This is the one
// run that reaches their ESM build (`dist/esm`), the one an ESM application imports: the templates
// and client assets it resolves, and its interop with CommonJS dependencies.
import { spawn } from 'node:child_process';

const port = process.env.PORT ?? '3099';
const base = `http://localhost:${port}`;

const app = spawn(process.execPath, ['dist/main.js'], {
  env: { ...process.env, PORT: port },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
app.stdout.on('data', (chunk) => (output += chunk));
app.stderr.on('data', (chunk) => (output += chunk));

const failures = [];

async function get(path) {
  const res = await fetch(`${base}${path}`);
  if (res.status !== 200) failures.push(`GET ${path} answered ${res.status}`);
  return res;
}

async function waitForApp() {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (app.exitCode !== null) throw new Error(`the app exited with code ${app.exitCode}`);
    try {
      await fetch(`${base}/health`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error('the app did not answer within 60 s');
}

try {
  await waitForApp();
  const token = (await get('/api/v1/products')).headers.get('x-debug-token');
  if (!token) failures.push('GET /api/v1/products returned no X-Debug-Token');
  const pages = [await (await get('/_profiler')).text()];
  if (token) pages.push(await (await get(`/_profiler/${token}`)).text());
  const assets = new Set(
    pages.flatMap((html) => html.match(/\/_profiler\/__assets\/(?:scripts|styles)\/[^"?]+/g) ?? []),
  );
  if (assets.size === 0) failures.push('the profiler pages reference no asset');
  for (const asset of assets) await get(asset);
} catch (error) {
  failures.push(error.message);
} finally {
  app.kill();
}

if (failures.length > 0) {
  console.error(`The app failed as native ESM:\n\n  - ${failures.join('\n  - ')}\n`);
  console.error(output.split('\n').slice(-40).join('\n'));
  process.exit(1);
}
console.log('The app serves the profiler UI as native ESM.');
