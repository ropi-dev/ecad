# Electrical rules check

Open a circuit and choose Electrical rules check in the bottom toolbar, then Run ERC. Select a result to select and center its pin or net. Results become outdated after electrical edits. Moving or collapsing a component preserves the report. Undo restores the report when the circuit matches the checked contents. The panel displays 50 results per page.

The schematic editor has the same button. It checks the circuit that the current drawing describes, including unsaved edits: symbols become components, and wires, net labels and supply symbols become nets. A no-connect marker on a pin's terminal marks that pin no-connect. So does a marker on a wire that reaches only that pin, as in KiCad. Select a result to select the symbols involved. The schematic report becomes outdated after any drawing edit. The symbol editor has no ERC.

The checker runs on the circuit model. In the schematic editor, `schematicCircuit` in `packages/core/src/circuit/linked-schematic.ts` builds that model with the same schematic-to-circuit synchronization that linked circuits use. A symbol whose reference another part already uses is checked as, for example, `R1 (2)`, so a duplicate reference becomes a finding instead of a failed run. The schematic editor also passes the drawing, and the schematic rules read its wires, labels, markers and symbols.

## Add a rule

Rules are plain objects. They need no React, store, graph layout, service, or registration class. The engine imports the circuit model as types and uses the shared optional performance recorder. It adds no dependencies.

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

Pass an explicit rule array to the engine. Import individual built-in rules to assemble a smaller set. The circuit editor runs `defaultErcRules`. The schematic editor runs `schematicErcRules` from `@ecad/drawing-core/erc/schematic-rules.ts`, which adds the drawing rules, and passes `schematic: schematicErcInput(shapes)` in the options. A rule that needs the drawing reads `context.schematic` and finds nothing when it is absent. IDs must be unique and nonempty. Disabled rules do not run.

The engine builds pin lookup, pin-to-net lookup, net-to-pins lookup, and the no-connect set once. Rules receive these indexes and a read-only circuit. Treat inputs as immutable. Checks are synchronous and return any iterable of findings. A failed rule throws with its rule ID and original cause and fails the run, rather than producing a partial clean report.

Each finding has a message and subjects with stable circuit IDs. Drawing rules use `shape` subjects, whose ID is the drawing shape ID. An optional `target` chooses the entity to select. Without it, the schematic panel selects every subject and the circuit panel selects the first. Net rules identify affected pins as subjects and target the net separately, so recreating an equivalent net preserves the diagnostic ID.

Use an optional `code` when a rule can report different violations involving the same subjects. The engine deduplicates findings by rule ID, code, and subject set. Duplicate subjects do not change identity. It copies subjects and targets as each finding is yielded, so a generator can reuse its own arrays. Errors sort before warnings. The checker does not save results or modify the circuit.

## Built-in rules

The rules follow KiCad's ERC. Severities match KiCad's defaults, with two exceptions kept from before these rules. Incomplete wiring is a warning, where KiCad makes unconnected pins, undriven inputs, floating wires and unconnected labels errors. A no-connect marker on a wired pin's terminal is a `connected-no-connect` error, where KiCad warns. The same marker on that pin's wire is a `stray-no-connect` warning, as in KiCad.

These rules run in both editors:

| Rule ID | Default | KiCad check | Condition |
| --- | --- | --- | --- |
| `unconnected-pin` | Warning | Pin not connected | Pin has no net or belongs to a net containing only itself. A disconnected pin marked no-connect, or with the Unconnected or Free pin type, is exempt. It also covers KiCad's label connected to a single pin. |
| `undriven-input` | Warning | Input pin not driven | A net with at least two pins has inputs but no output, bidirectional, tri-state, passive, power output, open-collector or open-emitter pin. |
| `undriven-power` | Error | Input power pin not driven | A net with at least two pins has power inputs but no power output and no supply symbol. |
| `pin-type-conflict` | Error | Pin conflict matrix, error | Two pins on a net have types that KiCad's default pin conflict matrix marks as an error, such as two outputs, an output and an open collector, or a tri-state pin and a power output. |
| `pin-type-warning` | Warning | Pin conflict matrix, warning | Two pins on a net have types that the matrix marks as a warning, such as an output and a tri-state pin, a bidirectional pin and a power output, or an Unspecified pin and anything except a Free pin. |
| `connected-no-connect` | Error | Pin with no connection type is connected | A pin is both in a net and marked no-connect, or a pin with the Unconnected pin type shares a net with another pin that is not a same-name pin of its own part. The persisted circuit validator already prevents the first case, but the rule can check in-memory inputs. |
| `duplicate-pin-nets` | Error | Shared pin on different nets; duplicate pin on different nets | Two pins of one component with the same number, in one unit or in different units, are on different nets. Unlike KiCad, an unwired copy is left to `unconnected-pin`. |
| `ground-pin-not-ground` | Warning | Ground pin not on a ground net | A component has a power pin on a ground net, and another power pin with a ground name is on a net without one. Names containing GND, and EARTH, EARTH_…, VSS and VSSA, count as ground. |
| `multiple-net-names` | Warning | Multiple net names (driver conflict) | A net has more than one name, for example because a wire joins two labels or two supply symbols. |
| `similar-net-names` | Warning | Similar labels; similar power symbols; similar label and power | Two net names differ only in case, in a leading `+` directly before the last number, or in µ written as u after it, as KiCad compares them. `GND` and `gnd` match, and so do `+5V` and `5V` or `+1,8V` and `1,8V`, but `+3V3` and `3V3` do not. |

The pin conflict rules report one finding per net and severity. Each lists the conflicting type pairs and the pins involved and selects the net. Same-name pins of one component, such as a regulator's OUT pin and tab, are one pad, as KiCad's stacked pins are, and are not compared with each other. Unnamed pins, including KiCad's `~` placeholder, are always compared. Pins of the Unconnected type are left to `connected-no-connect`, so a wired Unconnected pin is reported once.

These rules run only in the schematic editor:

| Rule ID | Default | KiCad check | Condition |
| --- | --- | --- | --- |
| `duplicate-reference` | Error | Duplicate reference | Two symbols use one reference and are not different units of one KiCad library part. Placing a unit twice counts. |
| `unannotated-symbol` | Warning | Unannotated symbol | A component symbol's reference is empty or contains `?`. The message gives the reference that the circuit assigns. KiCad makes this an error, but the circuit numbers such symbols itself. |
| `different-unit-value` | Error | Different unit values | Units of one KiCad part have different values. |
| `missing-library-symbol` | Warning | Library symbol issue | A placed symbol refers to a library that does not contain it. Its pins are missing from every other check. |
| `empty-supply-name` | Error | Empty power symbol value | A supply symbol's Name is empty, so it names no net. |
| `empty-net-label` | Error | Empty label name | A net or supply label's text is empty. |
| `unconnected-label` | Warning | Label not connected | A label's anchor or a supply symbol's terminal touches no wire or pin on its page, or its net reaches no component pins. |
| `floating-wire` | Warning | Wires not connected to anything | A group of connected wires touches no pin and no label. |
| `unconnected-wire-end` | Warning | Unconnected wire endpoint | A wire end touches no wire, pin, label or no-connect marker. Wires that `floating-wire` reports are skipped. |
| `stray-no-connect` | Warning | No-connect flag not connected; no-connect flag connected to more than one pin | A no-connect marker is away from any pin terminal and touches nothing, or sits on a wire or label whose net reaches two or more pins. |
| `label-multiple-wires` | Warning | Label connected to more than one wire | A label's anchor lies on two or more wires away from their ends, so it joins wires that only cross. |

Rules read each pin's electrical type. Types match KiCad's: input, output, bidirectional, tri-state, passive, free, unspecified, power input, power output, open collector, open emitter and unconnected (`no-connect`). A pin without a type is passive. In the schematic editor, each pin takes its type from the symbol definition, so changing a pin's type in the symbol editor changes the check for every placement. Changing it on a pin of a placed symbol overrides it for that placement only. Built-in symbols follow KiCad's conventions: passives, diodes, transistors, switches, connectors and batteries have passive pins; chip supply and ground pins are power inputs; regulator outputs are power outputs; GPIOs are bidirectional. KiCad imports keep their source pin types.

A lone input or power input produces an unconnected warning, rather than a second missing-driver finding. A contradictory no-connect marker on a connected pin does not suppress missing-driver findings. As in KiCad, passive pins drive inputs, so resistors around an op amp input satisfy it. Open-collector and open-emitter outputs also drive inputs, because the pull-up may be inside the receiving chip. KiCad does not count them. Only a power output drives a power input. A supply symbol, such as GND or VCC, on the net also counts as the source and takes the place of KiCad's PWR_FLAG. Supply labels and net labels alone do not. A rail fed through a passive part, such as an inductor, ferrite or RC filter, needs a supply symbol on the filtered net. The checker has no voltage or tri-state bus semantics.

### KiCad checks that do not apply

ECAD has no hierarchical sheets, buses, net classes, text variables, simulation models, footprints, variants or custom fields. KiCad's checks for those features have nothing to inspect: hierarchical label mismatches, duplicate sheet names and suffixes, reference suffix mismatches, bus alias, bus entry and bus conflict checks, undefined net classes, unresolved variables, simulation models, footprint links, footprint filters, different footprints across units, pin-to-pad maps, variant symbols and field name whitespace.

Some others do not fit how ECAD stores a schematic:

- Every label name is drawing-wide, so there are no local and global labels to confuse, and a label used once is a normal net name. That rules out KiCad's same local and global label, same local and global power, and single global label checks. KiCad turns the last one off by default.
- Drawings do not record how many units a KiCad part has, so missing units, extra units, and missing input, bidirectional or power pins in unplaced units cannot be checked. The KiCad importer reads the full library symbol, so storing the unit count at import would make these checks possible. KiCad's missing power pin check is an error by default.
- Placed symbols draw from their library definition each time a drawing opens, so a placement cannot drift from its library copy. Only a missing definition is reported.
- Snapping follows the zoom level and there is no fixed connection grid, so off-grid endpoints are not checked. Ends that miss by a small distance show up as unconnected wire ends.
- The editor draws a junction dot where three or more items meet, so four-way junctions are visible without a check. KiCad also turns that check off by default.
- Pins have no hidden power pins that join a net by name, and pin numbers have no stacked-pin notation.

## Validation

`pnpm exec tsx --test tests/erc.test.ts` checks the circuit rules and the rule contract, and `tests/schematic-erc.test.ts` checks the schematic rules on small drawings. The `circuit-erc` performance scenario runs checks repeatedly on 64 unconnected pins, exercises result pagination, moves and collapses a component without invalidating results, selects a hidden pin to expand its component, and marks a pin no-connect to verify stale results and rerunning. It budgets 100 ms for `circuit.erc`, 1 second for panel interactions, 2,800 DOM nodes, and 3 MB of scripts under local Chromium with 4x CPU throttling. The existing `circuit-graph` scenario compares normal circuit editing before and after.

The `schematic-erc` scenario imports the RP2350A KiCad reference schematic (39 components, 231 pins, one no-connect marker), whose one finding is the RC-filtered VREG_AVDD rail, adds an unwired resistor, runs the schematic check three times, and selects a finding. Under the same conditions it budgets 1 second for each run including rendering the results, 100 ms for `circuit.erc`, 50 ms for `schematic.no-connect` (matching pins to no-connect markers), fewer than 1,500 DOM nodes, at most 3 MB of scripts, and frame p95 below 500 ms. When it was added, those measured 389 ms, 2.9 ms, 10.3 ms and 904 nodes.


## Alternative designs

GPT 6 Astra implemented pin and net visitor callbacks with frozen projections and explicit partial results for failed rules. GLM 5.3 Flash kept iterable rules and explored per-run cached analysis, suppression options, and rule-error diagnostics. Both alternatives were built separately for comparison.

The shipped design keeps iterable rules and an explicit rule array. That supports whole-circuit checks without adding separate visitor types. It adopts separate navigation targets, optional finding codes, canonical subject sets, and stricter no-connect handling from Astra. Rule failures now identify their rule and preserve the cause, addressing the failure-diagnosis concern in both alternatives while retaining whole-run failure. Generic caches, suppression settings, and partial-run UI are deferred until concrete rules need them. No dependency or persistence change is needed for these additions.
