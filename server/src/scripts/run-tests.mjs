import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';

const root = process.cwd();
const testRoots = [join(root, 'src', 'lib'), join(root, 'server', 'src')];
const testFiles = [];

function collectTests(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectTests(fullPath);
    } else if (entry.isFile() && /\.test\.ts$/.test(entry.name)) {
      testFiles.push(relative(root, fullPath));
    }
  }
}

for (const directory of testRoots) collectTests(directory);
testFiles.sort();

if (testFiles.length === 0) {
  console.error('No TypeScript test files were found.');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...testFiles.map((file) => resolve(root, file))],
  { cwd: root, stdio: 'inherit' },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
