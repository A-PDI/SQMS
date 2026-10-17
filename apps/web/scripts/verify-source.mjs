import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(await readFile(path.join(root, 'apps/web/qms-source-manifest.json'), 'utf8'));
const changed = [];
let verified = 0;
for (const file of manifest.files) {
  if (file.boundary) continue;
  const digest = createHash('sha256').update(await readFile(path.join(root, file.target))).digest('hex');
  if (digest !== file.sha256) changed.push(file.target);
  verified++;
}
if (changed.length) throw new Error(`Reference screen/source changed:\n${changed.join('\n')}`);
console.log(`${verified} original source files match ${manifest.repository}@${manifest.commit}; ${manifest.files.filter(f => f.boundary).length} documented runtime/API boundaries.`);
