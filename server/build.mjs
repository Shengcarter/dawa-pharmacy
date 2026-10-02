// Bundles the API (and the shared package) into dist/; npm dependencies stay external.
import { build } from 'esbuild';
import { cp, readFile, rm } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => d !== '@dawa/shared');

await rm('dist', { recursive: true, force: true });
await build({
  entryPoints: {
    server: 'src/server.ts',
    migrate: 'src/db/migrate-cli.ts',
    'create-admin': 'src/db/create-admin.ts',
    alerts: 'src/jobs/run-alerts.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  external,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
await cp('src/db/migrations', 'dist/migrations', { recursive: true });
