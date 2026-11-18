import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type CircuitPin,
	createCircuit,
} from "@ecad/drawing-core/circuit/model.ts";
import { type ErcRule, runErc } from "@ecad/drawing-core/erc/engine.ts";
import {
	defaultErcRules,
	duplicatePinNetsRule,
	groundPinRule,
	multipleNetNamesRule,
	pinTypeConflictRule,
	pinTypeWarningRule,
	similarNameKey,
	similarNetNamesRule,
} from "@ecad/drawing-core/erc/rules.ts";

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
	for (const driver of [
		"output",
		"bidirectional",
		"tri-state",
		"passive",
		"power-out",
		"open-collector",
		"open-emitter",
	] as const)
		assert.deepEqual(checks(["input", driver]), []);
	for (const other of ["input", "free"] as const)
		assert.deepEqual(checks(["input", other]), ["undriven-input"]);
	assert.deepEqual(checks(["input", "unspecified"]), [
		"pin-type-warning",
		"undriven-input",
	]);
	assert.deepEqual(checks(["power-in", "passive"]), ["undriven-power"]);
	assert.deepEqual(checks(["power-in", "output"]), ["undriven-power"]);
	assert.deepEqual(checks(["power-in", "power-out"]), []);
	assert.deepEqual(checks(["passive", "passive"]), []);
	assert.deepEqual(checks(["bidirectional", "bidirectional"]), []);
});

test("ERC treats same-name outputs of one component as one output", () => {
	const circuit = fixture(["power-out", "power-out"]);
	const [regulator, other] = circuit.components;
	regulator.pins.push({ ...other.pins[0], name: "OUT" });
	regulator.pins[0].name = "OUT";
	circuit.components = [regulator];
	assert.deepEqual(runErc(circuit, defaultErcRules), []);
	regulator.pins[0].name = "~";
	regulator.pins[1].name = "~";
	assert.deepEqual(
		runErc(circuit, defaultErcRules).map((item) => item.ruleId),
		["pin-type-conflict"],
	);
	regulator.pins[0].name = "OUT";
	regulator.pins[1].name = "OUT2";
	assert.deepEqual(
		runErc(circuit, defaultErcRules).map((item) => item.ruleId),
		["pin-type-conflict"],
	);
});

test("ERC treats a supply symbol on the net as the power source", () => {
	const circuit = fixture(["power-in", "passive"]);
	circuit.nets[0].schematicShapeIds = [7];
	assert.deepEqual(runErc(circuit, defaultErcRules), []);
});

test("ERC exempts Unconnected-type pins from wiring and flags them when wired", () => {
	assert.deepEqual(checks(["no-connect"], false), []);
	assert.deepEqual(checks(["no-connect", "passive"]), ["connected-no-connect"]);
});

test("ERC reports one pin type conflict per net for signal, power and mixed outputs", () => {
	for (const types of [
		["output", "output"],
		["power-out", "power-out"],
		["output", "power-out"],
		["output", "output", "output"],
	] as const) {
		const results = runErc(fixture([...types]), defaultErcRules);
		assert.equal(results.length, 1);
		assert.equal(results[0].ruleId, "pin-type-conflict");
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
	assert.throws(() => runErc(circuit, [custom, custom]), /\bcustom\b/);
});

test("ERC applies KiCad's pin conflict matrix", () => {
	const severity = (
		a: CircuitPin["electricalType"],
		b: CircuitPin["electricalType"],
	) =>
		runErc(fixture([a, b]), [pinTypeConflictRule, pinTypeWarningRule]).map(
			(item) => item.severity,
		);
	assert.deepEqual(severity("output", "open-collector"), ["error"]);
	assert.deepEqual(severity("tri-state", "power-out"), ["error"]);
	assert.deepEqual(severity("output", "tri-state"), ["warning"]);
	assert.deepEqual(severity("bidirectional", "power-out"), ["warning"]);
	assert.deepEqual(severity("tri-state", "power-in"), ["warning"]);
	assert.deepEqual(severity("unspecified", "passive"), ["warning"]);
	assert.deepEqual(severity("open-collector", "open-collector"), []);
	assert.deepEqual(severity("free", "unspecified"), []);
	assert.deepEqual(severity("input", "input"), []);
	const [result] = runErc(fixture(["output", "output", "tri-state"]), [
		pinTypeConflictRule,
		pinTypeWarningRule,
	]);
	assert.equal(result.ruleId, "pin-type-conflict");
	assert.deepEqual(
		result.subjects.map((subject) => subject.id),
		["p0", "p1"],
	);
});

test("ERC exempts Free pins from the unconnected check", () => {
	assert.deepEqual(checks(["free"], false), []);
});

test("ERC reports one pin number on several nets", () => {
	const circuit = fixture(["passive", "passive"]);
	const [part, other] = circuit.components;
	part.pins.push({
		id: "p0b",
		name: "",
		number: "1",
		electricalType: "passive",
	});
	other.pins.push({
		id: "p1b",
		name: "",
		number: "2",
		electricalType: "passive",
	});
	circuit.nets.push({ id: "net2", names: ["OTHER"], pinIds: ["p0b", "p1b"] });
	const [result] = runErc(circuit, [duplicatePinNetsRule]);
	assert.deepEqual(
		result.subjects.map((subject) => subject.id),
		["p0", "p0b"],
	);
});

test("ERC reports a ground pin off the ground net of its part", () => {
	const circuit = createCircuit("Ground", "circuit").circuit;
	const pin = (id: string, name: string): CircuitPin => ({
		id,
		name,
		number: id,
		electricalType: "power-in",
	});
	circuit.components = [
		{
			id: "u1",
			reference: "U1",
			value: "",
			part: { id: "mcu", name: "MCU" },
			pins: [pin("1", "GND"), pin("2", "AGND"), pin("3", "VCC")],
		},
	];
	circuit.nets = [
		{ id: "gnd", names: ["GND"], pinIds: ["1"] },
		{ id: "vcc", names: ["VCC"], pinIds: ["2", "3"] },
	];
	const results = runErc(circuit, [groundPinRule]);
	assert.deepEqual(
		results.map((item) => item.subjects[0].id),
		["2"],
	);
	circuit.nets[0].names = ["0V"];
	assert.deepEqual(runErc(circuit, [groundPinRule]), []);
});

test("ERC reports nets with several or similar names", () => {
	const circuit = fixture(["passive", "passive"]);
	circuit.nets[0].names = ["A", "B"];
	assert.deepEqual(
		runErc(circuit, [multipleNetNamesRule]).map((item) => item.subjects),
		[[{ kind: "net", id: "net" }]],
	);
	for (const [first, second] of [
		["GND", "gnd"],
		["+5V", "5v"],
		["10µ", "10u"],
		["+1,8V", "1,8V"],
	])
		assert.equal(similarNameKey(first), similarNameKey(second));
	assert.notEqual(similarNameKey("µC_RX"), similarNameKey("uC_RX"));
	assert.equal(similarNameKey("+5V."), similarNameKey("5v."));
	assert.notEqual(similarNameKey("VCC"), similarNameKey("VDD"));
	assert.notEqual(similarNameKey("3V3"), similarNameKey("5V"));
	circuit.nets[0].names = ["VCC"];
	circuit.nets.push({ id: "other", names: ["vcc"], pinIds: [] });
	const [result] = runErc(circuit, [similarNetNamesRule]);
	assert.deepEqual(result.subjects, [
		{ kind: "net", id: "net" },
		{ kind: "net", id: "other" },
	]);
});
