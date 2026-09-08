// THE ONLY MODULE THAT KNOWS AN API PATH. Feature code imports the functions
// beside this file (notes.ts, me.ts, …); nothing else concatenates a URL.
export const PATHS = Object.freeze({
  me: '/me',
  notes: '/notes',
  note: (noteId: string) => `/notes/${encodeURIComponent(noteId)}`,
  documentUpload: '/document/upload',
  documentList: '/document/list',
  documentView: '/document/view',
})
