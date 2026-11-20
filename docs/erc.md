# Electrical rules check (ERC)

ERC checks electrical connectivity and schematic hygiene in both the circuit editor and the schematic editor.

- Open **Electrical rules check** in the bottom toolbar and click **Run ERC**.
- Click any finding to select and center its affected pin, net, or shapes (opening its schematic page if needed). Results paginate at 50 items per page.
- In the circuit view, layout moves and collapses preserve the report; electrical edits mark it outdated (undoing back to the checked state restores it). In the schematic editor, any drawing edit marks it outdated. The symbol editor has no ERC.
- Per-rule severity levels (`Error`, `Warning`, `Off`) can be configured globally and per project under **Settings → Electrical rules**.

In the schematic editor, `schematicCircuit` (`packages/core/src/circuit/linked-schematic.ts`) builds the circuit model from the current drawing (including unsaved edits), numbering duplicate references such as `R1 (2)` so duplicates surface as findings rather than aborting the run.

## Built-in rules

Rules follow KiCad's ERC conventions, with two intentional severity differences: incomplete wiring (`unconnected-pin`, `undriven-input`, `floating-wire`, `unconnected-label`) defaults to `Warning` rather than `Error`, and a no-connect marker on a wired pin's terminal is an `Error` (`connected-no-connect`) while one on its wire is a `Warning` (`stray-no-connect`).

### Circuit and schematic rules

| Rule ID | Default | Condition |
| --- | --- | --- |
| `unconnected-pin` | Warning | Pin has no net or is the sole pin on its net (exempt if marked no-connect or typed `no-connect`/`free`). |
| `undriven-input` | Warning | Multi-pin net has input pins but no output, bidirectional, tri-state, passive, power-out, open-collector, or open-emitter pin. |
| `undriven-power` | Error | Multi-pin net has `power-in` pins with no `power-out` pin and no supply symbol. |
| `pin-type-conflict` | Error | Net contains a pin-type pair marked as error in KiCad's pin conflict matrix (e.g., two outputs, output + open-collector, tri-state + power-out). |
| `pin-type-warning` | Warning | Net contains a pin-type pair marked as warning in KiCad's matrix (e.g., output + tri-state, bidirectional + power-out, unspecified + non-free). |
| `connected-no-connect` | Error | Pin is both connected and marked no-connect, or a `no-connect` pin shares a net with another pin (other than a same-name pin on its own part). |
| `duplicate-pin-nets` | Error | Two pins of the same component with the same number sit on different nets. |
| `ground-pin-not-ground` | Warning | Component has one power pin on a ground net (`GND`, `EARTH*`, `VSS`, `VSSA`) and another ground-named power pin on a non-ground net. |
| `multiple-net-names` | Warning | Net carries more than one explicit name (e.g., two labels or supply symbols joined by wire). |
| `similar-net-names` | Warning | Two net names differ only in case, a leading `+` before the last number (`+5V` vs `5V`), or `µ` vs `u` after it. |

Pin conflict rules emit one finding per net and severity, skipping same-name stacked pins on the same component (unnamed pins and `~` placeholders are still compared).

### Schematic-only rules

| Rule ID | Default | Condition |
| --- | --- | --- |
| `duplicate-reference` | Error | Two symbols share a reference and are not distinct units of one KiCad part. |
| `unannotated-symbol` | Warning | Reference is empty or contains `?`. |
| `different-unit-value` | Error | Units of one multi-unit KiCad part have differing values. |
| `missing-library-symbol` | Warning | Placed symbol references a missing library definition. |
| `empty-supply-name` | Error | Supply symbol's Name is empty. |
| `empty-net-label` | Error | Net or supply label text is empty. |
| `unconnected-label` | Warning | Label anchor or supply terminal touches no wire/pin on its page, or its net reaches no component pins. |
| `floating-wire` | Warning | Connected wire group touches no pin and no label. |
| `unconnected-wire-end` | Warning | Wire endpoint touches no wire, pin, label, or no-connect marker (skips floating wires). |
| `stray-no-connect` | Warning | No-connect marker touches nothing or sits on a net reaching 2+ pins. |
| `label-multiple-wires` | Warning | Label anchor sits on 2+ crossing wires away from their endpoints. |

### Pin electrical types and power rails

ERC reads KiCad's 12 electrical types (`input`, `output`, `bidirectional`, `tri-state`, `passive`, `free`, `unspecified`, `power-in`, `power-out`, `open-collector`, `open-emitter`, `no-connect`; default `passive`). Passive, open-collector, and open-emitter pins drive inputs. Only `power-out` pins or supply symbols (`GND`, `VCC`, …) drive `power-in` pins — rails fed through passives (inductors, ferrites, RC filters) need a supply symbol on the filtered net. Active-low pins are annotated in finding messages (e.g., `U1 pin 25 (RESET, active low)`) without altering check logic.

### KiCad checks not applicable in ECAD

ECAD has no hierarchical sheets, buses, net classes, text variables, simulation models, or assembly variants, so KiCad checks for those features do not apply. Additionally: all net labels are drawing-wide (no local/global label conflict); drawings do not store total unit counts for multi-unit parts; placed symbols resolve live from libraries (no library-drift check); zooming sets snap grid dynamically (no off-grid check); and 3+/4-way junctions render explicit dots.

## Writing custom rules

Rules are plain synchronous objects with no UI or store dependencies:

```ts
import { runErc, type ErcRule } from "@ecad/drawing-core/erc/engine.ts";
import { defaultErcRules } from "@ecad/drawing-core/erc/rules.ts";

const unnamedNet: ErcRule = {
  id: "project/unnamed-net",
  title: "Unnamed net",
  severity: "warning",
  *check({ circuit }) {
    for (const net of circuit.nets) {
      if (net.names.length === 0) {
        yield {
          message: "Give this net a name.",
          subjects: [{ kind: "net", id: net.id }],
        };
      }
    }
  },
};

const diagnostics = runErc(circuit, [...defaultErcRules, unnamedNet], {
  severity: { "unconnected-pin": "off", "project/unnamed-net": "error" },
});
```

- Circuit editor runs `defaultErcRules`; schematic editor runs `schematicErcRules` (`@ecad/drawing-core/erc/schematic-rules.ts`) with `schematic: schematicErcInput(shapes)`.
- `runErc` precomputes pin, pin-to-net, net-to-pin, and no-connect indexes once and deduplicates findings by `(ruleId, code, sortedSubjects)`. Errors sort before warnings. A throwing rule aborts the run with its rule ID and original cause.

## Validation

- Unit tests: `pnpm exec tsx --test tests/erc.test.ts` and `tests/schematic-erc.test.ts`.
- Performance scenarios: `circuit-erc` and `schematic-erc` (see [docs/performance.md](performance.md)).
