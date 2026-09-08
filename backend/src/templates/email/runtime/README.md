# Runtime email templates

Handlebars templates rendered by `src/services/emailTemplates.ts`. The
directory is copied into `dist/` by `scripts/copy-templates.mjs` as part of
`npm run build`, so a built image always carries it.

Prettier deliberately ignores this directory (see ../../../.prettierignore):
its glimmer parser cannot read Handlebars partial blocks.
