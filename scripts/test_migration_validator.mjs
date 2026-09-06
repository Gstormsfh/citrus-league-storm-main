// Synthetic temporary files only; no database access or real migration changes.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateMigrationFile} from './validate-migration.ts';

const directory=await mkdtemp(join(tmpdir(),'citrus-migration-validator-'));
const prefix='-- Backup: synthetic fixture; no persistent data\n-- Rollback: discard fixture\n';
let checks=0;
try {
  const fixtures=[
    ['DROP TABLE IF EXISTS pg_temp._sides;',true],
    ['DROP TABLE pg_temp._sides RESTRICT;',true],
    ['drop\n table\n if exists\n pg_temp._sides;',true],
    ['DROP TABLE IF EXISTS public._sides;',false],
    ['DROP TABLE IF EXISTS _sides;',false],
    ['DROP TABLE pg_temp._sides, public.real_data;',false],
    ['DROP TABLE pg_temp._sides CASCADE;',false],
    ['DROP TABLE pg_temp._sides; DROP TABLE public.real_data;',false],
    ['DROP TABLE pg_temp2._sides;',false],
    ['DROP TABLE "pg_temp"."_sides";',false], // Conservative until explicitly parsed.
    ['DROP TABLE pg_temp._sides',false],
  ];
  for(const [i,[sql,safe]] of fixtures.entries()) {
    const path=join(directory,`fixture-${i}.sql`);
    await writeFile(path,prefix+sql);
    assert.equal(validateMigrationFile(path).safe,safe,sql);checks++;
  }
  const cli=fileURLToPath(new URL('./validate-migration.ts',import.meta.url));
  for(const [index,status] of [[0,0],[3,1]]) {
    const result=spawnSync(process.execPath,['--import','tsx',cli,join(directory,`fixture-${index}.sql`)],{encoding:'utf8'});
    assert.equal(result.status,status,result.stderr);checks++;
    assert(result.stdout.includes('MIGRATION VALIDATION REPORT'));checks++;
  }
  console.log(`migration validator: ${checks} checks passed; no database access`);
} finally {await rm(directory,{recursive:true,force:true});}
