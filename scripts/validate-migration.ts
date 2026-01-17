/**
 * Migration Validator
 * 
 * Scans SQL migration files for dangerous operations that could cause data loss.
 * Run this before applying any migration to production.
 * 
 * Usage: npm run validate-migration <migration-file>
 *        npm run validate-all-migrations
 */

import * as fs from 'fs';
import * as path from 'path';

interface ValidationResult {
  file: string;
  safe: boolean;
  errors: string[];
  warnings: string[];
}

const DANGEROUS_PATTERNS = [
  {
    pattern: /TRUNCATE\s+TABLE/gi,
    severity: 'error',
    message: 'TRUNCATE TABLE detected - this deletes all data without backup!',
    suggestion: 'Use DELETE with WHERE clause or backup data first'
  },
  {
    pattern: /DELETE\s+FROM\s+\w+\s*;/gi,
    severity: 'error',
    message: 'DELETE without WHERE clause - this deletes ALL rows!',
    suggestion: 'Add WHERE clause or use TRUNCATE with backup'
  },
  {
    pattern: /DROP\s+TABLE\s+(?!IF\s+EXISTS.*_backup)/gi,
    severity: 'error',
    message: 'DROP TABLE without backup detected',
    suggestion: 'Create backup table first: CREATE TABLE table_backup AS SELECT * FROM table'
  },
  {
    pattern: /ALTER\s+TABLE.*ALTER\s+COLUMN.*TYPE/gi,
    severity: 'warning',
    message: 'ALTER COLUMN TYPE detected - may cause data loss',
    suggestion: 'Verify data can be cast safely, consider creating new column and migrating'
  },
  {
    pattern: /DROP\s+COLUMN/gi,
    severity: 'warning',
    message: 'DROP COLUMN detected - permanent data loss',
    suggestion: 'Verify column is truly unused, consider renaming to _deprecated first'
  },
  {
    pattern: /UPDATE.*SET.*WHERE/gi,
    severity: 'info',
    message: 'UPDATE with WHERE detected - verify logic is correct',
    suggestion: 'Test UPDATE in dev environment first'
  }
];

const REQUIRED_ELEMENTS = [
  {
    pattern: /--\s*Rollback:/i,
    message: 'Missing rollback procedure',
    suggestion: 'Add comment: -- Rollback: [steps to undo this migration]'
  },
  {
    pattern: /--.*backup/i,
    message: 'No backup mentioned',
    suggestion: 'Document backup strategy or add backup step'
  }
];

function validateMigrationFile(filePath: string): ValidationResult {
  const result: ValidationResult = {
    file: path.basename(filePath),
    safe: true,
    errors: [],
    warnings: []
  };

  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Check for dangerous patterns
    for (const check of DANGEROUS_PATTERNS) {
      const matches = content.match(check.pattern);
      if (matches) {
        const message = `${check.message}\n  Found: ${matches[0]}\n  Suggestion: ${check.suggestion}`;
        
        if (check.severity === 'error') {
          result.errors.push(message);
          result.safe = false;
        } else if (check.severity === 'warning') {
          result.warnings.push(message);
        }
      }
    }

    // Check for required elements
    for (const requirement of REQUIRED_ELEMENTS) {
      if (!requirement.pattern.test(content)) {
        result.warnings.push(`${requirement.message}\n  ${requirement.suggestion}`);
      }
    }

    // Check file size (migrations shouldn't be huge)
    const sizeKB = Buffer.byteLength(content, 'utf-8') / 1024;
    if (sizeKB > 1000) {
      result.warnings.push(`Large migration file (${sizeKB.toFixed(0)}KB) - consider splitting`);
    }

    // Check for .DANGEROUS extension
    if (filePath.includes('.DANGEROUS')) {
      result.errors.push('This migration has been marked as DANGEROUS and should not be run!');
      result.safe = false;
    }

  } catch (error) {
    result.errors.push(`Failed to read file: ${error}`);
    result.safe = false;
  }

  return result;
}

function validateAllMigrations(migrationsDir: string): ValidationResult[] {
  const results: ValidationResult[] = [];
  
  try {
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      results.push(validateMigrationFile(filePath));
    }
  } catch (error) {
    console.error(`Failed to read migrations directory: ${error}`);
  }

  return results;
}

function printResults(results: ValidationResult[]): void {
  console.log('\n' + '='.repeat(70));
  console.log('MIGRATION VALIDATION REPORT');
  console.log('='.repeat(70) + '\n');

  let totalSafe = 0;
  let totalUnsafe = 0;
  let totalWarnings = 0;

  for (const result of results) {
    const status = result.safe ? '✅ SAFE' : '❌ UNSAFE';
    console.log(`${status} - ${result.file}`);

    if (result.errors.length > 0) {
      totalUnsafe++;
      console.log('\n  ERRORS:');
      result.errors.forEach(err => console.log(`    ❌ ${err}\n`));
    } else {
      totalSafe++;
    }

    if (result.warnings.length > 0) {
      totalWarnings += result.warnings.length;
      console.log('  WARNINGS:');
      result.warnings.forEach(warn => console.log(`    ⚠️  ${warn}\n`));
    }

    console.log('');
  }

  console.log('='.repeat(70));
  console.log(`SUMMARY: ${totalSafe} safe, ${totalUnsafe} unsafe, ${totalWarnings} warnings`);
  console.log('='.repeat(70));

  if (totalUnsafe > 0) {
    console.log('\n⚠️  UNSAFE MIGRATIONS DETECTED - DO NOT APPLY TO PRODUCTION\n');
    process.exit(1);
  } else if (totalWarnings > 0) {
    console.log('\n⚠️  Warnings detected - review before applying\n');
  } else {
    console.log('\n✅ All migrations passed validation\n');
  }
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    // Validate all migrations
    const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
    const results = validateAllMigrations(migrationsDir);
    printResults(results);
  } else {
    // Validate specific file
    const filePath = args[0];
    const result = validateMigrationFile(filePath);
    printResults([result]);
  }
}

export { validateMigrationFile, validateAllMigrations };
