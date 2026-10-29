-- The authenticated role has column-level SELECT grants on clients.
-- The new list filter must be readable without broadening table privileges.
GRANT SELECT (archived_at) ON TABLE public.clients TO authenticated;
