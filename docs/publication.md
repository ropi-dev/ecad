# Publication checklist

Production builds automatically bundle license notices and matching STEP importer source archives. Publishing the repository or distributing compiled builds still requires verifying ownership and artifacts outside the working tree.

## Before making a repository public

- **Ownership and permissions** — Confirm that employer, client, NDA, and contributor agreements permit releasing all code and designs. Keep records for any manually copied reference material.
- **Git history audit** — Scan the full history of every branch and tag to be published. Revoke any exposed credential before rewriting history. (A clean secret scan does not guarantee absence.)
- **Author metadata** — Review commit author names and emails. Changing Git config affects only future commits; removing historical identities requires a coordinated history rewrite.
- **External platform artifacts** — Review pull requests, issues, release assets, Actions logs, and uploaded artifacts for credentials, private designs, screenshots, or personal information.
- **Attribution and branding** — Keep third-party license files and attribution in source distributions. Use ECAD's own branding and do not imply endorsement by upstream projects or component manufacturers.
- **Accurate claims** — Describe ECAD as experimental and verify that `README.md` matches current persistence, import, and export behavior.

A public repository can be cloned or forked immediately; returning it to private does not recall existing copies.

## Verifying a distribution

Build all targets:

```bash
pnpm run build:web
pnpm run build:desktop
pnpm run build:cli
```

Confirm the following files exist in the build outputs:

- `packages/web/dist/client/`, `packages/desktop/dist/renderer/`, and `packages/cli/dist/` each contain `LICENSE.txt` and `THIRD_PARTY_NOTICES.txt`.
- Web and desktop outputs also contain `licenses/STEP-SOURCE.md`, `licenses/step-sources.json`, and both source archives under `licenses/sources/`.
- For web deployments, verify that notice and archive URLs serve the actual files rather than the SPA HTML fallback.
- Preserve all license files and source archives in release packages. The desktop renderer directory and main-process files form a single distribution.
- `@ecad/cli` relies on external runtime dependencies; if you bundle or redistribute them, include their license files as well.
