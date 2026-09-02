import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const packageRoot = path.join(projectRoot, 'node_modules', 'streamsaver');
const publicRoot = path.join(projectRoot, 'public', 'streamsaver');

await mkdir(publicRoot, { recursive: true });

for (const filename of ['LICENSE', 'mitm.html', 'sw.js']) {
  await copyFile(
    path.join(packageRoot, filename),
    path.join(publicRoot, filename),
  );
}

console.log('StreamSaver browser assets synchronized.');
