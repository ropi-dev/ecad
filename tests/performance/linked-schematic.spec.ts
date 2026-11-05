import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";

const twoPinParts = 240;
const connectors = 60;
const repeats = 5;

test(
	"linked-schematic-sync",
	{ tag: ["@circuit"] },
	async ({ browserName: _browserName }, testInfo) => {
		const { circuitFileSchema, createCircuit } = await import(
			"@ecad/drawing-core/circuit/model.ts"
		);
		const { applyCircuitCommand } = await import(
			"@ecad/drawing-core/circuit/store.ts"
		);
		const { synchronizePcb } = await import("#/circuit/linked-schematic.ts");
		const { componentFromSymbol } = await import(
			"#/circuit/symbol-components.ts"
		);
		const { symbolDefinitions } = await import("#/drawing/symbols.ts");
		const definition = (id: string) =>
			required(symbolDefinitions.find((definition) => definition.id === id));
		const resistor = definition("resistor");
		const capacitor = definition("capacitor");
		const connector = definition("connector-8");
		const components: ReturnType<typeof componentFromSymbol>[] = [];
		for (let index = 0; index < twoPinParts; index++)
			components.push(
				componentFromSymbol(index % 3 ? resistor : capacitor, components),
			);
		for (let index = 0; index < connectors; index++)
			components.push(componentFromSymbol(connector, components));
		const parts = components.slice(0, twoPinParts);
		const headers = components.slice(twoPinParts);
		const nets = [
			...parts.slice(1).map((part, index) => ({
				id: `chain-${index}`,
				names: index % 10 ? [] : [`SIG_${index}`],
				pinIds: [parts[index].pins[1].id, part.pins[0].id],
			})),
			{
				id: "vcc",
				names: ["VCC"],
				pinIds: headers.map((header) => header.pins[0].id),
			},
			{
				id: "gnd",
				names: ["GND"],
				pinIds: headers.map((header) => header.pins[7].id),
			},
			...headers.flatMap((header, index) =>
				index % 2
					? [1, 2, 3, 4, 5, 6].map((pin) => ({
							id: `bus-${index}-${pin}`,
							names: [],
							pinIds: [headers[index - 1].pins[pin].id, header.pins[pin].id],
						}))
					: [],
			),
		];
		const empty = createCircuit("Large linked schematic", "pcb-main");
		const file = circuitFileSchema.parse({
			...empty,
			circuit: { ...empty.circuit, components, nets },
		});
		const metrics: Record<string, number> = {};
		const time = <T>(run: () => T): [T, number] => {
			const start = performance.now();
			const result = run();
			return [result, performance.now() - start];
		};
		const p95 = (values: number[]) =>
			[...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];

		const [placed, placeMs] = time(() =>
			synchronizePcb(file, [], undefined, symbolDefinitions),
		);
		metrics.placeMs = placeMs;
		expect(placed.source).toBe("circuit");
		expect(placed.file.circuit.components).toHaveLength(components.length);
		expect(placed.file.circuit.nets).toHaveLength(nets.length);
		const symbols = placed.shapes.filter((shape) => shape.kind === "symbol");
		expect(symbols).toHaveLength(components.length);

		const saves: number[] = [];
		let saved = placed;
		for (let index = 0; index < repeats; index++) {
			const [next, ms] = time(() =>
				synchronizePcb(saved.file, saved.shapes, saved.file, symbolDefinitions),
			);
			saves.push(ms);
			expect(next.source).toBe("schematic");
			expect(next.file.circuit.nets).toEqual(saved.file.circuit.nets);
			saved = next;
		}
		metrics.saveP95Ms = p95(saves);

		const circuitEdits: number[] = [];
		for (let index = 0; index < repeats; index++) {
			const net = saved.file.circuit.nets[index * 7];
			const renamed = applyCircuitCommand(saved.file, {
				type: "rename-net",
				id: net.id,
				names: [`RENAMED_${index}`],
			});
			const [next, ms] = time(() =>
				synchronizePcb(renamed, saved.shapes, saved.file, symbolDefinitions),
			);
			circuitEdits.push(ms);
			expect(next.source).toBe("circuit");
			expect(
				next.file.circuit.nets.find((candidate) => candidate.id === net.id)
					?.names,
			).toEqual([`RENAMED_${index}`]);
			saved = next;
		}
		metrics.circuitEditP95Ms = p95(circuitEdits);

		const schematicEdits: number[] = [];
		for (let index = 0; index < repeats; index++) {
			const target = symbols[index * 11].id;
			const edited = saved.shapes.map((shape) =>
				shape.kind === "symbol" && shape.id === target
					? {
							...shape,
							attributes: { ...shape.attributes, value: `${index}k` },
						}
					: shape,
			);
			const [next, ms] = time(() =>
				synchronizePcb(saved.file, edited, saved.file, symbolDefinitions),
			);
			schematicEdits.push(ms);
			expect(next.source).toBe("schematic");
			expect(next.file.circuit.revision).toBe(saved.file.circuit.revision + 1);
			saved = next;
		}
		metrics.schematicEditP95Ms = p95(schematicEdits);

		await testInfo.attach("performance", {
			body: JSON.stringify({
				scenario: "linked-schematic-sync",
				metrics,
				report: {
					mode: process.env.ECAD_PERF_MODE ?? "production",
					environment: {
						userAgent: `Node/${process.versions.node}`,
						platform: process.platform,
						arch: process.arch,
						cpuThrottle: 1,
					},
					workload: {
						components: components.length,
						pins: components.reduce(
							(count, component) => count + component.pins.length,
							0,
						),
						nets: nets.length,
						shapes: placed.shapes.length,
					},
				},
			}),
			contentType: "application/json",
		});
	},
);
