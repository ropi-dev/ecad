# Default 3D models

`@ecad/default-models` is the built-in 3D model library: one model for each of the 62 built-in footprints, drawn on the board in the realistic view of the PCB and footprint editors.

```ts
import { defaultModels } from "@ecad/default-models";

const models = defaultModels();
// Each entry has an id, the model's name, the KiCad library name as its category,
// and the URL of a binary glTF file.
```

A model's ID is its name in lower case, such as `r_0805_2012metric`. Built-in footprints name their model in `src/models.ts` of `@ecad/default-footprints`. Most share the footprint's ID. Both SOT-223 footprints and the 208 mil SOIC-8 use a model with another name, because KiCad shares one model between them or names it after the nominal body size.

The files in `models/` are binary glTF 2.0 with one mesh per colour. Units are millimetres, not glTF's metres, and Z points up from the board's top copper. The origin is the footprint's origin, so a model needs no offset or rotation of its own. Faces that are light grey or gold get a metal finish. The rest are matte plastic.

51 models are KiCad's, 6 come from Raspberry Pi's RP2350A minimal board for the footprints converted from that board, and ECAD builds 5 for which KiCad has no model: three QFN packages, the Bourns 3386P trimmer and the Molex Micro-B receptacle. [NOTICE.md](NOTICE.md) lists them with their sources and licenses.

## Rebuild the models

From the repository root:

```bash
pnpm run models:build
```

The script downloads each STEP model from KiCad's library at the commit in `scripts/sources.ts`, and Raspberry Pi's board archive, whose SHA-256 it checks. Downloads are cached in `node_modules/.cache/ecad-default-models`. It tessellates the STEP files with `occt-import-js`, applies KiCad's model offset and rotation, then rewrites `models/` and `src/catalog.ts`. It takes about 25 seconds.

To add a model, add an entry to `scripts/sources.ts`, add it to NOTICE.md, link a footprint to it in `@ecad/default-footprints`, rebuild, and run `pnpm --filter @ecad/default-models test` and `tests/footprint-models.test.ts`. The second test checks that every built-in footprint's pads lie inside its model's outline, which catches a model turned the wrong way.

KiCad's models are CC BY-SA 4.0 with KiCad's electronic-design exception, Raspberry Pi's are MIT, and ECAD's own are under the repository's MIT license. See [LICENSE.md](LICENSE.md), [CC-BY-SA-4.0.txt](CC-BY-SA-4.0.txt) and [NOTICE.md](NOTICE.md).
