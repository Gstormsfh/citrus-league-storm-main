#!/usr/bin/env python3
"""
audit_database_usage.py

Database usage audit script for Citrus Fantasy Sports.
Analyzes table sizes, indexes, and provides recommendations for Supabase plan management.

Run this script to get a comprehensive view of your database storage usage.

Note: If you encounter connection issues, you can also run the SQL query directly
in the Supabase SQL Editor. The query is in the run_audit_query() function.
"""

import os
import sys
from typing import List, Dict, Any
from decimal import Decimal

from dotenv import load_dotenv
import psycopg2
from psycopg2.extensions import connection as PGConnection


def get_connection() -> PGConnection:
    """
    Create a PostgreSQL connection using credentials from the local .env file.
    Uses the same connection logic as scripts/maintenance/archive_to_csv.py

    Supports multiple credential formats:
    1. DATABASE_URL or SUPABASE_DB_URL (full connection string)
    2. Individual PG* variables (PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD)
    
    For Supabase, prioritizes pooler.supabase.com addresses for IPv4 compatibility.
    """
    # Load variables from the project-root .env into the process environment.
    # Resolve .env relative to this file so it works regardless of current working directory.
    base_dir = os.path.abspath(os.path.dirname(__file__))
    env_path = os.path.join(base_dir, ".env")
    load_dotenv(dotenv_path=env_path)

    # First, try DATABASE_URL or SUPABASE_DB_URL (full connection string)
    database_url = os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DB_URL")
    if database_url:
        # Use the connection string directly as provided (no pooler conversion)
        return psycopg2.connect(database_url)

    # Fall back to individual PG* variables
    host = os.environ.get("PGHOST")
    port = os.environ.get("PGPORT")
    dbname = os.environ.get("PGDATABASE")
    user = os.environ.get("PGUSER")
    password = os.environ.get("PGPASSWORD")

    # If host is a Supabase direct address, try to use pooler instead
    if host and (".supabase.co" in host or ".supabase.com" in host) and "pooler" not in host:
        # Convert to pooler address: db.xxxxx.supabase.co -> db.xxxxx.pooler.supabase.com
        if ".supabase.co" in host:
            host = host.replace(".supabase.co", ".pooler.supabase.com")
        elif ".supabase.com" in host and "pooler" not in host:
            host = host.replace(".supabase.com", ".pooler.supabase.com")
        # Use port 6543 for pooler (default Supabase pooler port)
        if not port or port == "5432":
            port = "6543"

    # Check what we found for better error messages
    found_vars = []
    if host:
        found_vars.append("PGHOST")
    if port:
        found_vars.append("PGPORT")
    if dbname:
        found_vars.append("PGDATABASE")
    if user:
        found_vars.append("PGUSER")
    if password:
        found_vars.append("PGPASSWORD")
    
    # Also check for common Supabase variables
    vite_url = os.environ.get("VITE_SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    
    if not all([host, dbname, user, password]):
        error_msg = "Missing database credentials.\n"
        error_msg += "Found variables: " + (", ".join(found_vars) if found_vars else "none")
        if vite_url:
            error_msg += f", VITE_SUPABASE_URL"
        if service_key:
            error_msg += f", SUPABASE_SERVICE_ROLE_KEY"
        error_msg += "\n\n"
        error_msg += "Required: Set either:\n"
        error_msg += "  - DATABASE_URL or SUPABASE_DB_URL (full PostgreSQL connection string)\n"
        error_msg += "  - OR all of: PGHOST, PGDATABASE, PGUSER, PGPASSWORD\n"
        error_msg += "\n"
        error_msg += "For Supabase, get your connection string from:\n"
        error_msg += "  Dashboard → Settings → Database → Connection string (Session mode)"
        raise ValueError(error_msg)

    return psycopg2.connect(
        host=host,
        port=port or "5432",
        database=dbname,
        user=user,
        password=password,
    )


def parse_size(size_str: str) -> int:
    """
    Parse PostgreSQL size string (e.g., '125 MB', '2.5 GB') to bytes.
    """
    size_str = size_str.strip().upper()
    multipliers = {
        'KB': 1024,
        'MB': 1024 ** 2,
        'GB': 1024 ** 3,
        'TB': 1024 ** 4,
    }
    
    for unit, multiplier in multipliers.items():
        if unit in size_str:
            value = float(size_str.replace(unit, '').strip())
            return int(value * multiplier)
    
    # If no unit, assume bytes
    try:
        return int(size_str)
    except ValueError:
        return 0


def format_bytes(bytes_val: int) -> str:
    """Format bytes to human-readable string."""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if bytes_val < 1024.0:
            return f"{bytes_val:.2f} {unit}"
        bytes_val /= 1024.0
    return f"{bytes_val:.2f} PB"


def run_audit_query(conn: PGConnection) -> List[Dict[str, Any]]:
    """
    Run the database audit query and return results.
    """
    query = """
    SELECT 
        table_name, 
        pg_size_pretty(table_size) AS table_size, 
        pg_size_pretty(indexes_size) AS indexes_size, 
        pg_size_pretty(total_size) AS total_size,
        row_estimate
    FROM (
        SELECT 
            table_name, 
            pg_table_size(table_name) AS table_size, 
            pg_indexes_size(table_name) AS indexes_size, 
            pg_total_relation_size(table_name) AS total_size,
            (SELECT reltuples FROM pg_class WHERE relname = table_name) AS row_estimate
        FROM (
            SELECT quote_ident(table_name) AS table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
        ) AS all_tables
    ) AS pretty_sizes
    ORDER BY total_size DESC;
    """
    
    with conn.cursor() as cur:
        cur.execute(query)
        columns = [desc[0] for desc in cur.description]
        results = []
        for row in cur.fetchall():
            result = dict(zip(columns, row))
            # Convert row_estimate to int if it's a Decimal
            if isinstance(result.get('row_estimate'), Decimal):
                result['row_estimate'] = int(result['row_estimate'])
            results.append(result)
        return results


def get_total_database_size(conn: PGConnection) -> int:
    """Get total database size in bytes."""
    query = """
    SELECT pg_database_size(current_database()) AS db_size;
    """
    with conn.cursor() as cur:
        cur.execute(query)
        result = cur.fetchone()
        return result[0] if result else 0


def print_audit_report(results: List[Dict[str, Any]], total_db_size: int):
    """
    Print a formatted audit report with recommendations.
    """
    print("=" * 80)
    print("CITRUS FANTASY SPORTS - DATABASE USAGE AUDIT")
    print("=" * 80)
    print()
    
    # Print table-by-table breakdown
    print("TABLE SIZE BREAKDOWN")
    print("-" * 80)
    print(f"{'Table Name':<40} {'Table Size':<15} {'Index Size':<15} {'Total Size':<15} {'Rows':<15}")
    print("-" * 80)
    
    total_table_size = 0
    total_index_size = 0
    
    for row in results:
        table_name = row['table_name']
        table_size_str = row['table_size']
        indexes_size_str = row['indexes_size']
        total_size_str = row['total_size']
        row_estimate = row.get('row_estimate', 0)
        
        # Parse sizes to bytes for calculations
        table_size_bytes = parse_size(table_size_str)
        indexes_size_bytes = parse_size(indexes_size_str)
        total_size_bytes = parse_size(total_size_str)
        
        total_table_size += table_size_bytes
        total_index_size += indexes_size_bytes
        
        # Format row estimate
        row_str = f"{row_estimate:,}" if row_estimate else "N/A"
        
        print(f"{table_name:<40} {table_size_str:<15} {indexes_size_str:<15} {total_size_str:<15} {row_str:<15}")
    
    print("-" * 80)
    print(f"{'TOTALS':<40} {format_bytes(total_table_size):<15} {format_bytes(total_index_size):<15} {format_bytes(total_db_size):<15}")
    print()
    
    # Analysis and recommendations
    print("=" * 80)
    print("ANALYSIS & RECOMMENDATIONS")
    print("=" * 80)
    print()
    
    # Check total database size
    total_mb = total_db_size / (1024 ** 2)
    total_gb = total_db_size / (1024 ** 3)
    
    print(f"Total Database Size: {format_bytes(total_db_size)} ({total_mb:.2f} MB)")
    print()
    
    # Find largest tables
    if results:
        largest_table = results[0]
        largest_size_mb = parse_size(largest_table['total_size']) / (1024 ** 2)
        
        print(f"Largest Table: {largest_table['table_name']} ({largest_table['total_size']})")
        if largest_size_mb > 100:
            print("  ⚠️  WARNING: This table exceeds 100 MB. Monitor closely!")
        print()
    
    # Check index overhead
    index_ratio = (total_index_size / total_table_size * 100) if total_table_size > 0 else 0
    print(f"Index Overhead: {format_bytes(total_index_size)} ({index_ratio:.1f}% of table data)")
    if index_ratio > 50:
        print("  ⚠️  WARNING: Indexes are >50% of table size. Consider reviewing index strategy.")
    print()
    
    # Plan recommendations
    print("SUPABASE PLAN RECOMMENDATION:")
    print("-" * 80)
    
    if total_mb < 100:
        print("✅ Total Size < 100 MB: Stay on Free Plan")
        print("   You're well within the 500 MB limit. Keep 'vibe coding' in Cursor!")
    elif total_mb < 300:
        print("⚠️  Total Size 100-300 MB: Monitor Closely")
        print("   You're at 20-60% of the 500 MB limit. Start planning for upgrade.")
        print("   Consider data archiving strategies for historical data.")
    elif total_mb < 400:
        print("🚨 Total Size 300-400 MB: Upgrade Recommended Soon")
        print("   You're at 60-80% of the 500 MB limit.")
        print("   The $25/month Pro Plan gives you 8 GB storage and daily backups.")
        print("   This is insurance for your hard work!")
    else:
        print("🔴 Total Size > 400 MB: Upgrade Required")
        print("   You're at >80% of the 500 MB limit.")
        print("   Once you hit 500 MB, Supabase can put your database into read-only mode.")
        print("   For an app that relies on daily scrapes, this will break your logic!")
        print("   UPGRADE TO PRO PLAN NOW: $25/month for 8 GB storage")
    
    print()
    print("=" * 80)
    print("NOTES")
    print("=" * 80)
    print("• Indexes count toward your 500 MB limit!")
    print("• Player Game Stats table will likely be your largest table.")
    print("• In a typical NHL season, you'll generate ~2,600+ team-game logs.")
    print("• If storing detailed stats for every player in every game, growth is exponential.")
    print("• The 80% rule: At 400 MB (80%), it's time to upgrade to Pro Plan.")
    print()


def main():
    """Main execution function."""
    try:
        print("Connecting to database...")
        conn = get_connection()
        
        print("Running audit query...")
        results = run_audit_query(conn)
        
        print("Calculating total database size...")
        total_db_size = get_total_database_size(conn)
        
        print()
        print_audit_report(results, total_db_size)
        
        conn.close()
        print("Audit complete!")
        
    except Exception as e:
        import traceback
        print(f"Error running audit: {e}", file=sys.stderr)
        print(f"Exception type: {type(e).__name__}", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
