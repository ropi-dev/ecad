# Electrical rules check

Open a circuit and choose Electrical rules check in the bottom toolbar, then Run ERC. Select a result to select and center its pin or net. Results become outdated after electrical edits. Moving or collapsing a component preserves the report. Undo restores the report when the circuit matches the checked contents. The panel displays 50 results per page.

The checker runs on the circuit model, so schematic wiring uses the existing schematic-to-circuit synchronization. It does not inspect drawing geometry. The UI currently lives in circuit view.

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

Pass an explicit rule array to the engine. Import individual built-in rules to assemble a smaller set. Add a rule to `defaultErcRules` to include it in the panel. IDs must be unique and nonempty. Disabled rules do not run.

The engine builds pin lookup, pin-to-net lookup, net-to-pins lookup, and the no-connect set once. Rules receive these indexes and a read-only circuit. Treat inputs as immutable. Checks are synchronous and return any iterable of findings. A failed rule throws with its rule ID and original cause and fails the run, rather than producing a partial clean report.

Each finding has a message and subjects with stable circuit IDs. An optional `target` chooses the entity to select. Without it, the panel selects the first subject. Net rules identify affected pins as subjects and target the net separately, so recreating an equivalent net preserves the diagnostic ID.

Use an optional `code` when a rule can report different violations involving the same subjects. The engine deduplicates findings by rule ID, code, and subject set. Duplicate subjects do not change identity. It copies subjects and targets as each finding is yielded, so a generator can reuse its own arrays. Errors sort before warnings. The checker does not save results or modify the circuit.

## Built-in rules

| Rule ID | Default | Condition |
| --- | --- | --- |
| `unconnected-pin` | Warning | Pin has no net or belongs to a net containing only itself. A disconnected pin marked no-connect is exempt. |
| `undriven-input` | Warning | A net with at least two pins has inputs but no output, bidirectional pin, or power output. |
| `undriven-power` | Error | A net with at least two pins has power inputs but no power output. |
| `conflicting-outputs` | Error | Multiple signal or power outputs share a net, including mixed outputs. Bidirectional pins do not count. |
| `connected-no-connect` | Error | A pin is both in a net and marked no-connect. The persisted circuit validator already prevents this, but the rule can check in-memory inputs. |

A lone input or power input produces an unconnected warning, rather than a second missing-driver finding. A contradictory no-connect marker on a connected pin does not suppress missing-driver findings. Passive pins do not prove that a signal or power source exists. Connector-fed supplies need a pin typed as power-out. Ground names and supply labels alone do not prove a driver exists. The model currently has no open-drain, tri-state, voltage, or power-flag semantics. Those checks need more pin or circuit data before they can be reliable.

## Validation

`pnpm exec tsx --test tests/erc.test.ts` checks built-in behavior and the rule contract. The `circuit-erc` performance scenario runs checks repeatedly on 64 unconnected pins, exercises result pagination, moves and collapses a component without invalidating results, selects a hidden pin to expand its component, and marks a pin no-connect to verify stale results and rerunning. It budgets 100 ms for `circuit.erc`, 1 second for panel interactions, 2,800 DOM nodes, and 3 MB of scripts under local Chromium with 4x CPU throttling. The existing `circuit-graph` scenario compares normal circuit editing before and after.


## Alternative designs

GPT 6 Astra implemented pin and net visitor callbacks with frozen projections and explicit partial results for failed rules. GLM 5.3 Flash kept iterable rules and explored per-run cached analysis, suppression options, and rule-error diagnostics. Both alternatives were built separately for comparison.

The shipped design keeps iterable rules and an explicit rule array. That supports whole-circuit checks without adding separate visitor types. It adopts separate navigation targets, optional finding codes, canonical subject sets, and stricter no-connect handling from Astra. Rule failures now identify their rule and preserve the cause, addressing the failure-diagnosis concern in both alternatives while retaining whole-run failure. Generic caches, suppression settings, and partial-run UI are deferred until concrete rules need them. No dependency or persistence change is needed for these additions.
