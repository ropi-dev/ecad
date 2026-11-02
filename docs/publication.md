# Before making the repository public

The build includes license notices and matching STEP importer source archives. Publishing still requires a review of ownership and material outside the current checkout.

- Confirm that employer, client, NDA, and contributor agreements permit release of the code and designs. Keep evidence of permission for manually copied material.
- Scan the complete history of every branch and tag that will become public. Revoke any exposed credential before removing it from history. A clean secret scan cannot prove that every sensitive value is absent.
- Review commit author names and email addresses. Changing Git settings affects future commits only. Removing old identities requires a coordinated history rewrite, which these licensing changes do not perform.
- Review pull requests, issues, release assets, Actions logs, and uploaded artifacts for credentials, private designs, screenshots, and personal information. Those are outside a local Git scan.
- Keep the third-party license files and attribution in source distributions. Deploy or package all generated license files and STEP source archives with compiled applications. Do not deploy only the JavaScript and WebAssembly assets.
- Describe ECAD as experimental. Check the README's claims against what the app currently supports, especially persistence and export behavior.
- Use ECAD's own branding and avoid implying endorsement by upstream projects or component manufacturers.

A public repository is discoverable and can be cloned or forked without an announcement. Returning it to private cannot recall copies already made.

## Verify a distribution

Build with `pnpm run build:web`, `pnpm run build:desktop`, and `pnpm run build:cli`. Check `packages/web/dist/client`, `packages/desktop/dist/renderer`, and `packages/cli/dist` for `LICENSE.txt` and `THIRD_PARTY_NOTICES.txt`.

Web and desktop outputs must also contain `licenses/STEP-SOURCE.md`, `licenses/step-sources.json`, and both archives under `licenses/sources`. Verify the deployed notice and archive URLs return the actual files rather than the SPA HTML fallback. Preserve them in release archives too. The desktop renderer directory and desktop main-process files form one distribution.

The CLI still requires its external runtime dependencies. If you distribute those dependencies, include their own license files.
