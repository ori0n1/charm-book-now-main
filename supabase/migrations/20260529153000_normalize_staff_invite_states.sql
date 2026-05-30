-- Normalize existing team invites for the token-per-invite flow.
-- Active accounts must not keep reusable invite links.
UPDATE public.staff
SET
  invite_token = NULL,
  invite_code = NULL,
  invite_expires_at = NULL,
  invite_status = 'active',
  updated_at = NOW()
WHERE user_id IS NOT NULL
  AND COALESCE(invite_status, '') <> 'active';

-- Pending invitations past their date should be shown as expired until regenerated.
UPDATE public.staff
SET
  invite_status = 'expired',
  updated_at = NOW()
WHERE user_id IS NULL
  AND invite_expires_at IS NOT NULL
  AND invite_expires_at < NOW()
  AND COALESCE(invite_status, '') NOT IN ('cancelled', 'expired');
