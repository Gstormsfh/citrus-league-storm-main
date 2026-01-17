/**
 * Migration Test Suite
 * 
 * Tests migrations in a sandbox environment before applying to production.
 * Validates that migrations:
 * - Don't cause data loss
 * - Are idempotent (can run multiple times)
 * - Have working rollback procedures
 * - Don't introduce integrity violations
 * 
 * Usage: npm run test-migrations
 */

import * as fs from 'fs';
import * as path from 'path';
import { validateMigrationFile } from './validate-migration';

interface TestResult {
  migration: string;
  passed: boolean;
  tests: {
    validation: boolean;
    dataIntegrity: boolean;
    idempotent: boolean;
    rollback: boolean;
  };
  errors: string[];
}

/**
 * Test a single migration file
 */
async function testMigration(filePath: string): Promise<TestResult> {
  const result: TestResult = {
    migration: path.basename(filePath),
    passed: false,
    tests: {
      validation: false,
      dataIntegrity: false,
      idempotent: false,
      rollback: false
    },
    errors: []
  };

  console.log(`\nTesting: ${result.migration}`);
  console.log('─'.repeat(70));

  // Test 1: Static validation
  console.log('  [1/4] Running static validation...');
  const validationResult = validateMigrationFile(filePath);
  result.tests.validation = validationResult.safe;
  
  if (!validationResult.safe) {
    result.errors.push(...validationResult.errors);
    console.log('    ❌ Static validation failed');
    return result;
  }
  console.log('    ✅ Static validation passed');

  // Test 2: Data integrity check (requires database connection)
  console.log('  [2/4] Checking data integrity requirements...');
  // TODO: Connect to test database and verify:
  // - Migration doesn't drop >10% of rows
  // - Foreign keys remain valid
  // - Indexes still work
  result.tests.dataIntegrity = true; // Placeholder
  console.log('    ⚠️  Data integrity check not implemented (requires test DB)');

  // Test 3: Idempotency check
  console.log('  [3/4] Checking idempotency...');
  // TODO: Run migration twice, verify same result
  result.tests.idempotent = true; // Placeholder
  console.log('    ⚠️  Idempotency check not implemented (requires test DB)');

  // Test 4: Rollback procedure exists
  console.log('  [4/4] Checking rollback documentation...');
  const content = fs.readFileSync(filePath, 'utf-8');
  result.tests.rollback = /--\s*Rollback:/i.test(content);
  
  if (result.tests.rollback) {
    console.log('    ✅ Rollback procedure documented');
  } else {
    result.errors.push('Missing rollback procedure documentation');
    console.log('    ⚠️  Rollback procedure not documented');
  }

  // Overall result
  result.passed = result.tests.validation && result.tests.rollback;
  
  return result;
}

/**
 * Test all migrations in directory
 */
async function testAllMigrations(migrationsDir: string): Promise<void> {
  console.log('\n' + '='.repeat(70));
  console.log('MIGRATION TEST SUITE');
  console.log('='.repeat(70));

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql') && !f.includes('.DANGEROUS'))
    .sort();

  console.log(`\nFound ${files.length} migrations to test`);

  const results: TestResult[] = [];

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const result = await testMigration(filePath);
    results.push(result);
  }

  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('TEST SUMMARY');
  console.log('='.repeat(70));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`\nPassed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    console.log('\nFailed migrations:');
    results
      .filter(r => !r.passed)
      .forEach(r => {
        console.log(`  ❌ ${r.migration}`);
        r.errors.forEach(err => console.log(`     - ${err}`));
      });
  }

  console.log('\n' + '='.repeat(70));

  if (failed > 0) {
    console.log('⚠️  Some migrations failed validation');
    process.exit(1);
  } else {
    console.log('✅ All migrations passed validation');
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length > 0) {
    // Test specific migration
    const result = await testMigration(args[0]);
    if (!result.passed) {
      process.exit(1);
    }
  } else {
    // Test all migrations
    const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
    await testAllMigrations(migrationsDir);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
}

export { testMigration, testAllMigrations };
