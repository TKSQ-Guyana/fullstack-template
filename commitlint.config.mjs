// Conventional commits, enforced by the commit-msg hook. Subjects name the
// area: `feat(backend): ...`, `fix(frontend): ...`, `chore(ci): ...`.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Warn (not error) on long body lines so pasted URLs don't block a commit.
    'body-max-line-length': [1, 'always', 200],
    // Subjects legitimately carry proper nouns (Keycloak, Docker, Postgres);
    // sentence-case detection cannot tell those from shouting.
    'subject-case': [0],
  },
}
