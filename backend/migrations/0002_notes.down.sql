-- Reverts 0002_notes.sql.
DROP FUNCTION IF EXISTS app.api_notes_delete(UUID);
DROP FUNCTION IF EXISTS app.api_notes_update(UUID, JSONB);
DROP FUNCTION IF EXISTS app.api_notes_create(JSONB);
DROP FUNCTION IF EXISTS app.api_notes_get(UUID);
DROP FUNCTION IF EXISTS app.api_notes_list(TEXT, INT, INT);
DROP FUNCTION IF EXISTS app.note_json(app.notes);
DROP TABLE IF EXISTS app.notes;
