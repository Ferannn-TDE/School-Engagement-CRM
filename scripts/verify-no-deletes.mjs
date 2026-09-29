/**
 * Fails if any app code under src/ calls a delete on the database.
 *
 * Run:  npm run verify:no-deletes
 *
 * The database refuses deletes from signed-in users (db/010), silently: the request
 * succeeds and removes 0 rows, so a delete in the app would look like it worked and
 * the item would come back on the next load. The app archives instead (db/009).
 *
 * A Supabase delete is `.delete()` with no argument or with an options object
 * (`.delete({ count: 'exact' })`). Deletes on a Map, Set or URLSearchParams always
 * pass a key, so they don't match.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const srcDir = join(root, 'src');
const DB_DELETE = /\.delete\s*\(\s*(\)|\{)/g;

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) yield path;
  }
}

const found = [];
for (const file of sourceFiles(srcDir)) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(DB_DELETE)) {
    const line = text.slice(0, match.index).split('\n').length;
    const code = text.split('\n')[line - 1].trim();
    found.push(`  ${relative(root, file)}:${line}  ${code}`);
  }
}

if (found.length > 0) {
  console.error(`\nverify:no-deletes FAILED: ${found.length} database delete call${found.length === 1 ? '' : 's'} in src/\n`);
  console.error(found.join('\n'));
  console.error(`
The database refuses deletes from signed-in users (db/010). A delete sent from the
app removes 0 rows without an error, so the item would seem to disappear and then
come back on reload. Archive instead: set archived = true (events, programs,
activities) or call archive_school / archive_contact (see the archive functions in
src/services and db/009). Settings → Archived lets people restore.
`);
  process.exit(1);
}

console.log('verify:no-deletes: no database delete calls in src/');
