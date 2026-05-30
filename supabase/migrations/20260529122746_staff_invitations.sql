-- Alter staff table to support link/WhatsApp based team invitation flow
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS whatsapp TEXT,
  ADD COLUMN IF NOT EXISTS invite_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS invite_role TEXT,
  ADD COLUMN IF NOT EXISTS invite_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invite_code TEXT;

-- Index to quickly look up invitations by token
CREATE INDEX IF NOT EXISTS idx_staff_invite_token ON public.staff(invite_token);
