// Conventional commits, enforced by the commit-msg hook. Subjects name the
// area: `feat(backend): ...`, `fix(frontend): ...`, `chore(ci): ...`.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Warn (not error) on long body lines so pasted URLs don't block a commit.
    'body-max-line-length': [1, 'always', 200],
  },
}
