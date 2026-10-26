-- 0002 — the NOTES example: one entity wired through every convention.
--
-- THIS IS THE TEACHING MIGRATION. Delete it (apply 0002_notes.down.sql, or
-- start your fork from 0001) or rename everything to your first real entity.
-- The pattern it demonstrates:
--
--   * The migration owns the SCHEMA and its INTEGRITY: the table, the
--     constraints that hold whatever any code does, the indexes, the audit
--     stamp. Nothing here shapes the API's JSON or decides a business rule.
--   * The rules live in TypeScript (src/domain/notes.ts), the SQL in
--     src/repositories/notes.repository.ts, the JSON in
--     src/presenters/note.presenter.ts; src/services/notes.ts runs each
--     use-case in one transaction, and src/controllers/notes.controller.ts
--     is the thin HTTP adapter.
--   * created_by / updated_by are stamped by app.fn_stamp_audit_fields
--     (0001) from the per-transaction `app.actor` the service publishes —
--     no repository passes an actor.
--   * After changing this file's lineage: `npm run db:types` regenerates
--     src/db/schema.generated.ts, in the same commit.

SET search_path = app, public;

CREATE TABLE app.notes (
    note_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The domain refuses a blank title first, with its own sentence; the
    -- CHECK is the floor that holds for every other writer.
    title      TEXT NOT NULL CHECK (length(trim(title)) > 0),
    body       TEXT NOT NULL DEFAULT '',
    tags       TEXT[] NOT NULL DEFAULT '{}',
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT,
    updated_at TIMESTAMPTZ
);

CREATE INDEX idx_notes_created ON app.notes (created_at DESC);

CREATE TRIGGER trg_notes_audit_stamp
    BEFORE INSERT OR UPDATE ON app.notes
    FOR EACH ROW EXECUTE FUNCTION app.fn_stamp_audit_fields();
