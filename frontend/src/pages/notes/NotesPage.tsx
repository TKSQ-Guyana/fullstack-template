// The example feature's screen — the pattern to copy for every list screen:
// hook -> error-or-empty-or-rows, <Can> around the writes, ConfirmDialog on
// the destructive one, toast + reload after a write.
import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useNotes } from '@/hooks/useNotes'
import { useToast } from '@/hooks/useToast'
import { deleteNote, type Note } from '@/services/api/notes'
import { Can, Cannot } from '@/authz/Can'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Table, type Column } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useAuthz } from '@/authz/AuthProvider'
import { day } from '@/utils/dates'
import { NoteFormModal } from './NoteFormModal'

export default function NotesPage() {
  const [q, setQ] = useState('')
  const { rows, total, loaded, error, reload } = useNotes(q)
  const toast = useToast()
  const { can } = useAuthz()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Note | null>(null)
  const [condemned, setCondemned] = useState<Note | null>(null)

  const columns: Column<Note>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (n) => <span className="font-medium">{n.title}</span>,
    },
    {
      key: 'tags',
      header: 'Tags',
      render: (n) => (
        <span className="flex flex-wrap gap-1">
          {n.tags.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </span>
      ),
    },
    { key: 'createdBy', header: 'Created by' },
    { key: 'createdAt', header: 'Created', render: (n) => day(n.createdAt) },
    { key: 'updatedAt', header: 'Updated', render: (n) => day(n.updatedAt) },
    // The write actions exist only for roles that may use them (<Can> hides,
    // never disables) — cells stop propagation implicitly because rows carry
    // no onRowClick here.
    ...(can('notes:write')
      ? [
          {
            key: 'actions',
            header: '',
            className: 'w-24 text-right',
            render: (n: Note) => (
              <span className="inline-flex gap-1">
                <button
                  type="button"
                  aria-label={`Edit ${n.title}`}
                  className="rounded-md p-1.5 text-ink-400 hover:text-ink-900"
                  onClick={() => {
                    setEditing(n)
                    setFormOpen(true)
                  }}
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${n.title}`}
                  className="rounded-md p-1.5 text-ink-400 hover:text-danger"
                  onClick={() => setCondemned(n)}
                >
                  <Trash2 size={15} />
                </button>
              </span>
            ),
          } satisfies Column<Note>,
        ]
      : []),
  ]

  async function onDelete(note: Note): Promise<void> {
    setCondemned(null)
    try {
      await deleteNote(note.noteId)
      toast(`Deleted “${note.title}”.`, 'ok')
      reload()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'The note could not be deleted.', 'danger')
    }
  }

  return (
    <>
      <PageHeader
        title="Notes"
        subtitle={loaded ? `${total} note${total === 1 ? '' : 's'}` : undefined}
        actions={
          <Can permission="notes:write">
            <Button
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
            >
              <Plus size={15} /> New note
            </Button>
          </Can>
        }
      />

      <div className="mb-4 max-w-xs">
        <Input
          placeholder="Search title or body…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {error ? (
        // A FAILED read is named as one — never rendered as an empty list.
        <EmptyState title="The notes could not be loaded" hint={error} />
      ) : !loaded ? (
        <p className="text-sm text-ink-400">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title={q ? 'Nothing matches that search.' : 'No notes yet.'}
          hint={
            !q && (
              <Cannot permission="notes:write">
                <span>Ask a manager to create the first one.</span>
              </Cannot>
            )
          }
        />
      ) : (
        <Table columns={columns} data={rows} rowKey={(n) => n.noteId} />
      )}

      <NoteFormModal
        open={formOpen}
        note={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(saved) => {
          setFormOpen(false)
          toast(editing ? `Saved “${saved.title}”.` : `Created “${saved.title}”.`, 'ok')
          reload()
        }}
      />

      <ConfirmDialog
        open={!!condemned}
        title={`Delete “${condemned?.title}”?`}
        detail="This cannot be undone."
        confirmLabel="Delete"
        danger
        onCancel={() => setCondemned(null)}
        onConfirm={() => condemned && void onDelete(condemned)}
      />
    </>
  )
}
