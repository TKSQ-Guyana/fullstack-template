-- 0002 — the NOTES example: one entity wired through every convention.
--
-- THIS IS THE TEACHING MIGRATION. Delete it (apply 0002_notes.down.sql, or
-- start your fork from 0001) or rename everything to your first real entity.
-- The pattern it demonstrates:
--
--   * The table owns its data; the api_* functions own the CONTRACT — they
--     return JSONB shaped as the API's camelCase, so routes stay thin
--     (src/services/notes.ts is a callApi() wrapper per operation).
--   * Business rules live HERE (RAISE EXCEPTION -> 422 via the error
--     handler's P0001 mapping), not in Express.
--   * Writes stamp who and when; the route passes the verified principal's
--     username as p_actor.

SET search_path = app, public;

CREATE TABLE app.notes (
    note_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title      TEXT NOT NULL CHECK (length(trim(title)) > 0),
    body       TEXT NOT NULL DEFAULT '',
    tags       TEXT[] NOT NULL DEFAULT '{}',
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT,
    updated_at TIMESTAMPTZ
);

CREATE INDEX idx_notes_created ON app.notes (created_at DESC);

-- One row -> the contract's camelCase shape, defined once and reused by
-- every function below so list and detail can never disagree.
CREATE OR REPLACE FUNCTION app.note_json(n app.notes)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object(
        'noteId',    n.note_id,
        'title',     n.title,
        'body',      n.body,
        'tags',      to_jsonb(n.tags),
        'createdBy', n.created_by,
        'createdAt', n.created_at,
        'updatedBy', n.updated_by,
        'updatedAt', n.updated_at
    );
$$;

-- List with optional search + paging. Returns {items, total} so the client
-- can page without a second count query.
CREATE OR REPLACE FUNCTION app.api_notes_list(p_q TEXT, p_limit INT, p_offset INT)
RETURNS JSONB LANGUAGE sql STABLE AS $$
    WITH filtered AS (
        SELECT n.* FROM app.notes n
        WHERE p_q IS NULL OR p_q = ''
           OR n.title ILIKE '%' || p_q || '%'
           OR n.body  ILIKE '%' || p_q || '%'
        ORDER BY n.created_at DESC
    ),
    page AS (
        SELECT * FROM filtered
        LIMIT  COALESCE(NULLIF(p_limit, 0), 50)
        OFFSET COALESCE(p_offset, 0)
    )
    SELECT jsonb_build_object(
        'items', COALESCE((SELECT jsonb_agg(app.note_json(page.*)) FROM page), '[]'::jsonb),
        'total', (SELECT count(*) FROM filtered)
    );
$$;

CREATE OR REPLACE FUNCTION app.api_notes_get(p_note_id UUID)
RETURNS JSONB LANGUAGE sql STABLE AS $$
    SELECT app.note_json(n.*) FROM app.notes n WHERE n.note_id = p_note_id;
$$;

CREATE OR REPLACE FUNCTION app.api_notes_create(p JSONB)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
    created app.notes;
BEGIN
    IF length(trim(COALESCE(p->>'title', ''))) = 0 THEN
        RAISE EXCEPTION 'A note needs a title.';
    END IF;
    INSERT INTO app.notes (title, body, tags, created_by)
    VALUES (
        trim(p->>'title'),
        COALESCE(p->>'body', ''),
        COALESCE((SELECT array_agg(t) FROM jsonb_array_elements_text(p->'tags') AS t), '{}'),
        COALESCE(p->>'actor', 'unknown')
    )
    RETURNING * INTO created;
    RETURN app.note_json(created);
END;
$$;

CREATE OR REPLACE FUNCTION app.api_notes_update(p_note_id UUID, p JSONB)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
    updated app.notes;
BEGIN
    UPDATE app.notes SET
        title      = CASE WHEN p ? 'title' THEN trim(p->>'title') ELSE title END,
        body       = CASE WHEN p ? 'body'  THEN p->>'body'        ELSE body  END,
        tags       = CASE WHEN p ? 'tags'
                          THEN COALESCE((SELECT array_agg(t)
                                           FROM jsonb_array_elements_text(p->'tags') AS t), '{}')
                          ELSE tags END,
        updated_by = COALESCE(p->>'actor', 'unknown'),
        updated_at = now()
    WHERE note_id = p_note_id
    RETURNING * INTO updated;
    IF NOT FOUND THEN
        RETURN NULL;  -- the route answers 404
    END IF;
    IF length(trim(updated.title)) = 0 THEN
        RAISE EXCEPTION 'A note needs a title.';
    END IF;
    RETURN app.note_json(updated);
END;
$$;

CREATE OR REPLACE FUNCTION app.api_notes_delete(p_note_id UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
    n INT;
BEGIN
    DELETE FROM app.notes WHERE note_id = p_note_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN jsonb_build_object('deleted', n > 0);
END;
$$;
