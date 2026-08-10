#!/usr/bin/env node
/**
 * Audit cross-schema DDL across supabase/migrations/*.sql.
 *
 * BACKGROUND
 *   The staging bootstrap script (01-mark-migrations-applied.sql) marks all
 *   prod migrations as already-applied in supabase_migrations.schema_migrations,
 *   under the assumption that a prod schema dump was applied beforehand.
 *   Schema dumps silently skip cross-schema DDL — DDL that lives in `public`
 *   but targets objects in managed schemas like `auth`, `storage`, `realtime`.
 *   The metadata claims those migrations ran, but the actual cross-schema
 *   pieces never landed.
 *
 *   Tonight we found one such gap: the `on_auth_user_created` trigger on
 *   `auth.users`. This script finds every other piece of cross-schema DDL
 *   in the migration history so we can patch staging without re-running the
 *   broken bootstrap from scratch.
 *
 * READ-ONLY. No database connection. No file writes. Reads
 * supabase/migrations/*.sql, prints a JSON-shaped audit report to stdout.
 *
 * Usage:
 *   node scripts/staging/audit-cross-schema-ddl.mjs
 *
 * Output: { summary, findings } JSON to stdout. Progress to stderr.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');

// Schemas considered non-public for the purpose of this audit. Anything
// landing here from a public-schema migration is at risk of being dropped
// by the bootstrap schema dump.
const NON_PUBLIC_SCHEMAS = new Set([
  'auth',
  'storage',
  'realtime',
  '_realtime',
  'supabase_functions',
  'vault',
  'extensions',
  'graphql',
  'graphql_public',
  'pgsodium',
  'cron',
  'net',
]);

// ─────────────────────────────────────────────────────────────────────
// Comment stripping. Replaces -- line and /* block */ comments with
// spaces, preserving newlines + total length so character offsets in the
// stripped text still map 1:1 to line numbers in the original.
// String literals ('...') and dollar-quoted blocks ($$...$$, $tag$...$tag$)
// are PRESERVED — comments inside them are not stripped.
// ─────────────────────────────────────────────────────────────────────
function stripComments(sql) {
  const out = [];
  const n = sql.length;
  let i = 0;
  let mode = 'normal';
  let dquoteTag = null;

  while (i < n) {
    const c = sql[i];
    const cn = sql[i + 1];

    if (mode === 'normal') {
      if (c === '$') {
        const m = sql.slice(i).match(/^\$([A-Za-z_][\w]*)?\$/);
        if (m) {
          dquoteTag = m[0];
          mode = 'dquote';
          out.push(dquoteTag);
          i += dquoteTag.length;
          continue;
        }
      }
      if (c === "'") { mode = 'string'; out.push(c); i++; continue; }
      if (c === '-' && cn === '-') { mode = 'line-comment'; out.push('  '); i += 2; continue; }
      if (c === '/' && cn === '*') { mode = 'block-comment'; out.push('  '); i += 2; continue; }
      out.push(c);
      i++;
      continue;
    }
    if (mode === 'line-comment') {
      if (c === '\n') { mode = 'normal'; out.push('\n'); i++; }
      else { out.push(' '); i++; }
      continue;
    }
    if (mode === 'block-comment') {
      if (c === '*' && cn === '/') { mode = 'normal'; out.push('  '); i += 2; }
      else if (c === '\n') { out.push('\n'); i++; }
      else { out.push(' '); i++; }
      continue;
    }
    if (mode === 'string') {
      out.push(c);
      if (c === "'" && cn === "'") { out.push(cn); i += 2; continue; }
      if (c === "'") mode = 'normal';
      i++;
      continue;
    }
    if (mode === 'dquote') {
      if (c === '$' && sql.startsWith(dquoteTag, i)) {
        out.push(dquoteTag);
        i += dquoteTag.length;
        dquoteTag = null;
        mode = 'normal';
        continue;
      }
      out.push(c);
      i++;
      continue;
    }
  }
  return out.join('');
}

function offsetToLine(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

// Walk the stripped text up to `offset`. Return true if that offset falls
// inside an open dollar-quoted block (i.e., function body or DO block).
function isInsideDollarQuote(strippedSql, offset) {
  let i = 0;
  let activeTag = null;
  while (i < offset) {
    if (!activeTag) {
      const slice = strippedSql.slice(i, i + 64);
      const m = slice.match(/^\$([A-Za-z_][\w]*)?\$/);
      if (m) { activeTag = m[0]; i += activeTag.length; continue; }
    } else {
      if (strippedSql.startsWith(activeTag, i)) {
        i += activeTag.length;
        activeTag = null;
        continue;
      }
    }
    i++;
  }
  return activeTag !== null;
}

// ─────────────────────────────────────────────────────────────────────
// DDL patterns. Each yields { schema, object } captured groups indicating
// the *target* of the statement. Non-public targets become findings.
// ─────────────────────────────────────────────────────────────────────
const PATTERNS = [
  {
    type: 'CREATE TRIGGER',
    regex: /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?\w+\s+(?:BEFORE|AFTER|INSTEAD\s+OF)\b[\s\S]{0,200}?\bON\s+(?:ONLY\s+)?(\w+)\.(\w+)/gi,
    schemaIdx: 1, objectIdx: 2,
  },
  {
    type: 'DROP TRIGGER',
    regex: /\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?\w+\s+ON\s+(?:ONLY\s+)?(\w+)\.(\w+)/gi,
    schemaIdx: 1, objectIdx: 2,
  },
  {
    type: 'CREATE POLICY',
    regex: /\bCREATE\s+POLICY\s+(?:"[^"]+"|\w+)\s+ON\s+(\w+)\.(\w+)/gi,
    schemaIdx: 1, objectIdx: 2,
  },
  {
    type: 'DROP POLICY',
    regex: /\bDROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?(?:"[^"]+"|\w+)\s+ON\s+(\w+)\.(\w+)/gi,
    schemaIdx: 1, objectIdx: 2,
  },
  {
    type: 'ALTER POLICY',
    regex: /\bALTER\s+POLICY\s+(?:"[^"]+"|\w+)\s+ON\s+(\w+)\.(\w+)/gi,
    schemaIdx: 1, objectIdx: 2,
  },
  {
    type: 'GRANT (object)',
    regex: /\b(?:GRANT|REVOKE)\b[\s\S]{0,200}?\bON\s+(?:TABLE\s+|FUNCTION\s+|SEQUENCE\s+)?(\w+)\.(\w+)\s+(?:TO|FROM)\b/gi,
    schemaIdx: 1, objectIdx: 2,
  },
  {
    type: 'GRANT (schema)',
    regex: /\b(?:GRANT|REVOKE)\b[\s\S]{0,100}?\bON\s+SCHEMA\s+(\w+)\s+(?:TO|FROM)\b/gi,
    schemaIdx: 1, objectIdx: null,
  },
  {
    type: 'GRANT (all in schema)',
    regex: /\b(?:GRANT|REVOKE)\b[\s\S]{0,200}?\bON\s+ALL\s+(?:TABLES|FUNCTIONS|SEQUENCES)\s+IN\s+SCHEMA\s+(\w+)\s+(?:TO|FROM)\b/gi,
    schemaIdx: 1, objectIdx: null,
  },
  {
    type: 'INSERT INTO',
    regex: /\bINSERT\s+INTO\s+(\w+)\.(\w+)/gi,
    schemaIdx: 1, objectIdx: 2,
  },
  {
    type: 'UPDATE',
    regex: /\bUPDATE\s+(?:ONLY\s+)?(\w+)\.(\w+)\s+SET\b/gi,
    schemaIdx: 1, objectIdx: 2,
  },
  {
    type: 'DELETE FROM',
    regex: /\bDELETE\s+FROM\s+(?:ONLY\s+)?(\w+)\.(\w+)/gi,
    schemaIdx: 1, objectIdx: 2,
  },
  {
    type: 'CREATE FUNCTION',
    regex: /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(\w+)\.(\w+)\s*\(/gi,
    schemaIdx: 1, objectIdx: 2,
  },
  {
    type: 'DROP FUNCTION',
    regex: /\bDROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(\w+)\.(\w+)/gi,
    schemaIdx: 1, objectIdx: 2,
  },
  {
    type: 'ALTER FUNCTION',
    regex: /\bALTER\s+FUNCTION\s+(\w+)\.(\w+)\s*\(/gi,
    schemaIdx: 1, objectIdx: 2,
  },
  {
    type: 'CREATE PROCEDURE',
    regex: /\bCREATE\s+(?:OR\s+REPLACE\s+)?PROCEDURE\s+(\w+)\.(\w+)\s*\(/gi,
    schemaIdx: 1, objectIdx: 2,
  },
  {
    type: 'CREATE TABLE',
    regex: /\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\.(\w+)\s*\(/gi,
    schemaIdx: 1, objectIdx: 2,
  },
  {
    type: 'ALTER TABLE',
    regex: /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(\w+)\.(\w+)\b/gi,
    schemaIdx: 1, objectIdx: 2,
  },
  {
    type: 'CREATE INDEX',
    regex: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?\w+\s+ON\s+(?:ONLY\s+)?(\w+)\.(\w+)/gi,
    schemaIdx: 1, objectIdx: 2,
  },
  {
    type: 'CREATE VIEW',
    regex: /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\.(\w+)\s+AS\b/gi,
    schemaIdx: 1, objectIdx: 2,
  },
  {
    type: 'CREATE EXTENSION',
    // Group 1 = extension name; Group 2 = explicit schema if WITH SCHEMA used
    regex: /\bCREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?(?:\s+WITH(?:\s+SCHEMA\s+(\w+))?)?/gi,
    extensionName: true,
  },
];

const SET_SEARCH_PATH_RE = /\bSET\s+(?:LOCAL\s+|SESSION\s+)?search_path\s*(?:TO|=)\s*([^;\n]+)/gi;

function auditFile(filename) {
  const fullPath = path.join(MIGRATIONS_DIR, filename);
  const original = fs.readFileSync(fullPath, 'utf8');
  const stripped = stripComments(original);
  const findings = [];

  // Collect any non-public search_path manipulations for caveats
  const searchPaths = [];
  for (const m of stripped.matchAll(SET_SEARCH_PATH_RE)) {
    searchPaths.push({ offset: m.index, value: m[1].trim() });
  }
  const setsNonPublicSearchPath = searchPaths.some(sp =>
    [...NON_PUBLIC_SCHEMAS].some(s => sp.value.toLowerCase().includes(s)));

  for (const pattern of PATTERNS) {
    for (const m of stripped.matchAll(pattern.regex)) {
      const offset = m.index;
      const lineNumber = offsetToLine(original, offset);

      // Special handling for CREATE EXTENSION: schema may be implicit
      if (pattern.extensionName) {
        const extName = m[1]?.toLowerCase();
        const explicitSchema = m[2]?.toLowerCase() || null;
        if (explicitSchema && NON_PUBLIC_SCHEMAS.has(explicitSchema)) {
          findings.push({
            migration_filename: filename,
            line_number: lineNumber,
            statement_type: pattern.type,
            target_schema: explicitSchema,
            target_object: extName,
            full_statement: m[0].replace(/\s+/g, ' ').trim(),
            confidence: 'high',
            notes: `Extension ${extName} pinned to non-public schema ${explicitSchema}.`,
          });
        } else if (!explicitSchema) {
          findings.push({
            migration_filename: filename,
            line_number: lineNumber,
            statement_type: pattern.type,
            target_schema: '(unspecified)',
            target_object: extName,
            full_statement: m[0].replace(/\s+/g, ' ').trim(),
            confidence: 'low',
            notes: 'Extension schema not explicitly specified; lands in default schema (often `extensions` on Supabase). May or may not survive a schema dump.',
          });
        }
        continue;
      }

      const schema = m[pattern.schemaIdx]?.toLowerCase();
      const object = pattern.objectIdx ? m[pattern.objectIdx]?.toLowerCase() : null;
      if (!schema || !NON_PUBLIC_SCHEMAS.has(schema)) continue;

      const insideFunctionBody = isInsideDollarQuote(stripped, offset);
      let confidence = 'high';
      const noteParts = [];

      if (insideFunctionBody) {
        confidence = 'medium';
        noteParts.push('Inside a function body / DO block — may be a runtime call rather than a deploy-time DDL.');
      }
      if (setsNonPublicSearchPath) {
        if (confidence === 'high') confidence = 'medium';
        noteParts.push('File contains a SET search_path with a non-public schema; verify object resolution manually.');
      }

      findings.push({
        migration_filename: filename,
        line_number: lineNumber,
        statement_type: pattern.type,
        target_schema: schema,
        target_object: object ? `${schema}.${object}` : schema,
        full_statement: m[0].replace(/\s+/g, ' ').trim(),
        confidence,
        notes: noteParts.join(' '),
      });
    }
  }

  return findings;
}

function main() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.error(`Auditing ${files.length} migration files in ${MIGRATIONS_DIR}\n`);

  const allFindings = [];
  let filesWithFindings = 0;
  for (const f of files) {
    try {
      const findings = auditFile(f);
      if (findings.length > 0) filesWithFindings++;
      allFindings.push(...findings);
    } catch (err) {
      console.error(`Error auditing ${f}: ${err.message}`);
    }
  }

  // Dedupe identical findings (same file/line/type/target combo)
  const seen = new Set();
  const deduped = allFindings.filter(f => {
    const key = `${f.migration_filename}|${f.line_number}|${f.statement_type}|${f.target_object}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const summary = {
    files_scanned: files.length,
    files_with_findings: filesWithFindings,
    total_findings: deduped.length,
    by_target_schema: {},
    by_statement_type: {},
    by_confidence: { high: 0, medium: 0, low: 0 },
  };
  for (const f of deduped) {
    summary.by_target_schema[f.target_schema] = (summary.by_target_schema[f.target_schema] || 0) + 1;
    summary.by_statement_type[f.statement_type] = (summary.by_statement_type[f.statement_type] || 0) + 1;
    summary.by_confidence[f.confidence] = (summary.by_confidence[f.confidence] || 0) + 1;
  }

  console.log(JSON.stringify({ summary, findings: deduped }, null, 2));
  console.error(`\n${deduped.length} findings across ${filesWithFindings}/${files.length} files.`);
}

main();
