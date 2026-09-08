// Create/edit form in a modal. Field-level 422s land on their fields (the
// ApiError carries `violations`); everything else is one readable line.
import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '@/services/apiClient'
import { createNote, updateNote, type Note } from '@/services/api/notes'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'

export function NoteFormModal({
  open,
  note,
  onClose,
  onSaved,
}: {
  open: boolean
  /** null = create; a Note = edit. */
  note: Note | null
  onClose: () => void
  onSaved: (saved: Note) => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setTitle(note?.title ?? '')
    setBody(note?.body ?? '')
    setTags(note?.tags.join(', ') ?? '')
    setError('')
    setFieldErrors({})
  }, [open, note])

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError('')
    setFieldErrors({})
    const input = {
      title: title.trim(),
      body,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    }
    try {
      const saved = note ? await updateNote(note.noteId, input) : await createNote(input)
      onSaved(saved)
    } catch (err) {
      if (err instanceof ApiError && err.violations.length) {
        setFieldErrors(Object.fromEntries(err.violations.map((v) => [v.field, v.message])))
      } else {
        setError(err instanceof Error ? err.message : 'The note could not be saved.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={note ? 'Edit note' : 'New note'} wide>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={fieldErrors.title}
          required
        />
        <Textarea
          label="Body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          error={fieldErrors.body}
        />
        <Input
          label="Tags (comma-separated)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          error={fieldErrors.tags}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : note ? 'Save changes' : 'Create note'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
