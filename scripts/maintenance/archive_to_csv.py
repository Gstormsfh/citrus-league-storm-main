import os
import sys
from datetime import datetime, timezone
from typing import Optional, Tuple, List

from dotenv import load_dotenv
import psycopg2
from psycopg2.extensions import connection as PGConnection


def get_connection() -> PGConnection:
    """
    Create a PostgreSQL connection using credentials from the local .env file.

    Supports multiple credential formats:
    1. DATABASE_URL or SUPABASE_DB_URL (full connection string)
    2. Individual PG* variables (PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD)
    
    For Supabase, prioritizes pooler.supabase.com addresses for IPv4 compatibility.
    """
    # Load variables from the project-root .env into the process environment.
    # Resolve .env relative to this file so it works regardless of current working directory.
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
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
        dbname=dbname,
        user=user,
        password=password,
    )


def ensure_directory(path: str) -> None:
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)


def human_readable_bytes(num_bytes: int) -> str:
    """Convert a byte count into a human-readable string."""
    step = 1024.0
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(num_bytes)
    unit_index = 0
    while size >= step and unit_index < len(units) - 1:
        size /= step
        unit_index += 1
    return f"{size:.2f} {units[unit_index]}"


def count_csv_rows(path: str) -> int:
    """
    Count the number of data rows in a CSV file, excluding the header.
    Implemented as a streaming line counter to avoid loading the file into memory.
    """
    total_lines = 0
    with open(path, "r", encoding="utf-8") as f:
        for _ in f:
            total_lines += 1
    # Subtract one for the header row, but never go below zero.
    return max(total_lines - 1, 0)


def archive_raw_shots(conn: PGConnection, timestamp_str: str) -> Tuple[Optional[str], int]:
    """
    Stream the entire raw_shots table to a CSV file using COPY ... TO STDOUT.

    Returns a tuple of (csv_path or None on failure, row_count_archived).
    """
    # Use a stable filename as requested; this file will be overwritten on each run.
    csv_path = os.path.join("data", "archive", "raw_shots_backup.csv")
    ensure_directory(csv_path)

    print(f"Archiving raw_shots to {csv_path} ...")
    with conn.cursor() as cur, open(csv_path, "w", encoding="utf-8", newline="") as f:
        copy_sql = "COPY raw_shots TO STDOUT WITH CSV HEADER"
        cur.copy_expert(copy_sql, f)

    # Verify row counts: DB vs CSV
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM raw_shots;")
        (db_count,) = cur.fetchone()

    csv_count = count_csv_rows(csv_path)
    print(f"raw_shots rows in DB: {db_count}, rows in CSV: {csv_count}")

    if db_count != csv_count:
        print(
            "ERROR: Row count mismatch for raw_shots "
            f"(db={db_count}, csv={csv_count}). Aborting without truncation.",
            file=sys.stderr,
        )
        return None, 0

    return csv_path, db_count


def truncate_raw_shots(conn: PGConnection) -> None:
    """Safely truncate raw_shots and restart identity in a transaction."""
    print("Truncating raw_shots with RESTART IDENTITY ...")
    with conn.cursor() as cur:
        cur.execute("TRUNCATE TABLE raw_shots RESTART IDENTITY;")


def archive_and_purge_raw_nhl_data(conn: PGConnection, timestamp_str: str) -> Tuple[Optional[str], int]:
    """
    Archive and then delete rows from raw_nhl_data where:
      - stats_extracted = TRUE
      - created_at < NOW() - INTERVAL '7 days'

    Returns a tuple of (csv_path or None on failure, rows_deleted).
    """
    csv_path = os.path.join("data", "archive", f"raw_nhl_data_archive_{timestamp_str}.csv")
    ensure_directory(csv_path)

    print(f"Archiving eligible raw_nhl_data rows to {csv_path} ...")
    with conn.cursor() as cur, open(csv_path, "w", encoding="utf-8", newline="") as f:
        copy_sql = """
            COPY (
                SELECT *
                FROM raw_nhl_data
                WHERE stats_extracted = TRUE
                  AND created_at < NOW() - INTERVAL '7 days'
            ) TO STDOUT WITH CSV HEADER
        """
        cur.copy_expert(copy_sql, f)

    # Verify archive candidate count vs CSV
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*)
            FROM raw_nhl_data
            WHERE stats_extracted = TRUE
              AND created_at < NOW() - INTERVAL '7 days'
            """
        )
        (db_candidate_count,) = cur.fetchone()

    csv_count = count_csv_rows(csv_path)
    print(
        "raw_nhl_data archive candidates in DB: "
        f"{db_candidate_count}, rows in CSV: {csv_count}"
    )

    if db_candidate_count != csv_count:
        print(
            "ERROR: Row count mismatch for raw_nhl_data archive "
            f"(db={db_candidate_count}, csv={csv_count}). Aborting without delete.",
            file=sys.stderr,
        )
        return None, 0

    if db_candidate_count == 0:
        print("No eligible raw_nhl_data rows to archive/purge.")
        return csv_path, 0

    print("Deleting archived raw_nhl_data rows ...")
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM raw_nhl_data
            WHERE stats_extracted = TRUE
              AND created_at < NOW() - INTERVAL '7 days'
            """
        )
        # Optionally confirm deleted count with RETURNING; but db_candidate_count
        # already represents what we intend to delete.

    return csv_path, db_candidate_count


def run_vacuum_analyze(conn: PGConnection) -> None:
    """Run VACUUM ANALYZE on the main tables after cleanup."""
    print("Running VACUUM ANALYZE on key tables ...")
    with conn.cursor() as cur:
        cur.execute("VACUUM ANALYZE player_projected_stats;")
        cur.execute("VACUUM ANALYZE player_game_stats;")
        cur.execute("VACUUM ANALYZE raw_nhl_data;")


def check_player_projected_stats(conn: PGConnection) -> bool:
    """Confirm that player_projected_stats is still queryable."""
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM player_projected_stats LIMIT 1;")
            cur.fetchone()
        return True
    except Exception as exc:  # pylint: disable=broad-except
        print(
            f"WARNING: Unable to query player_projected_stats: {exc}",
            file=sys.stderr,
        )
        return False


def main() -> None:
    timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    conn: Optional[PGConnection] = None
    archived_files: List[str] = []
    total_archived_rows = 0
    raw_shots_truncated = False
    raw_nhl_rows_deleted = 0
    vacuums_ran = False
    projected_stats_ok = False

    try:
        conn = get_connection()
        # Start in transactional mode for destructive operations.
        conn.autocommit = False

        # 1. Archive raw_shots and, if verified, truncate.
        raw_shots_csv, raw_shots_rows = archive_raw_shots(conn, timestamp_str)
        if raw_shots_csv is None:
            # Mismatch; do not proceed to truncation or any destructive actions.
            conn.rollback()
            raise RuntimeError("Aborting due to raw_shots archive verification failure.")

        archived_files.append(raw_shots_csv)
        total_archived_rows += raw_shots_rows

        truncate_raw_shots(conn)
        raw_shots_truncated = True
        conn.commit()

        # 2. Archive and purge raw_nhl_data.
        raw_nhl_csv, raw_nhl_deleted = archive_and_purge_raw_nhl_data(conn, timestamp_str)
        if raw_nhl_csv is None:
            # Archive verification failed; rollback any changes from this phase.
            conn.rollback()
            raise RuntimeError("Aborting due to raw_nhl_data archive verification failure.")

        if raw_nhl_deleted > 0:
            raw_nhl_rows_deleted = raw_nhl_deleted
            total_archived_rows += raw_nhl_deleted
            archived_files.append(raw_nhl_csv)
            conn.commit()
        else:
            # No eligible rows; nothing to commit for this phase.
            conn.rollback()

        # 3. Run VACUUM ANALYZE outside explicit transaction.
        conn.autocommit = True
        run_vacuum_analyze(conn)
        vacuums_ran = True

        # 4. Confirm player_projected_stats is queryable.
        projected_stats_ok = check_player_projected_stats(conn)

    except Exception as exc:  # pylint: disable=broad-except
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                # Best-effort rollback; connection may already be closed/broken.
                pass
        print(f"FATAL: Archive & cleanup failed: {exc}", file=sys.stderr)
        sys.exit(1)
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass

    # Compute approximate disk space represented by the archived CSVs.
    total_bytes = 0
    for path in archived_files:
        try:
            total_bytes += os.path.getsize(path)
        except OSError:
            # If a file is missing or unreadable, skip it but continue reporting.
            pass

    print("\n=== Archive & Cleanup Summary ===")
    print(f"Total rows archived to CSV: {total_archived_rows}")
    print(f"Approximate size of archive CSVs: {human_readable_bytes(total_bytes)}")
    print(f"raw_shots truncated: {'yes' if raw_shots_truncated else 'no'}")
    print(f"raw_nhl_data rows deleted: {raw_nhl_rows_deleted}")
    print(f"VACUUM ANALYZE completed: {'yes' if vacuums_ran else 'no'}")
    print(
        "player_projected_stats intact and queryable: "
        f"{'yes' if projected_stats_ok else 'no'}"
    )


if __name__ == "__main__":
    main()


