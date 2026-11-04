import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createCircuit,
	type CircuitPin,
} from "@ecad/drawing-core/circuit/model.ts";
import { type ErcRule, runErc } from "@ecad/drawing-core/erc/engine.ts";
import { defaultErcRules } from "@ecad/drawing-core/erc/rules.ts";

function fixture(types: CircuitPin["electricalType"][], connected = true) {
	const circuit = createCircuit("ERC fixture", "circuit").circuit;
	circuit.components = types.map((electricalType, index) => ({
		id: `c${index}`,
		reference: `U${index + 1}`,
		value: "",
		part: { id: "test", name: "Test" },
		pins: [{ id: `p${index}`, name: "", number: "1", electricalType }],
	}));
	if (connected)
		circuit.nets = [
			{ id: "net", names: ["SIGNAL"], pinIds: types.map((_, i) => `p${i}`) },
		];
	return circuit;
}
const checks = (types: CircuitPin["electricalType"][], connected = true) =>
	runErc(fixture(types, connected), defaultErcRules).map((item) => item.ruleId);

test("ERC reports isolated pins, including single-pin nets, and honors no-connects", () => {
	assert.deepEqual(checks(["passive"], false), ["unconnected-pin"]);
	assert.deepEqual(checks(["input"]), ["unconnected-pin"]);
	const circuit = fixture(["input"], false);
	circuit.noConnectPinIds = ["p0"];
	assert.deepEqual(runErc(circuit, defaultErcRules), []);
});

test("ERC distinguishes signal drivers, power drivers and passive connections", () => {
	assert.deepEqual(checks(["input", "passive"]), ["undriven-input"]);
	for (const driver of ["output", "bidirectional", "power-out"] as const)
		assert.deepEqual(checks(["input", driver]), []);
	assert.deepEqual(checks(["power-in", "passive"]), ["undriven-power"]);
	assert.deepEqual(checks(["power-in", "output"]), ["undriven-power"]);
	assert.deepEqual(checks(["power-in", "power-out"]), []);
	assert.deepEqual(checks(["passive", "passive"]), []);
	assert.deepEqual(checks(["bidirectional", "bidirectional"]), []);
});

test("ERC reports one output conflict per net for signal, power and mixed outputs", () => {
	for (const types of [
		["output", "output"],
		["power-out", "power-out"],
		["output", "power-out"],
		["output", "output", "output"],
	] as const) {
		const results = runErc(fixture([...types]), defaultErcRules);
		assert.equal(results.length, 1);
		assert.equal(results[0].ruleId, "conflicting-outputs");
		assert.equal(results[0].severity, "error");
		assert.equal(results[0].subjects.length, types.length);
		assert.deepEqual(results[0].target, { kind: "net", id: "net" });
	}
});

test("ERC flags connected no-connect pins on an in-memory circuit", () => {
	const circuit = fixture(["passive", "passive"]);
	circuit.noConnectPinIds = ["p0"];
	assert.equal(
		runErc(circuit, defaultErcRules)[0].ruleId,
		"connected-no-connect",
	);
});

test("plain custom rules share indexes and support severity overrides and disabling", () => {
	const circuit = fixture(["input", "output"]);
	const before = structuredClone(circuit);
	const custom: ErcRule = {
		id: "custom",
		title: "Custom",
		severity: "warning",
		*check(context) {
			assert.equal(context.pins.size, 2);
			assert.equal(context.netsByPin.get("p0")?.id, "net");
			assert.equal(context.pinsByNet.get("net")?.length, 2);
			yield { message: "Test finding", subjects: [{ kind: "pin", id: "p0" }] };
		},
	};
	const result = runErc(circuit, [custom], { severity: { custom: "error" } });
	assert.equal(result[0].severity, "error");
	assert.deepEqual(
		runErc(circuit, [custom], { severity: { custom: "off" } }),
		[],
	);
	assert.deepEqual(circuit, before);
	assert.throws(() => runErc(circuit, [custom, custom]), /duplicate/);
});

test("diagnostic identities survive net ordering and pin membership ordering", () => {
	const circuit = fixture(["output", "output", "input", "passive"]);
	circuit.nets = [
		{ id: "n1", names: [], pinIds: ["p0", "p1"] },
		{ id: "n2", names: [], pinIds: ["p2", "p3"] },
	];
	const before = runErc(circuit, defaultErcRules).map((item) => item.id);
	circuit.nets.reverse();
	for (const net of circuit.nets) net.pinIds.reverse();
	assert.deepEqual(
		runErc(circuit, defaultErcRules).map((item) => item.id),
		before,
	);
});

test("rule failures propagate instead of returning a clean report", () => {
	assert.throws(
		() =>
			runErc(fixture([]), [
				{
					id: "broken",
					title: "Broken",
					severity: "error",
					check() {
						throw new Error("Broken rule");
					},
				},
			]),
		/Broken rule/,
	);
});

test("severity overrides ignore inherited properties for valid prototype-name rule IDs", () => {
	for (const id of ["constructor", "toString", "__proto__"]) {
		const rule: ErcRule = {
			id,
			title: "Custom",
			severity: "error",
			*check() {
				yield { message: "Test", subjects: [] };
			},
		};
		const circuit = fixture([]);
		assert.equal(
			runErc(circuit, [rule], { severity: {} })[0].severity,
			"error",
		);
		assert.deepEqual(
			runErc(circuit, [rule], { severity: { [id]: "off" } }),
			[],
		);
		assert.equal(
			runErc(circuit, [rule], { severity: { [id]: "warning" } })[0].severity,
			"warning",
		);
	}
});

test("finding codes distinguish violations and duplicate subjects do not change identity", () => {
	const rule: ErcRule = {
		id: "custom",
		title: "Custom",
		severity: "warning",
		*check() {
			yield {
				code: "first",
				message: "First",
				subjects: [
					{ kind: "pin", id: "p0" },
					{ kind: "pin", id: "p0" },
				],
			};
			yield {
				code: "first",
				message: "Same issue",
				subjects: [{ kind: "pin", id: "p0" }],
			};
			yield {
				code: "second",
				message: "Second",
				subjects: [{ kind: "pin", id: "p0" }],
			};
		},
	};
	const results = runErc(fixture(["passive"]), [rule]);
	assert.equal(results.length, 2);
	assert.equal(results[0].subjects.length, 1);
	assert.notEqual(results[0].id, results[1].id);
});

test("net findings keep their identity when an equivalent net receives a new ID", () => {
	for (const types of [
		["output", "output"],
		["input", "passive"],
		["power-in", "passive"],
	] as const) {
		const circuit = fixture([...types]);
		const before = runErc(circuit, defaultErcRules);
		circuit.nets[0].id = "recreated-net";
		const after = runErc(circuit, defaultErcRules);
		assert.equal(after[0].id, before[0].id);
		assert.deepEqual(after[0].target, { kind: "net", id: "recreated-net" });
	}
});

test("diagnostics snapshot reused subject arrays and navigation targets", () => {
	const subjects = [{ kind: "pin" as const, id: "p0" }];
	const target = { kind: "pin" as const, id: "p0" };
	const rule: ErcRule = {
		id: "reuse",
		title: "Reuse",
		severity: "warning",
		*check() {
			yield { message: "First", subjects, target };
			subjects[0].id = "p1";
			target.id = "p1";
			yield { message: "Second", subjects, target };
		},
	};
	const results = runErc(fixture(["passive", "passive"]), [rule]);
	assert.deepEqual(
		results.map((item) => item.subjects[0].id),
		["p0", "p1"],
	);
	assert.deepEqual(
		results.map((item) => item.target?.id),
		["p0", "p1"],
	);
});

test("connected no-connect markers do not suppress missing driver findings", () => {
	for (const type of ["input", "power-in"] as const) {
		const circuit = fixture([type, "passive"]);
		circuit.noConnectPinIds = ["p0"];
		assert.equal(runErc(circuit, defaultErcRules).length, 2);
	}
});

test("errors identify the failed rule and discard findings yielded before failure", () => {
	const cause = new Error("Check failed");
	const rule: ErcRule = {
		id: "project/broken",
		title: "Broken",
		severity: "warning",
		*check() {
			yield { message: "Partial finding", subjects: [] };
			throw cause;
		},
	};
	assert.throws(
		() => runErc(fixture([]), [rule]),
		(error) =>
			error instanceof Error &&
			error.message.includes(rule.id) &&
			error.cause === cause,
	);
});
