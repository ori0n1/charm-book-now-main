-- Keep extension-owned objects outside the API-facing public schema. Existing
-- exclusion constraints depend on extension object OIDs, so moving the
-- extension preserves them without rebuilding tenant data or indexes.

CREATE SCHEMA IF NOT EXISTS extensions;

DO $migration$
DECLARE
  current_schema text;
BEGIN
  SELECT extension_schema.nspname
  INTO current_schema
  FROM pg_extension AS extension_row
  JOIN pg_namespace AS extension_schema
    ON extension_schema.oid = extension_row.extnamespace
  WHERE extension_row.extname = 'btree_gist';

  IF current_schema IS NULL THEN
    RAISE EXCEPTION 'required_extension_missing: btree_gist';
  END IF;

  IF current_schema <> 'extensions' THEN
    ALTER EXTENSION btree_gist SET SCHEMA extensions;
  END IF;
END
$migration$;
