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

## Authenticated contact collisions — prepared candidate

The later request covers authenticated customers whose submitted phone or
email also appears in another client row. The proposed migration
`20261111190000_authenticated_booking_owned_client_resolution.sql` was applied
to production in the Supabase SQL Editor on 2026-11-11 after the owner
authorized publication conditioned on preserving the working reservation.
It checks the five active function hashes before
changing anything, resolves bookings by the verified Auth ID, and leaves the
unverified booking guard intact. A shared phone uses an account-owned marker
with no digits. The verified account email is used only when confirmed; form
email is not trusted for notifications.

For online payment, the wrapper first creates or reuses that account-owned
client row and writes its exact phone marker into the pending request. The
existing `confirm_paid_booking_request` routine selects clients by exact
`(studio_id, phone)` at conversion, so the paid appointment remains linked to
the authenticated account. The marker prevents WhatsApp from using a shared
booking-contact number. The first UI candidate also hid MB Way, but the owner
clarified that the customer must be free to choose any MB Way payment number.
The corrected, unpublished Worker candidate keeps MB Way available whenever
the studio offers it. Stripe Checkout collects that payment number separately;
the payment metadata keeps the account-owned booking marker for ownership
verification. The webhook compares distinct markers exactly rather than
reducing both to an empty string of digits. No payment number becomes a
booking contact or WhatsApp destination.

When a customer already has a normal account row, adding a safe marker row
must not make profile editing fail. The migration keeps the normal row as the
profile target only when it is the sole active non-marker row and all other
rows are digit-free account markers. A submitted phone owned by another row
still returns manual review. The dynamic SQL anchors normalize LF/CRLF to
match the production function text; rollback removes both added profile
blocks while preserving existing client and appointment data.
The identity result keeps `was_existing = true` when the verified account
already has another client row, so using a shared phone does not make an
existing customer eligible for new-customer referral treatment.

Production function definitions were read in SQL Editor with `BEGIN READ
ONLY`, `SET LOCAL ROLE authenticated` and `ROLLBACK`; the effective role was
neither superuser nor BYPASSRLS. Cloudflare OAuth confirmed the active Worker
is still `3fb84c5a-eb2d-45ee-b6f6-265fcd79bf4e`, with 53 bindings (24
secret names), two crons, both production domains and unchanged runtime. The
source difference from the proven Worker base is confined to three booking UI
files; Worker configuration and other source modules are unchanged.

The synthetic PostgreSQL test passed owner, other-account phone, duplicate
email, unconfirmed email, old numeric marker, individual and joint pending
requests, paid conversion ownership, and preserved unverified/grant guards.
The rollback script restored the synthetic helper and profile definitions by
hash, including a CRLF text reversal simulation. Typecheck and bundle build
passed. The local responsive preview could not start because the Windows
`workerd` process terminated. The UI Worker candidate was **not** published;
no real customer booking was created for testing.

The SQL Editor reported `Success. No rows returned` for the approved migration
whose file SHA-256 was
`96841e2877b5359cbdee1667a32602668f24a2023dda1bf1369a45c12a4c5666`.
Read-only verification under role `authenticated` (non-superuser,
non-BYPASSRLS) found the helper definition hash
`169de6469a5699262ca5ef92df945e37`, the profile resolver hash
`a3e311cfa22d834b097944f70d44a53e`, and the two wrapper hashes
`541f808359f78020eb71b123c4c4cb5a` and
`9f1f15d868498b8fdf90070d7f44b359`. The paid-conversion routine remained
`bfe13ebf06626ce840834f90345209fe`. Anon and authenticated roles still
lack execute on the protected helper and wrappers; service_role retained
execute on both wrappers. The original individual booking function remained
`733296c0b6027bc73c95d0a41f41276e`. A GET of the public booking page
returned HTTP 200. No new booking was made in the smoke test.
This second migration was also applied manually; its presence in the
Supabase migration ledger was not verified under the authorized read role.

Rollback file: `supabase/rollback/20261111190000_authenticated_booking_owned_client_resolution.sql`.
It preserves existing bookings and client rows, but restoring the old guard
would reintroduce shared-contact booking failures. Apply only after separate
owner approval and review of the effective production state.

## MB Way checkout correction — unpublished

The owner clarified that the MB Way payment number must be chosen at payment
time and may differ from the booking contact number. Stripe's hosted MB Way
checkout collects that number directly. The Worker correction removes the
pre-check requiring the account's booking phone to be a Portuguese mobile,
keeps MB Way available for shared-contact accounts when the studio supports
it, and uses the account-owned booking marker in payment metadata. The Stripe
webhook now compares markers exactly; a marker cannot match another marker
merely because both have no digits. The booking contact is still excluded from
WhatsApp when shared. The SQL migration already applied to production is not
changed by this Worker correction.

The focused marker comparison tests and TypeScript typecheck passed. The
production build passed its 17 feature contract tests and compiled the browser
and Worker bundles from a Git archive of commit `ed3685d` in a short local
path. The long worktree path failed during esbuild startup; the first short
build failed on a local directory permission, and the short build with normal
Windows permissions completed. The upload dry run passed. Its `index.js`
hash matched the compiled entrypoint; the 465-file artifact tree SHA-256 is
`e85dafc098e9f8614457e0642bcd9520204644c1689ced715fed57612b0e7116`.
Cloudflare OAuth still showed active version
`3fb84c5a-eb2d-45ee-b6f6-265fcd79bf4e`, 53 bindings including 24 secret
names, two crons, both domains and the existing runtime. The generated upload
config hash remained `cc8af1ea8e4ca14d9e44f27d8cdb0c8d037ed21cae85aa84086c65c7b4b42634`.

A local rebuild of the proven production source commit `de3bb4a` produced 465
files in a different path. All 75 non-JavaScript files matched the candidate;
117 files had the same path and hash. The rebuilt baseline tree hash differed
from its historical published artifact hash, and the manifest embeds the local
absolute build path. JavaScript chunk filenames also change transitively when
shared imports change. Source comparison to `de3bb4a` shows changes only in
the booking UI, booking result type, payment intent, webhook and a new focused
phone comparator. Therefore byte-for-byte artifact parity to the active
version is not claimed. A 0%-traffic candidate and remote smoke are still
needed before considering customer traffic. No payment was attempted and no
Worker version was uploaded or activated.
