-- SprintCRM v2 hardening patch (idempotent)
-- Applies safety fixes on top of base org-ready schema.
-- 1) org-scoped dedup uniqueness
-- 2) FK integrity for owner/created_by columns
-- 3) activities.org_id consistency with leads.org_id
-- 4) centralized next-step helper for stage templates at 09:00 local

-- 1) Replace global dedup unique indexes with org-scoped unique indexes
DROP INDEX IF EXISTS public.uidx_leads_email_norm;
DROP INDEX IF EXISTS public.uidx_leads_domain_norm;
DROP INDEX IF EXISTS public.uidx_leads_phone_norm;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_leads_org_email_norm
  ON public.leads(org_id, email_norm)
  WHERE email_norm IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_leads_org_domain_norm
  ON public.leads(org_id, website_domain_norm)
  WHERE website_domain_norm IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_leads_org_phone_norm
  ON public.leads(org_id, phone_norm)
  WHERE phone_norm IS NOT NULL;

-- Helpful composite index for Today queue
CREATE INDEX IF NOT EXISTS idx_leads_org_status_next_action_at
  ON public.leads(org_id, status, next_action_at);

-- 2) Add missing FK constraints for owner/created_by references
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leads_owner_fkey'
      AND conrelid = 'public.leads'::regclass
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_owner_fkey
      FOREIGN KEY (owner) REFERENCES auth.users(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leads_created_by_fkey'
      AND conrelid = 'public.leads'::regclass
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'activities_owner_fkey'
      AND conrelid = 'public.activities'::regclass
  ) THEN
    ALTER TABLE public.activities
      ADD CONSTRAINT activities_owner_fkey
      FOREIGN KEY (owner) REFERENCES auth.users(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'imports_owner_fkey'
      AND conrelid = 'public.imports'::regclass
  ) THEN
    ALTER TABLE public.imports
      ADD CONSTRAINT imports_owner_fkey
      FOREIGN KEY (owner) REFERENCES auth.users(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- 3) Keep activities.org_id consistent with parent lead org_id
CREATE OR REPLACE FUNCTION public.sync_activity_org_id_from_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_org_id uuid;
BEGIN
  SELECT l.org_id INTO v_lead_org_id
  FROM public.leads l
  WHERE l.id = NEW.lead_id;

  IF v_lead_org_id IS NULL THEN
    RAISE EXCEPTION 'Lead % not found for activity', NEW.lead_id;
  END IF;

  NEW.org_id := v_lead_org_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activities_sync_org ON public.activities;
CREATE TRIGGER trg_activities_sync_org
BEFORE INSERT OR UPDATE ON public.activities
FOR EACH ROW
EXECUTE FUNCTION public.sync_activity_org_id_from_lead();

-- 4) Centralized next-step helper: stage -> action/date at 09:00 local time
CREATE OR REPLACE FUNCTION public.default_next_step_for_stage(
  p_stage public.lead_stage,
  p_base_at timestamptz DEFAULT now(),
  p_tz text DEFAULT 'UTC'
)
RETURNS TABLE(next_action public.next_action, next_action_at timestamptz)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_days integer;
  v_action public.next_action;
  v_local_base timestamp;
  v_local_target timestamp;
BEGIN
  CASE p_stage
    WHEN 'contacted' THEN
      v_action := 'follow_up';
      v_days := 3;
    WHEN 'replied' THEN
      v_action := 'send_proposal';
      v_days := 2;
    WHEN 'proposal' THEN
      v_action := 'follow_up';
      v_days := 2;
    ELSE
      v_action := 'follow_up';
      v_days := 3;
  END CASE;

  v_local_base := timezone(p_tz, p_base_at);
  v_local_target := date_trunc('day', v_local_base) + make_interval(days => v_days, hours => 9);

  RETURN QUERY
  SELECT v_action, (v_local_target AT TIME ZONE p_tz);
END;
$$;

