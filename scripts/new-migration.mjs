// Starts a database migration: writes database/migrations/NNNN_<name>.sql
// (the next number) from a template, adds it to the list of migrations
// at the end of schema.sql, and bumps REQUIRED_SCHEMA_VERSION (the app warns
// when its database is behind). The change itself still goes into both files;
// npm run test:db checks that they agree.
//
// Usage (repo root):  npm run db:new-migration -- add_invoice_notes
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";

const name = process.argv[2] ?? "";
if (!/^[a-z0-9_]+$/.test(name)) {
  console.error("Usage: npm run db:new-migration -- <name>   (lowercase letters, digits and _)");
  process.exit(1);
}

const dir = "database/migrations";
const last = readdirSync(dir)
  .map((file) => /^(\d{4})_/.exec(file))
  .filter(Boolean)
  .reduce((max, m) => Math.max(max, Number(m[1])), 0);
const version = last + 1;
const file = `${dir}/${String(version).padStart(4, "0")}_${name}.sql`;
if (existsSync(file)) {
  console.error(`${file} already exists`);
  process.exit(1);
}

writeFileSync(
  file,
  `-- ${String(version).padStart(4, "0")} ${name}: <what changes, and why>
--
-- Make the same change in schema.sql, where it belongs in that file's
-- order (npm run test:db checks that baseline.sql + migrations = schema.sql).

BEGIN;

-- Refuses to run twice or before migration ${version - 1}
SELECT apply_migration(${version}, '${name}');

-- The change

COMMIT;
`,
);

// Record it in schema.sql's list, so a fresh database counts as migrated
const schemaPath = "database/schema.sql";
const schema = readFileSync(schemaPath, "utf8");
const list = /(INSERT INTO schema_migrations \(version, name\) VALUES\r?\n(?:\s+\(\d+, '[a-z0-9_]+'\),\r?\n)*\s+\(\d+, '[a-z0-9_]+'\));/;
if (!list.test(schema)) {
  console.error(`Wrote ${file}, but couldn't find the migration list in ${schemaPath}: add (${version}, '${name}') there by hand.`);
  process.exit(1);
}
const eol = schema.includes("\r\n") ? "\r\n" : "\n";
writeFileSync(schemaPath, schema.replace(list, `$1,${eol}    (${version}, '${name}');`));

// The app warns at sign-in when its database is behind this number
const versionPath = "src/supabase/schemaVersion.ts";
const versionSource = readFileSync(versionPath, "utf8");
const constant = /export const REQUIRED_SCHEMA_VERSION = \d+;/;
if (constant.test(versionSource)) {
  writeFileSync(versionPath, versionSource.replace(constant, `export const REQUIRED_SCHEMA_VERSION = ${version};`));
} else {
  console.error(`Couldn't find REQUIRED_SCHEMA_VERSION in ${versionPath}: set it to ${version} by hand.`);
}

console.log(`Wrote ${file}, listed it in ${schemaPath} and set REQUIRED_SCHEMA_VERSION to ${version}.`);
console.log("Next: write the change in both files, then npm run test:db.");
