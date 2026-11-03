import {
	type Circuit,
	type CircuitComponent,
	type CircuitFile,
	type CircuitNet,
	type CircuitPin,
	circuitFileSchema,
} from "@ecad/drawing-core/circuit/model.ts";
import { circuitNetLabels } from "@ecad/drawing-core/circuit/net-labels.ts";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import { type ElectricalNet, electricalNets } from "#/drawing/named-nets.ts";
import {
	DEFAULT_LINE_WIDTH,
	type EditorShape,
	type EditorSymbol,
	type SymbolShape,
	shapeBounds,
	symbolShapes,
	type TextShape,
} from "#/drawing/shapes.ts";
import { createSymbol, type SymbolDefinition } from "#/drawing/symbols.ts";
import { fontPixels, type MeasureText, updateText } from "#/drawing/text.ts";
import type { Bounds, Point } from "#/drawing/types.ts";
import {
	DEFAULT_PIN_LENGTH,
	DEFAULT_TEXT_SIZE,
	fromMils,
	SYMBOL_TEXT_SIZE,
} from "#/drawing/units.ts";
import { measurePerformance } from "#/performance/runtime.ts";

const fallbackPrefix = "circuit-fallback.";
const terminalTolerance = 1e-4;

/** Platform services that synchronization needs. Inject them to make the output deterministic. */
export interface LinkedSchematicEnvironment {
	/** Measures one line of net label text in font pixels. */
	measureText: MeasureText;
	/** Creates identities for new circuit nets and fallback symbol definitions. */
	newId: () => string;
}

/** Estimates net label width from its length, for use when no canvas is available. */
export const estimateLabelTextWidth: MeasureText = (text) =>
	text.length * fontPixels * 0.6;

/** Thrown when a linked component's symbol definition is not loaded, so its pins are unknown. */
export class MissingSymbolLibraryError extends Error {
	constructor() {
		super("Load the missing symbol library before saving the linked PCB.");
		this.name = "MissingSymbolLibraryError";
	}
}

interface SyncContext {
	file: CircuitFile;
	previous: CircuitFile;
	definitions: DefinitionIndex;
	/** Labels of the incoming circuit's nets. */
	labels: ReadonlyMap<string, string>;
	/** Labels of the previously saved circuit's nets. */
	previousLabels: ReadonlyMap<string, string>;
	measureText: MeasureText;
	newId: () => string;
}

/**
 * Reconciles a circuit with its linked schematic.
 *
 * When the circuit changed since `previous`, the circuit is written into the
 * schematic. Otherwise the schematic is read back into the circuit.
 */
export function synchronizePcb(
	file: CircuitFile,
	shapes: EditorShape[],
	previous: CircuitFile | undefined,
	definitions: readonly SymbolDefinition[],
	environment: Partial<LinkedSchematicEnvironment> = {},
): {
	file: CircuitFile;
	shapes: EditorShape[];
	source: "circuit" | "schematic";
} {
	return measurePerformance(
		"pcb.synchronize",
		() => {
			const imported =
				previous === undefined &&
				(file.circuit.components.length > 0 || file.circuit.nets.length > 0);
			const base = previous ?? file;
			const context: SyncContext = {
				file,
				previous: base,
				definitions: indexDefinitions(definitions),
				labels: circuitNetLabels(file.circuit),
				previousLabels: circuitNetLabels(base.circuit),
				measureText: environment.measureText ?? estimateLabelTextWidth,
				newId: environment.newId ?? (() => globalThis.crypto.randomUUID()),
			};
			const bound = bindNetLabels(shapes, context);
			const unplaced = file.circuit.components.some(
				(component) => component.schematicShapeId === undefined,
			);
			const circuitChanged =
				imported || !jsonEqual(file.circuit, base.circuit) || unplaced;
			const circuit = structuredClone(file.circuit);
			const linked = circuitChanged
				? placeCircuitInSchematic(
						circuit,
						bound,
						context,
						imported ||
							(file.circuit.components.length > 0 &&
								file.circuit.components.every(
									(component) => component.schematicShapeId === undefined,
								)),
					)
				: extractCircuitFromSchematic(circuit, bound, context);
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
				shapes: refreshLabels(circuit, linked, context.measureText),
				source: circuitChanged ? "circuit" : "schematic",
			};
		},
		{ components: file.circuit.components.length, shapes: shapes.length },
	);
}

/**
 * Binds net labels to circuit nets. Labels whose text was edited, or that are
 * no longer net labels, lose their binding. Bound labels take the current
 * automatic label text.
 */
function bindNetLabels(
	shapes: readonly EditorShape[],
	context: SyncContext,
): EditorShape[] {
	const { file, previous, labels, previousLabels, measureText } = context;
	const nets = firstById(file.circuit.nets);
	const previousNetsByLabel = new Map<string, CircuitNet>();
	for (const net of previous.circuit.nets) {
		const label = previousLabels.get(net.id);
		if (label !== undefined && !previousNetsByLabel.has(label))
			previousNetsByLabel.set(label, net);
	}
	let terminals: CircuitTerminal[] | undefined;
	const terminalsAtPins = () => {
		terminals ??= circuitTerminals(shapes, file.circuit.components);
		return terminals;
	};
	return shapes.map((shape) => {
		if (shape.kind !== "text") return shape;
		if (shape.circuitNet && shape.electrical !== "net") {
			const { circuitNet: _binding, ...annotation } = shape;
			return annotation;
		}
		if (shape.electrical !== "net") return shape;
		if (shape.circuitNet && shape.text !== shape.circuitNet.label) {
			const { circuitNet: _binding, ...edited } = shape;
			return edited;
		}
		const old = shape.circuitNet
			? nets.get(shape.circuitNet.id)
			: previousNetsByLabel.get(shape.text);
		if (!old || (!shape.circuitNet && old.names.length)) return shape;
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
					labelPinId(shape, terminalsAtPins(), old.pinIds),
			},
		};
		return text === shape.text ? bound : updateText(bound, text, measureText);
	});
}

/** Writes circuit changes into the schematic. */
function placeCircuitInSchematic(
	circuit: Circuit,
	shapes: EditorShape[],
	context: SyncContext,
	initializing: boolean,
): EditorShape[] {
	const placed = placeComponentSymbols(circuit, shapes, context);
	if (!initializing && jsonEqual(circuit.nets, context.previous.circuit.nets))
		return placed.shapes;
	return placeNetLabels(
		circuit,
		placed.shapes,
		shapes,
		placed.nextId,
		context,
		initializing,
	);
}

/**
 * Removes symbols of deleted components, updates the attributes of existing
 * ones and places a generated symbol for each component without one.
 */
function placeComponentSymbols(
	circuit: Circuit,
	shapes: readonly EditorShape[],
	context: SyncContext,
): { shapes: EditorShape[]; nextId: number } {
	let nextId = shapes.reduce((max, shape) => Math.max(max, shape.id), 0) + 1;
	const oldIds = new Set(
		context.previous.circuit.components.flatMap(componentShapeIds),
	);
	const retained = new Set(circuit.components.flatMap(componentShapeIds));
	const placed = shapes.filter(
		(shape) => !oldIds.has(shape.id) || retained.has(shape.id),
	);
	const symbolPositions = new Map<number, number[]>();
	const addSymbolPosition = (shape: EditorShape, position: number) => {
		if (shape.kind !== "symbol") return;
		const positions = symbolPositions.get(shape.id);
		if (positions) positions.push(position);
		else symbolPositions.set(shape.id, [position]);
	};
	placed.forEach(addSymbolPosition);
	let layout: SymbolLayout | undefined;
	for (const component of circuit.components) {
		const units = [
			...new Set(
				componentShapeIds(component).flatMap(
					(id) => symbolPositions.get(id) ?? [],
				),
			),
		].sort((a, b) => a - b);
		if (units.length) {
			for (const position of units)
				linkPins(component, placed[position] as EditorSymbol);
			for (const position of units) {
				const symbol = placed[position] as EditorSymbol;
				placed[position] = {
					...symbol,
					attributes: {
						...symbol.attributes,
						reference: component.reference,
						value: component.value,
					},
				};
			}
			continue;
		}
		const known = context.definitions.last(
			component.part.id,
			component.part.library,
		);
		const definition = known ?? fallbackDefinition(component, context.newId);
		component.schematicShapeId = nextId++;
		delete component.schematicShapeIds;
		layout ??= symbolLayout(placed);
		const symbol = layout.place(
			createSymbol(
				component.schematicShapeId,
				definition,
				{ x: 0, y: 0 },
				component.reference,
			),
		);
		if (!known) {
			const pins = symbol.children.filter((child) => child.kind === "pin");
			component.pins.forEach((pin, index) => {
				delete pin.schematicShapeId;
				pin.sourcePinId = String(pins[index].id);
			});
		}
		linkPins(component, symbol);
		const generated = {
			...symbol,
			attributes: { ...symbol.attributes, value: component.value },
		};
		addSymbolPosition(generated, placed.length);
		placed.push(generated);
		layout.add(generated);
	}
	return { shapes: placed, nextId };
}

/**
 * Replaces the labels of nets the circuit changed. Wires and labels of the
 * matching schematic nets are removed, and net symbols take the names of the
 * nets they now belong to.
 */
function placeNetLabels(
	circuit: Circuit,
	shapes: EditorShape[],
	originalShapes: readonly EditorShape[],
	nextId: number,
	context: SyncContext,
	initializing: boolean,
): EditorShape[] {
	const { labels, measureText } = context;
	const unchanged = initializing
		? new Set<string>()
		: unchangedNetIds(circuit.nets, context.previous.circuit.nets);
	const { remove, symbolNames } = reconcileSchematicNets(
		circuit,
		originalShapes,
		unchanged,
		context,
	);
	const next = shapes
		.filter((shape) => !remove.has(shape.id))
		.map((shape) => {
			const name = symbolNames.get(shape.id);
			return shape.kind === "symbol" && name !== undefined
				? { ...shape, attributes: { ...shape.attributes, name } }
				: shape;
		});
	const symbols = new Map<number, EditorSymbol>();
	for (const shape of next)
		if (shape.kind === "symbol" && !symbols.has(shape.id))
			symbols.set(shape.id, shape);
	const terminals = new Map<EditorSymbol, SymbolTerminals>();
	const members = netMembers(circuit.components);
	circuit.nets.forEach((net, index) => {
		if (unchanged.has(net.id)) return;
		if (!net.pinIds.length)
			next.push(
				createNetLabel(
					net.id,
					nextId++,
					labels.get(net.id)!,
					{ x: 200 + index * 10, y: -200 },
					measureText,
				),
			);
		for (const { component, pin } of members(net)) {
			const shapeId = pin.schematicShapeId ?? component.schematicShapeId;
			const symbol = shapeId === undefined ? undefined : symbols.get(shapeId);
			if (!symbol) continue;
			let symbolTerminals = terminals.get(symbol);
			if (!symbolTerminals) {
				symbolTerminals = indexTerminals(symbol);
				terminals.set(symbol, symbolTerminals);
			}
			const terminal = symbolTerminals.find(pin);
			if (!terminal) continue;
			next.push(
				createNetLabel(
					net.id,
					nextId++,
					labels.get(net.id)!,
					terminal,
					measureText,
					symbol,
					pin.id,
				),
			);
		}
	});
	return next;
}

/** Ids of nets that equal a net of the previous circuit. */
function unchangedNetIds(
	nets: readonly CircuitNet[],
	previousNets: readonly CircuitNet[],
): Set<string> {
	const previousById = groupBy(previousNets, (net) => net.id);
	return new Set(
		nets
			.filter((net) =>
				(previousById.get(net.id) ?? []).some((old) => jsonEqual(old, net)),
			)
			.map((net) => net.id),
	);
}

/**
 * Matches the schematic's nets to changed nets of the previous circuit. Returns
 * the wires and labels to remove, and the new name of each affected net symbol.
 */
function reconcileSchematicNets(
	circuit: Circuit,
	shapes: readonly EditorShape[],
	unchanged: ReadonlySet<string>,
	context: SyncContext,
): { remove: Set<number>; symbolNames: Map<number, string> } {
	const previousNets = context.previous.circuit.nets;
	const remove = new Set<number>();
	const symbolNames = new Map<number, string>();
	const bindings = new Map(
		shapes.flatMap((shape) =>
			shape.kind === "text" && shape.circuitNet
				? [[shape.id, shape.circuitNet.id] as const]
				: [],
		),
	);
	const netSymbols = new Map(
		shapes.flatMap((shape) =>
			shape.kind === "symbol" && shape.netSymbol
				? [[shape.id, shape] as const]
				: [],
		),
	);
	const symbolNets = new Map(
		circuit.nets.flatMap((net) =>
			(net.schematicShapeIds ?? []).map((id) => [id, net] as const),
		),
	);
	const terminalPositions = new Map(
		shapes.flatMap((shape) =>
			shape.kind === "symbol"
				? symbolShapes(shape).flatMap((child) =>
						child.kind === "pin"
							? [[`${shape.id}:${child.id}`, child] as const]
							: [],
					)
				: [],
		),
	);
	const previousPinId = schematicPinLookup(context.previous.circuit.components);
	const previousIndex = new NetIndex(previousNets, context.previousLabels);
	const currentIndex = new NetIndex(circuit.nets);
	const changed = (net: CircuitNet) => !unchanged.has(net.id);
	const pinSets = new PinSets();
	for (const net of electricalNets(shapes)) {
		const sourcePinIds = net.pins.map((pin) =>
			previousPinId(pin.shapeId, pin.pinId),
		);
		const pinIds = sourcePinIds.filter((id) => id !== undefined);
		const previousNet = previousIndex.first(
			[
				["id", net.labels.flatMap((id) => bindings.get(id) ?? [])],
				["pin", pinIds],
				["name", net.names],
				["id", automaticNetIds(net.names)],
				["label", net.names],
			],
			changed,
		);
		if (!previousNet) continue;
		for (const id of [...net.wires, ...net.labels]) remove.add(id);
		const next =
			currentIndex.first([["id", [previousNet.id]]]) ??
			currentIndex.first([
				["name", previousNet.names],
				["pin", previousNet.pinIds],
			]);
		const disconnectedByNet = new Map<CircuitNet | undefined, Point[]>();
		const disconnectedFrom = (target: CircuitNet | undefined) => {
			const cached = disconnectedByNet.get(target);
			if (cached) return cached;
			const points = net.pins.flatMap((pin, index) => {
				const id = sourcePinIds[index];
				if (
					!id ||
					!pinSets.of(previousNet).has(id) ||
					(target && pinSets.of(target).has(id))
				)
					return [];
				const point = terminalPositions.get(`${pin.shapeId}:${pin.pinId}`);
				return point ? [point] : [];
			});
			disconnectedByNet.set(target, points);
			return points;
		};
		for (const pin of net.pins) {
			const symbol = netSymbols.get(pin.shapeId);
			if (!symbol) continue;
			const symbolNext = symbolNets.get(symbol.id) ?? next;
			const disconnected = disconnectedFrom(symbolNext);
			const terminal = terminalPositions.get(`${pin.shapeId}:${pin.pinId}`);
			const detached =
				terminal &&
				disconnected.some(
					(point) =>
						Math.hypot(point.x - terminal.x, point.y - terminal.y) <=
						terminalTolerance,
				);
			if (detached && symbolNext?.schematicShapeIds) {
				symbolNext.schematicShapeIds = symbolNext.schematicShapeIds.filter(
					(id) => id !== symbol.id,
				);
				if (!symbolNext.schematicShapeIds.length)
					delete symbolNext.schematicShapeIds;
			}
			const name = symbolNext?.names.includes(symbol.attributes.name.trim())
				? symbol.attributes.name
				: (symbolNext?.names[0] ?? "");
			symbolNames.set(
				symbol.id,
				detached || symbolNames.get(symbol.id) === "" ? "" : name,
			);
		}
	}
	const previousById = groupBy(previousNets, (net) => net.id);
	for (const [id, net] of symbolNets) {
		const symbol = netSymbols.get(id);
		if (
			symbol &&
			!symbolNames.has(id) &&
			!(previousById.get(net.id) ?? []).some(
				(old) =>
					old.schematicShapeIds?.includes(id) &&
					stringsEqual(old.names, net.names),
			)
		)
			symbolNames.set(
				id,
				net.names.includes(symbol.attributes.name.trim())
					? symbol.attributes.name
					: (net.names[0] ?? ""),
			);
	}
	return { remove, symbolNames };
}

/** Reads the edited schematic back into the circuit. */
function extractCircuitFromSchematic(
	circuit: Circuit,
	shapes: EditorShape[],
	context: SyncContext,
): EditorShape[] {
	const components = extractComponents(circuit, shapes, context);
	circuit.components = components;
	const units = new Map(
		components.flatMap((component) =>
			componentShapeIds(component).map((id) => [id, component] as const),
		),
	);
	const annotated = shapes.map((shape) => {
		if (shape.kind !== "symbol") return shape;
		const component = units.get(shape.id);
		return component
			? {
					...shape,
					attributes: {
						...shape.attributes,
						reference: component.reference,
						value: component.value,
					},
				}
			: shape;
	});
	const extracted = extractNets(annotated, components, context);
	circuit.nets = extracted.nets;
	const connected = new Set(circuit.nets.flatMap((net) => net.pinIds));
	const pins = new Set(
		components.flatMap((component) => component.pins.map((pin) => pin.id)),
	);
	circuit.noConnectPinIds = circuit.noConnectPinIds.filter(
		(id) => pins.has(id) && !connected.has(id),
	);
	if (
		!jsonEqual(
			{ ...circuit, revision: context.file.circuit.revision },
			context.file.circuit,
		)
	)
		circuit.revision++;
	return extracted.shapes;
}

/**
 * Builds one component per schematic symbol with pins. Units of a multi-unit
 * part are grouped into one component. Existing components keep their
 * identities, pin identities, part and annotations.
 */
function extractComponents(
	circuit: Circuit,
	shapes: readonly EditorShape[],
	context: SyncContext,
): CircuitComponent[] {
	const { definitions } = context;
	const owners = componentsByShapeId(circuit.components);
	if (
		shapes.some(
			(shape) =>
				shape.kind === "symbol" &&
				!shape.children.length &&
				owners.has(shape.id),
		)
	)
		throw new MissingSymbolLibraryError();
	const symbolsById = new Map(
		shapes.flatMap((shape) =>
			shape.kind === "symbol" ? [[shape.id, shape] as const] : [],
		),
	);
	const usedReferences = new Set(
		[...symbolsById.values()]
			.filter(
				(shape) =>
					shape.children.some((child) => child.kind === "pin") &&
					annotatedReference(shape.attributes.reference),
			)
			.map((shape) => shape.attributes.reference.trim()),
	);
	const components: CircuitComponent[] = [];
	const positions = new Map<string, number>();
	for (const shape of shapes) {
		if (
			shape.kind !== "symbol" ||
			shape.netSymbol ||
			!shape.children.some((child) => child.kind === "pin")
		)
			continue;
		const old = owners.get(shape.id);
		const reference = shape.attributes.reference.trim();
		const annotated = annotatedReference(reference);
		const sourceUnit = shape.kicad;
		const oldPosition = old ? positions.get(old.id) : undefined;
		let group = oldPosition === undefined ? undefined : components[oldPosition];
		if (annotated && sourceUnit) {
			const end = oldPosition ?? components.length;
			for (let position = 0; position < end; position++) {
				const candidate = components[position];
				if (
					candidate.reference === reference &&
					componentShapeIds(candidate).every((id) => {
						const unit = symbolsById.get(id)?.kicad;
						return (
							unit?.libraryId === sourceUnit.libraryId &&
							unit.unit !== sourceUnit.unit
						);
					})
				) {
					group = candidate;
					break;
				}
			}
		}
		const component = componentFromSymbol(
			{
				id: shape.definitionId,
				name:
					shape.attributes.name.trim() ||
					definitions.first(shape.definitionId)?.name ||
					shape.definitionId,
				prefix:
					reference.replace(/[?\d]+$/, "") ||
					definitions.first(shape.definitionId, shape.library)?.prefix ||
					"U",
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
		component.id = group?.id ?? old?.id ?? `${circuit.id}:s${shape.id}`;
		if (
			old &&
			(old.part.id === component.part.id ||
				(!shape.library && shape.definitionId.startsWith(fallbackPrefix)))
		)
			component.part = structuredClone(old.part);
		const oldPins = new Map<string | undefined, CircuitPin>();
		for (const pin of old?.pins ?? [])
			if (
				(pin.schematicShapeId ?? old?.schematicShapeId) === shape.id &&
				!oldPins.has(pin.sourcePinId)
			)
				oldPins.set(pin.sourcePinId, pin);
		component.pins = component.pins.map((pin) => {
			const existing = oldPins.get(pin.sourcePinId);
			const overrides = shape.childOverrides?.[`shape:${pin.sourcePinId}`];
			return {
				...pin,
				id:
					existing?.id ??
					(group
						? `${component.id}:s${shape.id}:p${pin.sourcePinId}`
						: `${component.id}:p${pin.sourcePinId}`),
				...(group || existing?.schematicShapeId
					? { schematicShapeId: shape.id }
					: {}),
				name:
					overrides?.name ??
					(existing &&
					(existing.sourcePin
						? existing.sourcePin.name === pin.name
						: !old?.part.library)
						? existing.name
						: pin.name),
				number:
					overrides?.number === undefined &&
					existing &&
					(existing.sourcePin
						? existing.sourcePin.number === pin.number
						: !old?.part.library)
						? existing.number
						: pin.number,
				sourcePin: { name: pin.name, number: pin.number },
				electricalType: existing?.electricalType ?? pin.electricalType,
			};
		});
		const pinOrder = new Map(old?.pins.map((pin, index) => [pin.id, index]));
		component.pins.sort(
			(a, b) =>
				(pinOrder.get(a.id) ?? Infinity) - (pinOrder.get(b.id) ?? Infinity),
		);
		component.schematicShapeId = shape.id;
		component.reference = annotated
			? reference
			: old?.reference &&
					annotatedReference(old.reference) &&
					!usedReferences.has(old.reference)
				? old.reference
				: unusedReference(
						component.reference.replace(/\d+$/, ""),
						usedReferences,
					);
		if (!annotated) usedReferences.add(component.reference);
		component.value = shape.attributes.value;
		if (group) {
			group.schematicShapeIds = [...componentShapeIds(group), shape.id];
			group.pins.push(...component.pins);
			if (old && shape.attributes.reference !== old.reference)
				group.reference = shape.attributes.reference;
			if (old && shape.attributes.value !== old.value)
				group.value = shape.attributes.value;
		} else {
			if (!positions.has(component.id))
				positions.set(component.id, components.length);
			components.push(component);
		}
	}
	return components;
}

/**
 * Builds circuit nets from the schematic's electrical nets. Each net keeps the
 * identity of the circuit net it matches by label binding, name, or pin set.
 */
function extractNets(
	shapes: EditorShape[],
	components: readonly CircuitComponent[],
	context: SyncContext,
): { nets: CircuitNet[]; shapes: EditorShape[] } {
	const { file, labels, newId } = context;
	const fileNets = file.circuit.nets;
	const pinId = schematicPinLookup(components);
	const shapeById = new Map(shapes.map((shape) => [shape.id, shape]));
	const netsById = firstById(fileNets);
	const index = new NetIndex(fileNets, labels);
	const bindingUpdates = new Map<number, string>();
	const claimed = new Set<string>();
	const unclaimed = (net: CircuitNet) => !claimed.has(net.id);
	const schematicNets = electricalNets(shapes);
	const nameOwners = new Map(
		schematicNets.flatMap((net) =>
			net.names.map((name) => [name, net] as const),
		),
	);
	const nets = schematicNets.flatMap((net): CircuitNet[] => {
		const pinIds = net.pins.flatMap(
			(pin) => pinId(pin.shapeId, pin.pinId) ?? [],
		);
		if (pinIds.length < 2 && !net.names.length) return [];
		const managed = managedLabels(net, shapeById);
		const old =
			index.first(
				[["id", managed.map((shape) => shape.circuitNet.id)]],
				unclaimed,
			) ??
			index.first(
				[
					["label", net.names],
					["id", automaticNetIds(net.names)],
				],
				unclaimed,
			) ??
			(pinIds.length > 0
				? index.first([["pinSet", [pinSetKey(pinIds)]]], unclaimed)
				: undefined);
		const id = old?.id ?? newId();
		claimed.add(id);
		const names = net.names.filter(
			(name) =>
				!managed.some((shape) => {
					const source = netsById.get(shape.circuitNet.id);
					return source && !source.names.length && shape.text === name;
				}),
		);
		const savedNames =
			old?.names.length &&
			managed.some((shape) => shape.circuitNet.id === old.id) &&
			names.length === 1 &&
			names[0] === old.names[0]
				? old.names.filter((name) => {
						const owner = nameOwners.get(name);
						return owner === undefined || owner === net;
					})
				: names;
		const schematicShapeIds = [
			...new Set([
				...(old?.schematicShapeIds ?? []).filter((id) => {
					const shape = shapeById.get(id);
					return (
						shape?.kind === "symbol" &&
						shape.netSymbol &&
						!shape.attributes.name.trim()
					);
				}),
				...net.pins.flatMap((pin) => {
					const shape = shapeById.get(pin.shapeId);
					return shape?.kind === "symbol" &&
						shape.netSymbol &&
						shape.attributes.name.trim()
						? [shape.id]
						: [];
				}),
			]),
		].sort((a, b) => a - b);
		for (const shape of managed) bindingUpdates.set(shape.id, id);
		const current = new Set(pinIds);
		const kept = new Set(old?.pinIds);
		return [
			{
				id,
				names: savedNames,
				...(schematicShapeIds.length ? { schematicShapeIds } : {}),
				pinIds: [
					...(old?.pinIds.filter((id) => current.has(id)) ?? []),
					...pinIds.filter((id) => !kept.has(id)),
				],
			},
		];
	});
	const order = new Map(fileNets.map((net, index) => [net.id, index]));
	nets.sort(
		(a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity),
	);
	return {
		nets,
		shapes: shapes.map((shape) => {
			const id = bindingUpdates.get(shape.id);
			return shape.kind === "text" && shape.circuitNet && id !== undefined
				? { ...shape, circuitNet: { ...shape.circuitNet, id } }
				: shape;
		}),
	};
}

type BoundLabel = TextShape & {
	circuitNet: NonNullable<TextShape["circuitNet"]>;
};

/** Labels of a schematic net that are still bound to the circuit net they show. */
function managedLabels(
	net: ElectricalNet,
	shapes: ReadonlyMap<number, EditorShape>,
): BoundLabel[] {
	return net.labels.flatMap((id) => {
		const shape = shapes.get(id);
		return shape?.kind === "text" &&
			shape.circuitNet &&
			shape.text === shape.circuitNet.label
			? [shape as BoundLabel]
			: [];
	});
}

/**
 * Drops labels whose net or pin left the circuit and updates the text of
 * labels that still show their net's automatic label.
 */
function refreshLabels(
	circuit: Circuit,
	shapes: readonly EditorShape[],
	measureText: MeasureText,
): EditorShape[] {
	const nets = firstById(circuit.nets);
	const pinSets = new PinSets();
	const labels = circuitNetLabels(circuit);
	return shapes.flatMap((shape) => {
		if (shape.kind !== "text" || !shape.circuitNet) return [shape];
		const net = nets.get(shape.circuitNet.id);
		if (
			!net ||
			(shape.circuitNet.pinId && !pinSets.of(net).has(shape.circuitNet.pinId))
		)
			return [];
		if (shape.text !== shape.circuitNet.label) return [shape];
		const text = labels.get(shape.circuitNet.id);
		if (!text || text === shape.text) return [shape];
		return [
			updateText(
				{ ...shape, circuitNet: { ...shape.circuitNet, label: text } },
				text,
				measureText,
			),
		];
	});
}

interface DefinitionIndex {
	/** The first definition with this id, optionally from this library. */
	first(
		id: string,
		library?: SymbolDefinition["library"],
	): SymbolDefinition | undefined;
	/** The last definition with this id, optionally from this library. */
	last(
		id: string,
		library?: SymbolDefinition["library"],
	): SymbolDefinition | undefined;
}

function indexDefinitions(
	definitions: readonly SymbolDefinition[],
): DefinitionIndex {
	const byId = groupBy(definitions, (definition) => definition.id);
	const matches = (
		definition: SymbolDefinition,
		library: SymbolDefinition["library"],
	) => !library || jsonEqual(definition.library, library);
	return {
		first: (id, library) =>
			byId.get(id)?.find((definition) => matches(definition, library)),
		last(id, library) {
			const candidates = byId.get(id) ?? [];
			for (let index = candidates.length - 1; index >= 0; index--)
				if (matches(candidates[index], library)) return candidates[index];
		},
	};
}

type NetKey = "id" | "pin" | "name" | "label" | "pinSet";
type NetLookup = readonly [key: NetKey, values: Iterable<string>];

/**
 * Finds the first net in list order that matches any of several keys, without
 * rescanning the list. Each key's index is built on first use.
 */
class NetIndex {
	readonly #nets: readonly CircuitNet[];
	readonly #labels: ReadonlyMap<string, string> | undefined;
	readonly #indexes = new Map<NetKey, Map<string, number[]>>();

	constructor(
		nets: readonly CircuitNet[],
		labels?: ReadonlyMap<string, string>,
	) {
		this.#nets = nets;
		this.#labels = labels;
	}

	/** The earliest net that has any of the looked-up keys and passes `accept`. */
	first(
		lookups: readonly NetLookup[],
		accept: (net: CircuitNet) => boolean = () => true,
	): CircuitNet | undefined {
		let first = Infinity;
		for (const [key, values] of lookups) {
			const index = this.#index(key);
			for (const value of values)
				for (const position of index.get(value) ?? []) {
					if (position >= first) break;
					if (accept(this.#nets[position])) {
						first = position;
						break;
					}
				}
		}
		return first === Infinity ? undefined : this.#nets[first];
	}

	#keys(net: CircuitNet, key: NetKey): readonly string[] {
		switch (key) {
			case "id":
				return [net.id];
			case "pin":
				return net.pinIds;
			case "name":
				return net.names;
			case "label": {
				const label = this.#labels?.get(net.id);
				return label === undefined ? [] : [label];
			}
			case "pinSet":
				return [pinSetKey(net.pinIds)];
		}
	}

	#index(key: NetKey): Map<string, number[]> {
		const cached = this.#indexes.get(key);
		if (cached) return cached;
		const index = new Map<string, number[]>();
		this.#nets.forEach((net, position) => {
			for (const value of this.#keys(net, key)) {
				const positions = index.get(value);
				if (!positions) index.set(value, [position]);
				else if (positions.at(-1) !== position) positions.push(position);
			}
		});
		this.#indexes.set(key, index);
		return index;
	}
}

/** Caches each net's pin ids as a set. Nets must not change while cached. */
class PinSets {
	readonly #sets = new Map<CircuitNet, Set<string>>();

	of(net: CircuitNet): Set<string> {
		let pins = this.#sets.get(net);
		if (!pins) {
			pins = new Set(net.pinIds);
			this.#sets.set(net, pins);
		}
		return pins;
	}
}

/** Net ids named by automatic `N_<id>` net names. */
function automaticNetIds(names: readonly string[]): string[] {
	return names.flatMap((name) =>
		name.startsWith("N_") ? [name.slice(2)] : [],
	);
}

function pinSetKey(pinIds: readonly string[]): string {
	return JSON.stringify([...pinIds].sort());
}

/** Lists the component pins of a net in component order, then pin order. */
function netMembers(components: readonly CircuitComponent[]) {
	const members: { component: CircuitComponent; pin: CircuitPin }[] = [];
	const positions = new Map<string, number[]>();
	for (const component of components)
		for (const pin of component.pins) {
			const list = positions.get(pin.id);
			if (list) list.push(members.length);
			else positions.set(pin.id, [members.length]);
			members.push({ component, pin });
		}
	return (net: CircuitNet) =>
		[...new Set(net.pinIds.flatMap((id) => positions.get(id) ?? []))]
			.sort((a, b) => a - b)
			.map((position) => members[position]);
}

interface SymbolTerminals {
	/** The first pin child matching the circuit pin's source pin or number. */
	find(pin: CircuitPin): SymbolShape | undefined;
}

function indexTerminals(symbol: EditorSymbol): SymbolTerminals {
	const children = symbolShapes(symbol);
	const bySource = new Map<string, number>();
	const byNumber = new Map<string, number>();
	children.forEach((child, position) => {
		if (child.kind !== "pin") return;
		const source = String(child.id);
		if (!bySource.has(source)) bySource.set(source, position);
		if (!byNumber.has(child.number)) byNumber.set(child.number, position);
	});
	return {
		find(pin) {
			const source =
				pin.sourcePinId === undefined
					? undefined
					: bySource.get(pin.sourcePinId);
			const number = byNumber.get(pin.number);
			const position = Math.min(source ?? Infinity, number ?? Infinity);
			return position === Infinity ? undefined : children[position];
		},
	};
}

interface SymbolLayout {
	/** Moves a generated symbol to the first free grid slot. */
	place(symbol: EditorSymbol): EditorSymbol;
	/** Marks a shape's bounds as occupied. */
	add(shape: EditorShape): void;
}

function symbolLayout(shapes: readonly EditorShape[]): SymbolLayout {
	const occupied: Bounds[] = shapes.map(shapeBounds);
	let symbols = shapes.filter((shape) => shape.kind === "symbol").length;
	return {
		place(symbol) {
			for (let index = symbols; ; index++) {
				const candidate = {
					...symbol,
					x: 30 + (index % 6) * 30,
					y: -30 - Math.floor(index / 6) * 30,
				};
				const bounds = shapeBounds(candidate);
				if (
					occupied.every(
						(other) =>
							other.maxX + 1 < bounds.minX ||
							other.minX - 1 > bounds.maxX ||
							other.maxY + 1 < bounds.minY ||
							other.minY - 1 > bounds.maxY,
					)
				)
					return candidate;
			}
		},
		add(shape) {
			occupied.push(shapeBounds(shape));
			if (shape.kind === "symbol") symbols++;
		},
	};
}

function fallbackDefinition(
	component: CircuitComponent,
	newId: () => string,
): SymbolDefinition {
	return {
		id: `${fallbackPrefix}${newId()}`,
		name: component.part.name,
		prefix: component.reference.replace(/\d+$/, ""),
		value: component.value,
		description: "",
		texts: [
			{
				attribute: "reference",
				x: 0,
				y: fromMils(150),
				fontSize: SYMBOL_TEXT_SIZE,
			},
		],
		children: component.pins.map((pin, index) => ({
			id: index + 1,
			kind: "pin",
			name: pin.name,
			number: pin.number,
			x: fromMils(-200),
			y: -index * DEFAULT_PIN_LENGTH,
			width: 1,
			height: 1,
			rotation: 0,
			lineWidth: DEFAULT_LINE_WIDTH,
			length: DEFAULT_PIN_LENGTH,
		})),
	};
}

/** Binds each of the component's pins on this symbol to one of its pin children. */
function linkPins(component: CircuitComponent, symbol: EditorSymbol) {
	const pins = symbol.children.filter((child) => child.kind === "pin");
	const owned = component.pins.filter(
		(pin) => (pin.schematicShapeId ?? component.schematicShapeId) === symbol.id,
	);
	const used = new Set<number>();
	const bind = (pin: CircuitPin, child: (typeof pins)[number]) => {
		pin.sourcePinId = String(child.id);
		used.add(child.id);
		const override = symbol.childOverrides?.[`shape:${child.id}`];
		pin.sourcePin ??= {
			name: override?.name ?? child.name,
			number:
				(override?.number ?? child.number).trim() ||
				String(pins.indexOf(child) + 1),
		};
	};
	const bySource = groupBy(pins, (child) => String(child.id));
	for (const pin of owned) {
		const child =
			pin.sourcePinId === undefined
				? undefined
				: bySource.get(pin.sourcePinId)?.find((child) => !used.has(child.id));
		if (child) bind(pin, child);
		else delete pin.sourcePinId;
	}
	const matches = [
		(pin: CircuitPin, child: (typeof pins)[number]) =>
			child.number.trim() === pin.number,
		(pin: CircuitPin, child: (typeof pins)[number]) =>
			child.name === pin.number,
		(pin: CircuitPin, child: (typeof pins)[number]) =>
			Boolean(pin.name) && child.name === pin.name,
	];
	for (const match of matches)
		for (const pin of owned) {
			if (pin.sourcePinId) continue;
			const child = pins.find(
				(child) => !used.has(child.id) && match(pin, child),
			);
			if (child) bind(pin, child);
		}
	owned.forEach((pin, index) => {
		if (pin.sourcePinId) return;
		const child =
			pins[index] && !used.has(pins[index].id)
				? pins[index]
				: pins.find((child) => !used.has(child.id));
		if (child) bind(pin, child);
	});
}

function annotatedReference(reference: string): boolean {
	return reference.trim().length > 0 && !reference.includes("?");
}

function unusedReference(prefix: string, used: ReadonlySet<string>): string {
	let suffix = 1;
	while (used.has(`${prefix}${suffix}`)) suffix++;
	return `${prefix}${suffix}`;
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
	measureText: MeasureText,
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
			fontSize: DEFAULT_TEXT_SIZE,
			lineWidth: DEFAULT_LINE_WIDTH,
			text,
			...alignmentAtPin(point, symbol),
		},
		text,
		measureText,
	);
}

/** A schematic pin terminal with the circuit pins drawn on it. */
interface CircuitTerminal extends Point {
	pins: CircuitPin[];
}

function circuitTerminals(
	shapes: readonly EditorShape[],
	components: readonly CircuitComponent[],
): CircuitTerminal[] {
	const owners = componentsByShapeId(components);
	return shapes.flatMap((shape) => {
		if (shape.kind !== "symbol") return [];
		const component = owners.get(shape.id);
		if (!component) return [];
		const bySource = groupBy(
			component.pins.filter(
				(pin) =>
					(pin.schematicShapeId ?? component.schematicShapeId) === shape.id,
			),
			(pin) => pin.sourcePinId,
		);
		return symbolShapes(shape).flatMap((child) =>
			child.kind === "pin"
				? [
						{
							x: child.x,
							y: child.y,
							pins: bySource.get(String(child.id)) ?? [],
						},
					]
				: [],
		);
	});
}

/** The circuit pin, among `pinIds`, drawn at the label's position. */
function labelPinId(
	point: Point,
	terminals: readonly CircuitTerminal[],
	pinIds: readonly string[],
): string | undefined {
	if (!pinIds.length) return;
	for (const terminal of terminals) {
		if (
			Math.hypot(terminal.x - point.x, terminal.y - point.y) > terminalTolerance
		)
			continue;
		const pin = terminal.pins.find((pin) => pinIds.includes(pin.id));
		if (pin) return pin.id;
	}
}

function componentShapeIds(component: CircuitComponent): number[] {
	return (
		component.schematicShapeIds ??
		(component.schematicShapeId === undefined
			? []
			: [component.schematicShapeId])
	);
}

/** Maps each schematic symbol id to the first component drawn by it. */
function componentsByShapeId(
	components: readonly CircuitComponent[],
): Map<number, CircuitComponent> {
	const owners = new Map<number, CircuitComponent>();
	for (const component of components)
		for (const id of componentShapeIds(component))
			if (!owners.has(id)) owners.set(id, component);
	return owners;
}

/** Resolves a symbol's pin child to the id of the circuit pin drawn by it. */
function schematicPinLookup(
	components: readonly CircuitComponent[],
): (shapeId: number, sourceId: number) => string | undefined {
	const owners = componentsByShapeId(components);
	const symbols = new Map<number, Map<string, string>>();
	return (shapeId, sourceId) => {
		let pins = symbols.get(shapeId);
		if (!pins) {
			pins = new Map();
			const component = owners.get(shapeId);
			for (const pin of component?.pins ?? [])
				if (
					pin.sourcePinId !== undefined &&
					(pin.schematicShapeId ?? component?.schematicShapeId) === shapeId &&
					!pins.has(pin.sourcePinId)
				)
					pins.set(pin.sourcePinId, pin.id);
			symbols.set(shapeId, pins);
		}
		return pins.get(String(sourceId));
	};
}

function firstById<T extends { id: string }>(
	items: readonly T[],
): Map<string, T> {
	const byId = new Map<string, T>();
	for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
	return byId;
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
	const groups = new Map<K, T[]>();
	for (const item of items) {
		const group = groups.get(key(item));
		if (group) group.push(item);
		else groups.set(key(item), [item]);
	}
	return groups;
}

function stringsEqual(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Compares schema-validated JSON data as its serialized form would: object key
 * order and keys holding `undefined` are ignored.
 */
function jsonEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (
		typeof a !== "object" ||
		typeof b !== "object" ||
		a === null ||
		b === null
	)
		return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
			return false;
		return a.every((value, index) => jsonEqual(value, b[index]));
	}
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	let count = 0;
	for (const key in left) {
		if (!Object.hasOwn(left, key) || left[key] === undefined) continue;
		if (!jsonEqual(left[key], right[key])) return false;
		count++;
	}
	for (const key in right)
		if (Object.hasOwn(right, key) && right[key] !== undefined) count--;
	return count === 0;
}
