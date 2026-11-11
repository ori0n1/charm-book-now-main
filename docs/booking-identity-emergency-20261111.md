# Public booking identity incident — 2026-11-11

Production project: `pwmdzpvnatrvfpgcvnzg`. Active Worker at diagnosis:
`tanstack-start-app` version `3fb84c5a-eb2d-45ee-b6f6-265fcd79bf4e`.

The live booking error was `client_identity_review_required` at the email
collision guard in `resolve_booking_client_identity`. A uniquely matched phone
row can belong to the authenticated client, yet a second client row with the
same email caused the guard to reject the booking before any appointment was
created. The authenticated public account showed the same phone, email and
historical reservations; no customer data was read through a privileged SQL
connection.

SQL Editor changes applied manually in production, in order:

1. `20261111170000_public_booking_identity_error_context.sql`: diagnostic
   exception context in the verified wrapper.
2. `20261111171500_public_booking_identity_guard_detail.sql`: diagnostic
   booleans on the existing identity guard; no decision changed.
3. `20261111173000_public_booking_preserve_guard_detail.sql`: preserve inner
   detail in the verified wrapper; no decision changed.
4. `20261111174500_allow_verified_owner_duplicate_email_booking.sql`: skip only
   the duplicate-email check when the unique phone row is linked to the
   verified caller and already carries the same email. The guard remains for
   unlinked or differently owned rows. Owner approval was received for this
   exact production migration.

Before the final migration, the helper definition MD5 was
`fde4dcf63c974b0bb54dfb56bbcadd18`; afterward it was
`91a610f0607173c57b3c7a864df374fb`. SQL Editor returned success, and a
read-only check under role `authenticated` confirmed the new clause and that
`anon`/`authenticated` still cannot invoke the helper or verified wrapper
directly. Diagnostic reads in the SQL Editor used non-BYPASSRLS
`authenticated` in read-only transactions.

The rollback for the decision change is
`supabase/rollback/20261111174500_allow_verified_owner_duplicate_email_booking.sql`.
It restores the old guard, but would reintroduce this booking failure. Execute
only with separate owner approval and after checking bookings made since the
change. No production booking or customer row was created by the agent.

Docker `postgres:16` synthetic checks passed for the verified owner, a
different authenticated user, an unlinked row and a missing verified user.
After the migration, the owner confirmed a real booking for 2026-11-12 at
09:00. The public account displayed `MARCAÇÃO CONFIRMADA` for the intended
studio, service and professional. No additional booking was created for tests.

These files were applied manually rather than through migration history.
Reconcile the Supabase migration ledger before any later automated migration
push. No Worker deployment or binding change was made in this correction.
