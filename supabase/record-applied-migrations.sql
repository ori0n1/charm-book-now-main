INSERT INTO supabase_migrations.schema_migrations(version, name)
VALUES
  ('20261028130000', 'loyalty_management_roles'),
  ('20261028143000', 'loyalty_manual_management')
ON CONFLICT (version) DO NOTHING;
