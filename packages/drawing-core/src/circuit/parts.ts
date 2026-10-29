import {
	type CircuitComponent,
	type CircuitFile,
	type CircuitPin,
	circuitComponentSchema,
	createCircuit,
} from "./model.ts";
import { applyCircuitCommand } from "./store.ts";

export const circuitParts = [
	{
		id: "connector-2",
		name: "2-pin connector",
		prefix: "J",
		value: "Supply input",
		pins: [
			["1", "+", "passive"],
			["2", "−", "passive"],
		],
	},
	{
		id: "resistor",
		name: "Resistor",
		prefix: "R",
		value: "330 Ω",
		pins: [
			["1", "", "passive"],
			["2", "", "passive"],
		],
	},
	{
		id: "led",
		name: "LED",
		prefix: "D",
		value: "LED",
		pins: [
			["A", "Anode", "passive"],
			["K", "Cathode", "passive"],
		],
	},
	{
		id: "capacitor",
		name: "Capacitor",
		prefix: "C",
		value: "100 nF",
		pins: [
			["1", "", "passive"],
			["2", "", "passive"],
		],
	},
	{
		id: "connector-8",
		name: "8-pin connector",
		prefix: "J",
		value: "Connector",
		pins: Array.from({ length: 8 }, (_, index) => [
			String(index + 1),
			"",
			"passive",
		]),
	},
] as const;

export interface CircuitPartDefinition {
	id: string;
	name: string;
	prefix: string;
	value: string;
	library?: CircuitComponent["part"]["library"];
	revision?: string;
	pins: {
		name: string;
		number: string;
		sourcePinId?: string;
		electricalType?: CircuitPin["electricalType"];
	}[];
}

export function instantiateCircuitPart(
	part: CircuitPartDefinition,
	components: readonly CircuitComponent[],
): CircuitComponent {
	const prefix = part.prefix.trim() || "U";
	const references = new Set(
		components.map((component) => component.reference),
	);
	let suffix = 1;
	while (references.has(`${prefix}${suffix}`)) suffix++;
	return circuitComponentSchema.parse({
		id: globalThis.crypto.randomUUID(),
		reference: `${prefix}${suffix}`,
		value: part.value,
		part: {
			id: part.id,
			name: part.name,
			...(part.library ? { library: part.library } : {}),
			...(part.revision ? { revision: part.revision } : {}),
		},
		pins: part.pins.map((pin, index) => ({
			...pin,
			id: globalThis.crypto.randomUUID(),
			number: pin.number.trim() || String(index + 1),
			electricalType: pin.electricalType ?? "passive",
		})),
	});
}

export function createCircuitComponent(
	partId: string,
	components: readonly CircuitComponent[],
): CircuitComponent {
	const part = circuitParts.find((part) => part.id === partId);
	if (!part) throw new Error("Unknown circuit part.");
	return instantiateCircuitPart(
		{
			...part,
			revision: "1",
			pins: part.pins.map(([number, name]) => ({ number, name })),
		},
		components,
	);
}

export function createLedCircuit(name = "LED circuit"): CircuitFile {
	let file = createCircuit(name);
	for (const part of ["connector-2", "resistor", "led", "resistor", "led"])
		file = applyCircuitCommand(file, {
			type: "add-component",
			component: createCircuitComponent(part, file.circuit.components),
		});
	const [connector, resistor, led, secondResistor, secondLed] =
		file.circuit.components;
	for (const [name, pinIds] of [
		[
			"3V3",
			[connector.pins[0].id, resistor.pins[0].id, secondResistor.pins[0].id],
		],
		["LED_DRIVE", [resistor.pins[1].id, led.pins[0].id]],
		["GND", [connector.pins[1].id, led.pins[1].id, secondLed.pins[1].id]],
		["LED2_DRIVE", [secondResistor.pins[1].id, secondLed.pins[0].id]],
	] as const) {
		file = applyCircuitCommand(file, { type: "connect", pinIds: [...pinIds] });
		file = applyCircuitCommand(file, {
			type: "rename-net",
			id: file.circuit.nets[file.circuit.nets.length - 1].id,
			names: [name],
		});
	}
	file.graph.positions = [
		...[
			{ component: connector, x: 60, y: 200 },
			{ component: resistor, x: 400, y: 80 },
			{ component: led, x: 740, y: 80 },
			{ component: secondResistor, x: 400, y: 340 },
			{ component: secondLed, x: 740, y: 340 },
		].map(({ component, x, y }) => ({
			id: component.id,
			kind: "component" as const,
			x,
			y,
		})),
		{ id: file.circuit.nets[0].id, kind: "net", x: 330, y: 284 },
		{ id: file.circuit.nets[1].id, kind: "net", x: 670, y: 179 },
		{ id: file.circuit.nets[2].id, kind: "net", x: 1010, y: 324 },
		{ id: file.circuit.nets[3].id, kind: "net", x: 670, y: 439 },
	];
	return file;
}
