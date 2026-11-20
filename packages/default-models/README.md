# `@ecad/default-models`

Built-in library of **62 binary glTF 2.0 3D models** rendered in the realistic 3D view of the PCB and footprint editors (covering all 62 component footprints in `@ecad/default-footprints`; the two unplated mounting hole footprints have no 3D model).

```ts
import { defaultModels } from "@ecad/default-models";

const models = defaultModels();
// Each entry has `id`, `name`, `category` (KiCad library name), and binary glTF `url`.
```

## Conventions and sources

- **Units & orientation** — Files in `models/` are binary glTF 2.0 (`.glb`) in **millimetres** (not metres), Z up from top copper, origin aligned to the footprint origin (no runtime offset/rotation required). Light grey and gold faces render metallic; other faces render matte plastic.
- **Sources** — 51 models from KiCad's 3D library, 6 from Raspberry Pi's RP2350A minimal board, and 5 built by ECAD (three QFN packages, Bourns 3386P trimmer, Molex Micro-B). See [NOTICE.md](NOTICE.md) for attributions.

## Rebuilding models

From the repository root (~25 seconds):

```bash
pnpm run models:build
```

Downloads pinned KiCad STEP files (`scripts/sources.ts`) and Raspberry Pi's board archive (SHA-256 verified) into `node_modules/.cache/ecad-default-models`, tessellates them via `occt-import-js` with KiCad offsets/rotations, and regenerates `models/` and `src/catalog.ts`.

To add a model: add it to `scripts/sources.ts` and [NOTICE.md](NOTICE.md), link it in `@ecad/default-footprints/src/models.ts`, run `pnpm run models:build`, and verify with `pnpm --filter @ecad/default-models test` and `pnpm exec tsx --test tests/footprint-models.test.ts` (which checks that every footprint's pads lie within its model outline).

## License

KiCad models are **CC BY-SA 4.0** (with KiCad's electronic-design exception), Raspberry Pi models are **MIT**, and ECAD-authored models are **MIT**. See [LICENSE.md](LICENSE.md), [CC-BY-SA-4.0.txt](CC-BY-SA-4.0.txt), and [NOTICE.md](NOTICE.md).
