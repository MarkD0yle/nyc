import argparse
import json
import os
import sys

from dotenv import load_dotenv

from .config import OUT_DIR, SCRIPTS_DIR

BATCH = 500


def emit_sql() -> None:
    """Generate SQL insert statements without connecting to database."""
    cards = [json.loads(line) for line in open(OUT_DIR / "personas.jsonl")]

    output_path = OUT_DIR / "personas_insert.sql"
    with open(output_path, "w") as f:
        # Write truncate statement
        f.write("truncate table personas;\n")

        # Write batched insert statements
        for i in range(0, len(cards), BATCH):
            batch = cards[i : i + BATCH]

            # Build VALUES clause with properly escaped JSON
            values = []
            for c in batch:
                puma = c["puma"]
                borough = c["borough"]
                neighborhood = c["neighborhood"]
                card_json = json.dumps(c, ensure_ascii=False)
                # Escape single quotes by doubling them
                card_json_escaped = card_json.replace("'", "''")
                values.append(
                    f"('{puma}', '{borough}', '{neighborhood}', '{card_json_escaped}'::jsonb)"
                )

            values_str = ", ".join(values)
            f.write(
                f"insert into personas (puma, borough, neighborhood, card) values {values_str};\n"
            )

    print(f"wrote {output_path} with {len(cards)} rows")


def connect_and_load() -> None:
    """Connect to database and load personas."""
    try:
        import psycopg
    except ImportError:
        print("Error: psycopg not installed. Use --emit-sql instead.", file=sys.stderr)
        sys.exit(1)

    load_dotenv(SCRIPTS_DIR / ".env")
    dsn = os.environ.get("SUPABASE_DB_URL")
    if not dsn:
        print(
            "Error: SUPABASE_DB_URL not set in .env. Use --emit-sql instead.",
            file=sys.stderr,
        )
        sys.exit(1)

    cards = [json.loads(line) for line in open(OUT_DIR / "personas.jsonl")]
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("truncate table personas")
        for i in range(0, len(cards), BATCH):
            batch = cards[i : i + BATCH]
            cur.executemany(
                "insert into personas (puma, borough, neighborhood, card) values (%s, %s, %s, %s)",
                [(c["puma"], c["borough"], c["neighborhood"], json.dumps(c)) for c in batch],
            )
        cur.execute("select count(*), count(distinct borough) from personas")
        n, b = cur.fetchone()
    print(f"loaded {n} personas across {b} boroughs")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--emit-sql",
        action="store_true",
        help="Generate SQL file instead of connecting to database",
    )
    args = parser.parse_args()

    if args.emit_sql:
        emit_sql()
    else:
        connect_and_load()


if __name__ == "__main__":
    main()
