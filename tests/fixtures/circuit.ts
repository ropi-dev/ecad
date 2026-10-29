import { type CircuitFile, createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { applyCircuitCommand } from "@ecad/drawing-core/circuit/store.ts";
import { createCircuitComponent } from "@ecad/drawing-core/circuit/parts.ts";

export function createTestCircuit(name = "Test circuit"): CircuitFile {
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
