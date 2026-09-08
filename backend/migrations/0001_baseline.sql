-- 0001 — baseline: the app schema and the infrastructure tables every
-- deployment needs before any feature exists.
--
-- Conventions this lineage follows (see docs/ARCHITECTURE.md):
--   * Migrations are the ONLY schema channel. Add new numbered files; never
--     edit one that has been applied anywhere.
--   * Business logic lives in app.api_* SQL functions returning JSONB shaped
--     as the contract's camelCase — routes stay thin (src/db/pool.ts callApi).
--   * Every migration has a paired .down.sql.

CREATE SCHEMA IF NOT EXISTS app;

SET search_path = app, public;

-- ============================================================================
-- 1. CONFIG (config-not-code: operational dials live in rows, not images)
-- ============================================================================
CREATE TABLE app.config (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The console's change log. APPEND-ONLY, ENFORCED HERE rather than promised
-- by callers: an audit trail whose rows can be edited is a diary, not a
-- record. from/to are audit-readable phrases, not machine state.
CREATE TABLE app.config_audit (
    audit_id   BIGSERIAL PRIMARY KEY,
    setting    TEXT NOT NULL,
    from_value TEXT,
    to_value   TEXT,
    changed_by TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION app.config_audit_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'app.config_audit is append-only';
END;
$$;

CREATE TRIGGER trg_config_audit_immutable
    BEFORE UPDATE OR DELETE ON app.config_audit
    FOR EACH ROW EXECUTE FUNCTION app.config_audit_immutable();

-- ============================================================================
-- 2. IDEMPOTENCY (durable fallback when Redis is off — middleware/idempotency)
-- ============================================================================
CREATE TABLE app.action_idempotency (
    action_uuid TEXT PRIMARY KEY,
    subject     TEXT,
    actor       TEXT NOT NULL,
    action      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 3. MFA / WebAuthn store (src/mfa/store.ts)
--
-- Three tables instead of three in-memory Maps, so any instance answers
-- correctly and a redeploy does not erase enrolled passkeys. TTL semantics
-- live in the rows (expires_at); single-use guarantees are
-- DELETE ... RETURNING atomicity. Credential ids and challenges are base64url
-- strings exactly as @simplewebauthn speaks them; the COSE key is raw bytes.
-- ============================================================================
CREATE TABLE app.mfa_credentials (
    credential_id TEXT PRIMARY KEY,
    username      TEXT NOT NULL,
    public_key    BYTEA NOT NULL,
    counter       BIGINT NOT NULL DEFAULT 0,
    device_type   TEXT,
    backed_up     BOOLEAN,
    transports    TEXT[],
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mfa_credentials_username ON app.mfa_credentials (username);

-- One-time login tokens (the desktop's pending sign-in approvals). Three-
-- minute lifetime, enforced in every read (expires_at > now()); expired rows
-- are swept opportunistically on each token mint.
CREATE TABLE app.mfa_login_tokens (
    token      TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified')),
    challenge  TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_mfa_login_tokens_expires ON app.mfa_login_tokens (expires_at);

-- Enrolment ceremony challenges, one in flight per username.
CREATE TABLE app.mfa_registration_challenges (
    username   TEXT PRIMARY KEY,
    challenge  TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- ============================================================================
-- 4. PASSWORD INVITATIONS (src/services/passwordInvitations.ts)
--
-- Accounts are provisioned with no password; a single-use link, mailed to the
-- address on the account, is the only way to set one. THE TOKEN NEVER LANDS
-- HERE — only its SHA-256, so a database copy cannot be turned into working
-- links. Single use is the primary key's job: the claim is one atomic UPDATE
-- (used_at IS NULL AND expires_at > now() ... RETURNING), so two browsers
-- racing cannot both win. No FK to a user — the user lives in Keycloak;
-- kc_user_id is the realm's uuid and this database cannot police it.
-- ============================================================================
CREATE TABLE app.password_invitations (
    token_hash  TEXT PRIMARY KEY,
    kc_user_id  TEXT NOT NULL,
    username    TEXT NOT NULL,
    email       TEXT NOT NULL,
    -- 'provision' = a new account that has never had a password.
    -- 'reset'     = an existing account whose holder has lost theirs.
    -- The distinction is the EMAIL's wording, not the mechanism.
    purpose     TEXT NOT NULL DEFAULT 'provision'
                CHECK (purpose IN ('provision', 'reset')),
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    -- Whether the relay ACCEPTED the message. False with a row present is a
    -- real and useful state: the invitation exists and can be resent without
    -- minting a second one.
    mailed      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_password_invitations_user
    ON app.password_invitations (kc_user_id, created_at DESC);
CREATE INDEX idx_password_invitations_expires
    ON app.password_invitations (expires_at);

-- One row per account — the most recent invitation, whatever became of it —
-- with the usable-state verdict derived HERE so the browser cannot disagree
-- with the server about whether a link still works.
CREATE OR REPLACE FUNCTION app.api_password_invitations()
RETURNS JSONB LANGUAGE sql AS $$
    SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
    FROM (
        SELECT DISTINCT ON (kc_user_id) jsonb_build_object(
            'kcUserId',  kc_user_id,
            'username',  username,
            'email',     email,
            'purpose',   purpose,
            'createdBy', created_by,
            'createdAt', created_at,
            'expiresAt', expires_at,
            'usedAt',    used_at,
            'mailed',    mailed,
            'state',     CASE
                             WHEN used_at IS NOT NULL      THEN 'set'
                             WHEN expires_at <= now()      THEN 'expired'
                             WHEN NOT mailed               THEN 'not_sent'
                             ELSE                               'invited'
                         END
        ) AS row
        FROM app.password_invitations
        ORDER BY kc_user_id, created_at DESC
    ) latest;
$$;

COMMENT ON TABLE app.password_invitations IS
    'Single-use set-password links. Stores the token hash only; the token exists in the email.';
