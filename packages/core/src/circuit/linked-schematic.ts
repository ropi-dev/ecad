import { circuitNetLabels } from "@ecad/drawing-core/circuit/net-labels.ts";
import {
	circuitFileSchema,
	type CircuitFile,
	type CircuitComponent,
} from "@ecad/drawing-core/circuit/model.ts";

import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import { electricalNets } from "#/drawing/named-nets.ts";
import {
	type EditorShape,
	type EditorSymbol,
	type TextShape,
	symbolShapes,
} from "#/drawing/shapes.ts";
import { createSymbol, type SymbolDefinition } from "#/drawing/symbols.ts";
import { font, fontPixels, updateText } from "#/drawing/text.ts";
import type { Point } from "#/drawing/types.ts";
import { measurePerformance } from "#/performance/runtime.ts";

const same = (a: unknown, b: unknown) =>
	JSON.stringify(a, (_key, value) =>
		value && typeof value === "object" && !Array.isArray(value)
			? Object.fromEntries(
					Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
				)
			: value,
	) ===
	JSON.stringify(b, (_key, value) =>
		value && typeof value === "object" && !Array.isArray(value)
			? Object.fromEntries(
					Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
				)
			: value,
	);

export function synchronizePcb(
	file: CircuitFile,
	shapes: EditorShape[],
	previous: CircuitFile | undefined,
	definitions: readonly SymbolDefinition[],
): {
	file: CircuitFile;
	shapes: EditorShape[];
	source: "circuit" | "schematic";
} {
	return measurePerformance(
		"pcb.synchronize",
		() => {
			previous ??= file;
			const previousLabels = circuitNetLabels(previous.circuit);
			const labels = circuitNetLabels(file.circuit);
			shapes = shapes.map((shape) => {
				if (
					shape.kind === "text" &&
					shape.circuitNet &&
					shape.electrical !== "net"
				) {
					const { circuitNet: _binding, ...annotation } = shape;
					return annotation;
				}
				if (shape.kind !== "text" || shape.electrical !== "net") return shape;
				if (shape.circuitNet && shape.text !== shape.circuitNet.label) {
					const { circuitNet: _binding, ...edited } = shape;
					return edited;
				}
				const legacySize =
					shape.fontSize === 1 && shape.width === 5 && shape.height === 2;
				const old = shape.circuitNet
					? file.circuit.nets.find((net) => net.id === shape.circuitNet!.id)
					: previous!.circuit.nets.find(
							(net) =>
								shape.text === `N_${net.id}` ||
								shape.text === previousLabels.get(net.id),
						);
				if (!old || (!shape.circuitNet && old.names.length && !legacySize))
					return shape;
				const text = labels.get(old.id);
				if (!text) return shape;
				const bound = {
					...shape,
					circuitNet: {
						...shape.circuitNet,
						id: old.id,
						label: text,
						pinId:
							shape.circuitNet?.pinId ??
							labelPinId(shape, shapes, file.circuit.components, old.pinIds),
					},
					...(legacySize
						? { fontSize: 1.3, ...labelAlignment(shape, shapes) }
						: {}),
				};
				return text === shape.text && !legacySize
					? bound
					: updateText(bound, text, measureLabelText);
			});
			const initializing =
				file.circuit.components.length > 0 &&
				file.circuit.components.every(
					(component) => component.schematicShapeId === undefined,
				);
			const originalShapes = shapes;
			const originalBindings = new Map(
				originalShapes.flatMap((shape) =>
					shape.kind === "text" && shape.circuitNet
						? [[shape.id, shape.circuitNet.id] as const]
						: [],
				),
			);
			const circuitChanged =
				!same(file.circuit, previous.circuit) ||
				file.circuit.components.some(
					(component) => component.schematicShapeId === undefined,
				);
			const circuit = structuredClone(file.circuit);
			if (circuitChanged) {
				let nextId =
					shapes.reduce((max, shape) => Math.max(max, shape.id), 0) + 1;
				const oldIds = new Set(
					previous.circuit.components.flatMap((component) =>
						component.schematicShapeId === undefined
							? []
							: [component.schematicShapeId],
					),
				);
				const retained = new Set(
					circuit.components.map((component) => component.schematicShapeId),
				);
				shapes = shapes.filter(
					(shape) => !oldIds.has(shape.id) || retained.has(shape.id),
				);
				for (const component of circuit.components) {
					const existing = shapes.find(
						(shape): shape is EditorSymbol =>
							shape.kind === "symbol" &&
							shape.id === component.schematicShapeId,
					);
					if (existing) {
						linkPins(component, existing);
						shapes = shapes.map((shape) =>
							shape === existing
								? {
										...existing,
										attributes: {
											...existing.attributes,
											reference: component.reference,
											value: component.value,
										},
									}
								: shape,
						);
						continue;
					}
					const definition =
						definitions.find(
							(definition) =>
								definition.id === component.part.id &&
								(!component.part.library ||
									same(definition.library, component.part.library)),
						) ?? fallbackDefinition(component);
					component.schematicShapeId = nextId++;
					const symbol = createSymbol(
						component.schematicShapeId,
						definition,
						{
							x:
								30 +
								(shapes.filter((shape) => shape.kind === "symbol").length % 6) *
									30,
							y:
								-30 -
								Math.floor(
									shapes.filter((shape) => shape.kind === "symbol").length / 6,
								) *
									30,
						},
						component.reference,
					);
					linkPins(component, symbol);
					shapes = [
						...shapes,
						{
							...symbol,
							attributes: { ...symbol.attributes, value: component.value },
						},
					];
				}
				if (initializing || !same(circuit.nets, previous.circuit.nets)) {
					const unchanged = new Set(
						circuit.nets
							.filter(
								(net) =>
									!initializing &&
									previous!.circuit.nets.some((old) => same(old, net)),
							)
							.map((net) => net.id),
					);
					const remove = new Set<number>();
					for (const net of electricalNets(originalShapes)) {
						const pinIds = net.pins.flatMap(
							(pin) =>
								previous!.circuit.components
									.find(
										(component) => component.schematicShapeId === pin.shapeId,
									)
									?.pins.find(
										(candidate) => candidate.sourcePinId === String(pin.pinId),
									)?.id ?? [],
						);
						if (
							previous!.circuit.nets.some(
								(old) =>
									!unchanged.has(old.id) &&
									(net.labels.some(
										(id) => originalBindings.get(id) === old.id,
									) ||
										old.pinIds.some((id) => pinIds.includes(id)) ||
										old.names.some((name) => net.names.includes(name)) ||
										net.names.includes(`N_${old.id}`) ||
										net.names.includes(previousLabels.get(old.id)!)),
							)
						) {
							for (const id of [...net.wires, ...net.labels]) remove.add(id);
						}
					}
					shapes = shapes.filter((shape) => !remove.has(shape.id));
					for (const net of circuit.nets.filter(
						(net) => !unchanged.has(net.id),
					)) {
						if (!net.pinIds.length)
							shapes.push(
								createNetLabel(net.id, nextId++, labels.get(net.id)!, {
									x: 200 + circuit.nets.indexOf(net) * 10,
									y: -200,
								}),
							);
						for (const component of circuit.components) {
							const symbol = shapes.find(
								(shape): shape is EditorSymbol =>
									shape.kind === "symbol" &&
									shape.id === component.schematicShapeId,
							);
							if (!symbol) continue;
							for (const pin of component.pins.filter((pin) =>
								net.pinIds.includes(pin.id),
							)) {
								const terminal = symbolShapes(symbol).find(
									(child) =>
										child.kind === "pin" &&
										(String(child.id) === pin.sourcePinId ||
											child.number === pin.number),
								);
								if (!terminal) continue;
								shapes.push(
									createNetLabel(
										net.id,
										nextId++,
										labels.get(net.id)!,
										terminal,
										symbol,
										pin.id,
									),
								);
							}
						}
					}
				}
			} else {
				const components: CircuitComponent[] = [];
				if (
					shapes.some(
						(shape) =>
							shape.kind === "symbol" &&
							!shape.children.length &&
							circuit.components.some(
								(component) => component.schematicShapeId === shape.id,
							),
					)
				)
					throw new Error(
						"Load the missing symbol library before saving the linked PCB.",
					);
				for (const shape of shapes) {
					if (
						shape.kind !== "symbol" ||
						!shape.children.some((child) => child.kind === "pin")
					)
						continue;
					const old = circuit.components.find(
						(component) => component.schematicShapeId === shape.id,
					);
					const component = componentFromSymbol(
						{
							id: shape.definitionId,
							name:
								shape.attributes.name.trim() ||
								definitions.find(
									(definition) => definition.id === shape.definitionId,
								)?.name ||
								shape.definitionId,
							prefix: shape.attributes.reference.replace(/\d+$/, "") || "U",
							value: shape.attributes.value,
							library: shape.library,
							children: shape.children.map((child) => ({
								...child,
								...shape.childOverrides?.[`shape:${child.id}`],
							})),
							texts: shape.texts,
							description: "",
						},
						components,
					);
					component.id = old?.id ?? `${circuit.id}:s${shape.id}`;
					if (old?.part.id === component.part.id)
						component.part = structuredClone(old.part);
					component.pins = component.pins.map((pin) => {
						const existing = old?.pins.find(
							(candidate) => candidate.sourcePinId === pin.sourcePinId,
						);
						const overrides =
							shape.childOverrides?.[`shape:${pin.sourcePinId}`];
						return {
							...pin,
							id: existing?.id ?? `${component.id}:p${pin.sourcePinId}`,
							name: overrides?.name ?? existing?.name ?? pin.name,
							number: overrides?.number ?? existing?.number ?? pin.number,
							electricalType: existing?.electricalType ?? pin.electricalType,
						};
					});
					const pinOrder = new Map(
						old?.pins.map((pin, index) => [pin.id, index]),
					);
					component.pins.sort(
						(a, b) =>
							(pinOrder.get(a.id) ?? Infinity) -
							(pinOrder.get(b.id) ?? Infinity),
					);
					component.schematicShapeId = shape.id;
					component.reference =
						shape.attributes.reference || component.reference;
					component.value = shape.attributes.value;
					components.push(component);
				}
				circuit.components = components;
				const pinId = (shapeId: number, sourceId: number) =>
					components
						.find((component) => component.schematicShapeId === shapeId)
						?.pins.find((pin) => pin.sourcePinId === String(sourceId))?.id;
				const shapeById = new Map(shapes.map((shape) => [shape.id, shape]));
				const bindingUpdates = new Map<number, string>();
				const claimed = new Set<string>();
				circuit.nets = electricalNets(shapes).flatMap((net) => {
					const pinIds = net.pins.flatMap(
						(pin) => pinId(pin.shapeId, pin.pinId) ?? [],
					);
					if (pinIds.length < 2 && !net.names.length) return [];
					const managed = net.labels.flatMap((id) => {
						const shape = shapeById.get(id);
						return shape?.kind === "text" &&
							shape.circuitNet &&
							shape.text === shape.circuitNet.label
							? [shape]
							: [];
					});
					const candidates = file.circuit.nets.filter(
						(candidate) => !claimed.has(candidate.id),
					);
					const old =
						candidates.find((candidate) =>
							managed.some((shape) => shape.circuitNet!.id === candidate.id),
						) ??
						candidates.find((candidate) =>
							net.names.some(
								(name) =>
									name === labels.get(candidate.id) ||
									name === `N_${candidate.id}`,
							),
						) ??
						candidates.find(
							(candidate) =>
								pinIds.length > 0 &&
								same([...candidate.pinIds].sort(), [...pinIds].sort()),
						);
					const id = old?.id ?? globalThis.crypto.randomUUID();
					claimed.add(id);
					const names = net.names.filter(
						(name) =>
							!managed.some((shape) => {
								const source = file.circuit.nets.find(
									(candidate) => candidate.id === shape.circuitNet!.id,
								);
								return source && !source.names.length && shape.text === name;
							}),
					);
					const savedNames =
						old?.names.length && same(names, [old.names[0]])
							? old.names
							: names;
					for (const shape of managed) bindingUpdates.set(shape.id, id);
					return [
						{
							id,
							names: savedNames,
							pinIds: [
								...(old?.pinIds.filter((id) => pinIds.includes(id)) ?? []),
								...pinIds.filter((id) => !old?.pinIds.includes(id)),
							],
						},
					];
				});
				shapes = shapes.map((shape) =>
					shape.kind === "text" &&
					shape.circuitNet &&
					bindingUpdates.has(shape.id)
						? {
								...shape,
								circuitNet: {
									...shape.circuitNet,
									id: bindingUpdates.get(shape.id)!,
								},
							}
						: shape,
				);
				const order = new Map(
					file.circuit.nets.map((net, index) => [net.id, index]),
				);
				circuit.nets.sort(
					(a, b) =>
						(order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity),
				);
				const connected = new Set(circuit.nets.flatMap((net) => net.pinIds));
				const pins = new Set(
					components.flatMap((component) =>
						component.pins.map((pin) => pin.id),
					),
				);
				circuit.noConnectPinIds = circuit.noConnectPinIds.filter(
					(id) => pins.has(id) && !connected.has(id),
				);
				if (
					!same({ ...circuit, revision: file.circuit.revision }, file.circuit)
				)
					circuit.revision++;
			}
			shapes = shapes.filter((shape) => {
				if (shape.kind !== "text" || !shape.circuitNet) return true;
				const net = circuit.nets.find((net) => net.id === shape.circuitNet!.id);
				return (
					net !== undefined &&
					(!shape.circuitNet.pinId ||
						net.pinIds.includes(shape.circuitNet.pinId))
				);
			});
			const refreshedLabels = circuitNetLabels(circuit);
			shapes = shapes.map((shape) => {
				if (
					shape.kind !== "text" ||
					!shape.circuitNet ||
					shape.text !== shape.circuitNet.label
				)
					return shape;
				const text = refreshedLabels.get(shape.circuitNet.id);
				if (!text || text === shape.text) return shape;
				return updateText(
					{ ...shape, circuitNet: { ...shape.circuitNet, label: text } },
					text,
					measureLabelText,
				);
			});
			const ids = new Set(
				[...circuit.components, ...circuit.nets].map((entity) => entity.id),
			);
			return {
				file: circuitFileSchema.parse({
					circuit,
					graph: {
						...file.graph,
						positions: file.graph.positions.filter((position) =>
							ids.has(position.id),
						),
						collapsedComponentIds: file.graph.collapsedComponentIds?.filter(
							(id) => ids.has(id),
						),
					},
				}),
				shapes,
				source: circuitChanged ? "circuit" : "schematic",
			};
		},
		{ components: file.circuit.components.length, shapes: shapes.length },
	);
}

function fallbackDefinition(component: CircuitComponent): SymbolDefinition {
	return {
		id: component.part.id,
		name: component.part.name,
		library: component.part.library,
		prefix: component.reference.replace(/\d+$/, ""),
		value: component.value,
		description: "",
		texts: [{ attribute: "reference", x: 0, y: 3, fontSize: 1.5 }],
		children: component.pins.map((pin, index) => ({
			id: Number(pin.sourcePinId) || index + 1,
			kind: "pin",
			name: pin.name,
			number: pin.number,
			x: -5,
			y: -index * 2.5,
			width: 1,
			height: 1,
			rotation: 0,
			lineWidth: 0.25,
			length: 2,
		})),
	};
}

function linkPins(component: CircuitComponent, symbol: EditorSymbol) {
	const pins = symbol.children.filter((child) => child.kind === "pin");
	component.pins.forEach((pin, index) => {
		if (pin.sourcePinId) return;
		const source =
			pins.find(
				(child) =>
					child.number === pin.number ||
					child.name === pin.number ||
					(pin.name && child.name === pin.name),
			) ?? pins[index];
		if (source) pin.sourcePinId = String(source.id);
	});
}

let labelMeasureContext:
	| OffscreenCanvasRenderingContext2D
	| CanvasRenderingContext2D
	| null = null;
function measureLabelText(text: string): number {
	if (!labelMeasureContext) {
		if (typeof OffscreenCanvas !== "undefined")
			labelMeasureContext = new OffscreenCanvas(1, 1).getContext("2d");
		else if (typeof document !== "undefined")
			labelMeasureContext = document.createElement("canvas").getContext("2d");
	}
	if (!labelMeasureContext) return text.length * fontPixels * 0.6;
	labelMeasureContext.font = font;
	return labelMeasureContext.measureText(text).width;
}

function labelAlignment(point: Point, shapes: readonly EditorShape[]) {
	const symbol = shapes.find(
		(shape): shape is EditorSymbol =>
			shape.kind === "symbol" &&
			symbolShapes(shape).some(
				(child) =>
					child.kind === "pin" &&
					Math.hypot(child.x - point.x, child.y - point.y) < 1e-4,
			),
	);
	return alignmentAtPin(point, symbol);
}

function alignmentAtPin(
	point: Point,
	symbol?: EditorSymbol,
): Pick<TextShape, "horizontalAlign" | "verticalAlign"> {
	if (!symbol) return { horizontalAlign: "left", verticalAlign: "bottom" };
	const dx = point.x - symbol.x,
		dy = point.y - symbol.y;
	if (Math.abs(dx) >= Math.abs(dy))
		return {
			horizontalAlign: dx < 0 ? "right" : "left",
			verticalAlign: "bottom",
		};
	return {
		horizontalAlign: "center",
		verticalAlign: dy < 0 ? "top" : "bottom",
	};
}

function createNetLabel(
	netId: string,
	id: number,
	text: string,
	point: Point,
	symbol?: EditorSymbol,
	pinId?: string,
): TextShape {
	return updateText(
		{
			id,
			kind: "text",
			electrical: "net",
			circuitNet: { id: netId, label: text, ...(pinId ? { pinId } : {}) },
			x: point.x,
			y: point.y,
			rotation: 0,
			width: 1,
			height: 1,
			fontSize: 1.3,
			lineWidth: 0.2,
			text,
			...alignmentAtPin(point, symbol),
		},
		text,
		measureLabelText,
	);
}

function labelPinId(
	point: Point,
	shapes: readonly EditorShape[],
	components: readonly CircuitComponent[],
	pinIds: readonly string[],
): string | undefined {
	if (!pinIds.length) return;
	for (const shape of shapes) {
		if (shape.kind !== "symbol") continue;
		const component = components.find(
			(component) => component.schematicShapeId === shape.id,
		);
		if (!component) continue;
		for (const child of symbolShapes(shape)) {
			if (
				child.kind !== "pin" ||
				Math.hypot(child.x - point.x, child.y - point.y) > 1e-4
			)
				continue;
			const pin = component.pins.find(
				(pin) =>
					pin.sourcePinId === String(child.id) && pinIds.includes(pin.id),
			);
			if (pin) return pin.id;
		}
	}
}
