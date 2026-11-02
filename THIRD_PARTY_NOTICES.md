# Third-party notices

ECAD's original application code is under the root MIT license. That license does not replace the licenses of third-party code, symbols, fonts, or reference designs.

## Copied UI and starter code

The components in `packages/core/src/components/ui` include code from [shadcn/ui](https://github.com/shadcn-ui/ui). Copyright 2023 shadcn. The full MIT notice is in [licenses/shadcn-MIT.txt](licenses/shadcn-MIT.txt).

The TanStack Start scaffold and demo code originate from the [TanStack project](https://github.com/TanStack/router). Copyright 2021-present Tanner Linsley. The full MIT notice is in [licenses/tanstack-MIT.txt](licenses/tanstack-MIT.txt).

## Schematic symbols

`packages/default-symbols` includes adaptations of the KiCad library contributors' symbols under CC BY-SA 4.0 with KiCad's electronic-design exception. The source commits and modifications are recorded in [NOTICE.md](packages/default-symbols/NOTICE.md). Retain that attribution, [the library license and exception](packages/default-symbols/LICENSE.md), and [the full license text](packages/default-symbols/CC-BY-SA-4.0.txt) when redistributing the collection.

The exception permits use in proprietary electronic designs. It does not exempt redistribution of the symbol library itself from its license conditions.

## Font

`packages/core/src/projects/fonts/Caveat-Medium.ttf` is by the Caveat Project Authors, copyright 2014. It remains under the [SIL Open Font License 1.1](packages/core/src/projects/fonts/OFL.txt).

## STEP importer

The web and desktop viewers distribute `occt-import-js` 0.0.23 and Open CASCADE Technology as a WebAssembly library. The importer remains under [LGPL-2.1](licenses/occt-import-js-LGPL-2.1.txt). Open CASCADE retains [LGPL-2.1](licenses/OCCT-LGPL-2.1.txt) and [its additional exception](licenses/OCCT-LGPL-EXCEPTION.txt).

The matching source archives, revisions, checksums, and rebuild instructions accompany production builds. See [licenses/STEP-SOURCE.md](licenses/STEP-SOURCE.md). Recipients may modify and replace the library and reverse-engineer the application as needed to debug those modifications. ECAD imposes no additional restriction on those rights.

## Reference designs

The RP2350A fixtures in `tests/fixtures/kicad` and `tests/fixtures/rp2350a-reference` derive from Raspberry Pi's minimal reference design. Copyright 2026 Raspberry Pi Ltd. Both fixture directories retain the supplied MIT license and design disclaimer in `LICENSE.txt`.

## Dependency notices in builds

Production builds write `LICENSE.txt` and `THIRD_PARTY_NOTICES.txt`. The latter contains full notices for the copied code, applicable bundled assets, and installed production dependencies, including available peer and optional dependencies. It may list dependencies that a particular bundle does not use. External runtime dependencies retain their own notices and must accompany distributions that include them.

Some npm packages omit their upstream license files. Version-specific copies live in `licenses/dependencies`, with source links in `licenses/dependency-overrides.json`. Builds reject a dependency with no license text or matching override.

Web and desktop builds also include `licenses/STEP-SOURCE.md`, the source manifest, and both source archives under `licenses/sources`. Preserve these files when deploying or packaging the app. The CLI does not distribute the STEP importer, built-in symbol library, or font.

Third-party names identify their code or assets. They do not imply endorsement of ECAD.
