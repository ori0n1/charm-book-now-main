export const LEDGER_READ_ONLY_SQL = `BEGIN TRANSACTION READ ONLY;
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version;
ROLLBACK;`;

const MUTATION_KEYWORDS =
  /\b(?:insert|update|delete|merge|alter|create|drop|truncate|grant|revoke|repair|call|copy|vacuum|comment|refresh|reindex|cluster)\b/iu;

export function assertReadOnlyLedgerSql(sql = LEDGER_READ_ONLY_SQL) {
  if (MUTATION_KEYWORDS.test(sql)) throw new Error("ledger_query_contains_mutation");
  const statements = sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  if (
    statements.length !== 3 ||
    statements[0] !== "BEGIN TRANSACTION READ ONLY" ||
    !/^SELECT version, name\s+FROM supabase_migrations\.schema_migrations\s+ORDER BY version$/u.test(
      statements[1],
    ) ||
    statements[2] !== "ROLLBACK"
  ) {
    throw new Error("ledger_query_is_not_the_fixed_read_only_statement");
  }
  return sql;
}

export function buildLedgerReadOnlyInvocation(databaseUrl) {
  const sql = assertReadOnlyLedgerSql();
  return ["db", "query", "--db-url", databaseUrl, "--output", "json", "--agent=no", sql];
}

export function buildReadOnlyChildEnvironment(env = process.env) {
  const allowed = ["Path", "PATH", "PATHEXT", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP"];
  const child = Object.fromEntries(
    allowed.filter((name) => typeof env[name] === "string").map((name) => [name, env[name]]),
  );
  child.PGOPTIONS = "-c default_transaction_read_only=on";
  return child;
}
