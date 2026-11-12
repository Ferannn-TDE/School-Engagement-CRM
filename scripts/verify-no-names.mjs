/**
 * Fails if visitors' names (db/029, student data) can reach anything but the screens
 * meant for them.
 *
 * Run:  npm run verify:no-names
 *
 * Names live in import_rows.visitor_name, readable by editors and admins only (RLS).
 * They may appear only where an editor looks at an import or an activity: the Import
 * page's rows preview and the activity details panel. They must never reach Generate
 * Lists, CSV or Excel exports (Generate Lists, Reports lists, Settings' export), Reports,
 * or any shared type such as ActivityRecord. So every file that mentions a name field,
 * or reads import_rows, must be on the list below, and none of the export or report
 * files may be on it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const srcDir = join(root, 'src');
const NAME = /visitorName|visitor_name|fetchVisitorNames|fetchImportRows|import_rows/;

// The only files allowed to mention names or read import_rows.
const ALLOWED = new Set([
  'src/services/importBatchesService.ts',     // reads and writes import_rows
  'src/components/imports/ImportRows.tsx',     // "View rows" / "Add rows from the original file"
  'src/components/imports/ActivityImport.tsx', // saves the rows with an import
  'src/components/activities/ActivityDetails.tsx', // lists names for editors
  'src/utils/activityImportFile.ts',           // reads the Name column
  'src/utils/activityImportMatch.ts',          // FileRow carries it from the file
]);

// Files that build lists, exports or reports: never allowed, whatever the list above says.
const NEVER = [
  /^src\/pages\/GenerateListsPage\.tsx$/,
  /^src\/pages\/ReportsPage\.tsx$/,
  /^src\/pages\/SettingsPage\.tsx$/,
  /^src\/utils\/report/,
  /^src\/components\/reports\//,
  /^src\/types\//,
];

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) yield path;
  }
}

const problems = [];
for (const file of sourceFiles(srcDir)) {
  const rel = relative(root, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!NAME.test(line)) return;
    if (NEVER.some((re) => re.test(rel))) problems.push(`${rel}:${i + 1}  names must never appear here (lists, exports, reports, shared types)`);
    else if (!ALLOWED.has(rel)) problems.push(`${rel}:${i + 1}  not an allowed place for visitors' names`);
  });
}
for (const rel of ALLOWED) {
  if (NEVER.some((re) => re.test(rel))) problems.push(`${rel}  is both allowed and forbidden: fix the lists in this script`);
}

if (problems.length) {
  console.error("verify:no-names: visitors' names (student data, db/029) found outside the allowed places:");
  for (const p of problems) console.error('  ' + p);
  console.error('Keep names to the import rows preview and the activity details panel.');
  process.exit(1);
}
console.log(`verify:no-names: names appear only in the ${ALLOWED.size} allowed files`);
