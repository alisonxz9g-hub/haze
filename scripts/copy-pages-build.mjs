import { cp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const buildRoot = path.join(projectRoot, 'pages-dist');
const allowedOutputs = new Set([
  'assets',
  'favicon.svg',
  'index.html',
  'og.png',
]);
const entries = await readdir(buildRoot, { withFileTypes: true });

for (const entry of entries) {
  if (!allowedOutputs.has(entry.name)) {
    throw new Error(`Saída inesperada do build do Pages: ${entry.name}`);
  }

  const source = path.join(buildRoot, entry.name);
  const destination = path.join(projectRoot, entry.name);

  if (path.dirname(destination) !== projectRoot) {
    throw new Error(`Destino inseguro recusado: ${destination}`);
  }

  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: entry.isDirectory() });
}

console.log('GitHub Pages build copied to the repository root.');
