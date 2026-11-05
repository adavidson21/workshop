// scripts/sync-workshop.mjs (every app's copy comes from here): --update follows relative imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { importsOf } from '../../scripts/sync-workshop.mjs';

test('importsOf finds static and dynamic relative imports, as bundle paths', () => {
  const src = Buffer.from(`import { a } from './teams.js';\nimport './side.js';\nconst m = await import('../icons/x.js');\nimport z from 'node:fs';\n// from 'nope'`);
  assert.deepEqual(importsOf('shared/workshop-sdk.js', src).sort(), ['icons/x.js', 'shared/side.js', 'shared/teams.js']);
  assert.deepEqual(importsOf('shared/themes.css', src), []);
});
