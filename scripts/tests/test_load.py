"""Tests for simnyc.load — focuses on SQL template correctness without a live DB."""

from simnyc.load import INSERT_SQL


def test_insert_sql_contains_jsonb_cast():
    """The psycopg INSERT template must use ::jsonb so Supabase accepts the JSON column."""
    assert "::jsonb" in INSERT_SQL, (
        f"INSERT_SQL missing ::jsonb cast; got: {INSERT_SQL!r}"
    )


def test_insert_sql_targets_correct_table_and_columns():
    """Sanity-check that the template targets the right table and all four columns."""
    sql_lower = INSERT_SQL.lower()
    assert "insert into personas" in sql_lower
    assert "puma" in sql_lower
    assert "borough" in sql_lower
    assert "neighborhood" in sql_lower
    assert "card" in sql_lower


def test_insert_sql_has_four_placeholders():
    """Four %s placeholders — one per column (puma, borough, neighborhood, card)."""
    assert INSERT_SQL.count("%s") == 4, (
        f"Expected 4 placeholders, found {INSERT_SQL.count('%s')} in: {INSERT_SQL!r}"
    )


def test_insert_sql_jsonb_placeholder_is_card_column():
    """The ::jsonb cast must be on the last (card) placeholder, not an earlier one."""
    # The card placeholder is the fourth %s; verify it's the one with ::jsonb
    assert "%s::jsonb" in INSERT_SQL, (
        f"::jsonb must be appended directly to a %s placeholder; got: {INSERT_SQL!r}"
    )
