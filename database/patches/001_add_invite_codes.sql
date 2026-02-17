-- =====================================================
-- PATCH 001: Add Organization Invite Codes
-- =====================================================
-- Run this in the Supabase SQL Editor to add invite
-- code support to an existing database.
-- Safe to run on an existing DB — uses IF NOT EXISTS
-- and CREATE OR REPLACE where possible.
-- =====================================================

-- =====================================================
-- 1. CREATE TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS org_invite_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    created_by UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    max_uses INTEGER DEFAULT NULL,       -- NULL = unlimited
    use_count INTEGER DEFAULT 0,
    expires_at TIMESTAMPTZ DEFAULT NULL,  -- NULL = never expires
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. ENABLE RLS
-- =====================================================

ALTER TABLE org_invite_codes ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 3. RLS POLICIES
-- =====================================================

CREATE POLICY "Admins/managers can view invite codes for their org"
ON org_invite_codes FOR SELECT
USING (
    org_id = get_current_user_org_id()
    AND get_current_user_role() IN ('admin', 'manager')
);

CREATE POLICY "Admins/managers can create invite codes"
ON org_invite_codes FOR INSERT
WITH CHECK (
    org_id = get_current_user_org_id()
    AND get_current_user_role() IN ('admin', 'manager')
);

CREATE POLICY "Admins/managers can update invite codes for their org"
ON org_invite_codes FOR UPDATE
USING (
    org_id = get_current_user_org_id()
    AND get_current_user_role() IN ('admin', 'manager')
);

CREATE POLICY "Admins/managers can delete invite codes for their org"
ON org_invite_codes FOR DELETE
USING (
    org_id = get_current_user_org_id()
    AND get_current_user_role() IN ('admin', 'manager')
);

-- =====================================================
-- 4. INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_org_invite_codes_org_id ON org_invite_codes(org_id);
CREATE INDEX IF NOT EXISTS idx_org_invite_codes_code ON org_invite_codes(code);
CREATE INDEX IF NOT EXISTS idx_org_invite_codes_active ON org_invite_codes(is_active);

-- =====================================================
-- 5. TIMESTAMP TRIGGER
-- =====================================================

CREATE TRIGGER set_timestamp_org_invite_codes
BEFORE UPDATE ON org_invite_codes
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- =====================================================
-- 6. FUNCTIONS
-- =====================================================

-- Generate a random invite code (format: XXXX-XXXX-XXXX)
-- Uses only unambiguous characters (no I/O/0/1)
CREATE OR REPLACE FUNCTION generate_invite_code()
RETURNS TEXT AS $$
DECLARE
    chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    code TEXT := '';
    i INTEGER;
BEGIN
    FOR i IN 1..12 LOOP
        code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
        IF i IN (4, 8) THEN
            code := code || '-';
        END IF;
    END LOOP;
    RETURN code;
END;
$$ LANGUAGE plpgsql;

-- Create an invite code for the current user's organization
CREATE OR REPLACE FUNCTION create_invite_code(
    p_max_uses INTEGER DEFAULT NULL,
    p_expires_in_days INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    code TEXT,
    org_id UUID,
    max_uses INTEGER,
    expires_at TIMESTAMPTZ
) AS $$
DECLARE
    v_code TEXT;
    v_org_id UUID;
    v_expires_at TIMESTAMPTZ;
    v_id UUID;
BEGIN
    -- Check permissions
    IF NOT is_user_admin_or_manager() THEN
        RAISE EXCEPTION 'Only admins and managers can create invite codes';
    END IF;

    v_org_id := get_current_user_org_id();
    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'You must be in an organization to create invite codes';
    END IF;

    -- Calculate expiry
    IF p_expires_in_days IS NOT NULL THEN
        v_expires_at := NOW() + (p_expires_in_days || ' days')::INTERVAL;
    END IF;

    -- Generate a unique code (retry on collision)
    LOOP
        v_code := generate_invite_code();
        BEGIN
            INSERT INTO org_invite_codes (org_id, code, created_by, max_uses, expires_at)
            VALUES (v_org_id, v_code, auth.uid(), p_max_uses, v_expires_at)
            RETURNING org_invite_codes.id INTO v_id;
            EXIT; -- Success
        EXCEPTION WHEN unique_violation THEN
            CONTINUE; -- Code collision, retry
        END;
    END LOOP;

    RETURN QUERY SELECT v_id, v_code, v_org_id, p_max_uses, v_expires_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Join an organization using an invite code
CREATE OR REPLACE FUNCTION join_organization_with_code(p_code TEXT)
RETURNS TABLE (
    org_id UUID,
    org_name TEXT
) AS $$
DECLARE
    v_invite RECORD;
    v_user_id UUID;
    v_current_org UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Look up the invite code
    SELECT ic.* INTO v_invite
    FROM org_invite_codes ic
    WHERE ic.code = upper(trim(p_code))
    AND ic.is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid or inactive invite code';
    END IF;

    -- Check expiry
    IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < NOW() THEN
        RAISE EXCEPTION 'This invite code has expired';
    END IF;

    -- Check max uses
    IF v_invite.max_uses IS NOT NULL AND v_invite.use_count >= v_invite.max_uses THEN
        RAISE EXCEPTION 'This invite code has reached its maximum number of uses';
    END IF;

    -- Check if user is already in this org
    SELECT up.org_id INTO v_current_org
    FROM user_profiles up
    WHERE up.id = v_user_id;

    IF v_current_org = v_invite.org_id THEN
        RAISE EXCEPTION 'You are already a member of this organization';
    END IF;

    -- Join the organization
    UPDATE user_profiles
    SET org_id = v_invite.org_id,
        role = 'employee'
    WHERE id = v_user_id;

    -- Increment use count
    UPDATE org_invite_codes
    SET use_count = use_count + 1
    WHERE id = v_invite.id;

    -- Return org info
    RETURN QUERY
    SELECT o.id, o.name
    FROM organizations o
    WHERE o.id = v_invite.org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revoke an invite code
CREATE OR REPLACE FUNCTION revoke_invite_code(p_code_id UUID)
RETURNS VOID AS $$
BEGIN
    IF NOT is_user_admin_or_manager() THEN
        RAISE EXCEPTION 'Only admins and managers can revoke invite codes';
    END IF;

    UPDATE org_invite_codes
    SET is_active = false
    WHERE id = p_code_id
    AND org_id = get_current_user_org_id();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invite code not found or you do not have permission';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- DONE! Invite codes are now available.
-- =====================================================
