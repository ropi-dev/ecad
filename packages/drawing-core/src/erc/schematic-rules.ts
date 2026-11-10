import {
	connectionTolerance,
	createPointIndex,
	createWireIndex,
	pointOnWire,
} from "#/drawing/connection-geometry.ts";
import { type ElectricalNet, isNetLabel } from "#/drawing/named-nets.ts";
import type {
	EditorShape,
	EditorSymbol,
	TextShape,
	WireShape,
} from "#/drawing/schema.ts";
import { localToWorld } from "#/drawing/shape-geometry.ts";
import { openPins, openWireEnds, pinTerminals } from "#/drawing/terminals.ts";
import type { Point } from "#/drawing/types.ts";
import type {
	ErcContext,
	ErcFinding,
	ErcRule,
	ErcSubject,
} from "#/erc/engine.ts";
import { defaultErcRules } from "#/erc/rules.ts";
import {
	type ErcSchematic,
	isAnnotated,
	isComponentSymbol,
	symbolUnitGroups,
} from "#/erc/schematic.ts";

const shapeSubject = (shape: { id: number }): ErcSubject => ({
	kind: "shape",
	id: String(shape.id),
});
const symbolLabel = (shape: EditorSymbol) =>
	shape.attributes.reference.trim() ||
	shape.attributes.name.trim() ||
	"A symbol";
const near = (a: Point, b: Point) =>
	Math.hypot(a.x - b.x, a.y - b.y) <= connectionTolerance;

type PageWire = { shape: WireShape; start: Point; end: Point };
interface PageGeometry {
	shapes: EditorShape[];
	wiresAt: (point: Point) => PageWire[];
	labelsAt: (point: Point) => TextShape[];
	atTerminal: (point: Point) => boolean;
}

const geometryCache = new WeakMap<ErcSchematic, Map<number, PageGeometry>>();
function pageGeometry(schematic: ErcSchematic): Map<number, PageGeometry> {
	let pages = geometryCache.get(schematic);
	if (pages) return pages;
	pages = new Map();
	for (const [page, pageShapes] of schematic.pages) {
		const shapes = [...pageShapes];
		const wires = shapes.flatMap((shape) =>
			shape.kind === "wire"
				? [
						{
							shape,
							start: localToWorld(shape, -shape.width / 2, 0),
							end: localToWorld(shape, shape.width / 2, 0),
						},
					]
				: [],
		);
		const terminals = createPointIndex(
			shapes.flatMap(pinTerminals),
			(point) => point,
		);
		const onWire = createWireIndex(wires);
		const labels = createPointIndex(
			shapes.filter(isNetLabel).filter((shape) => shape.text.trim()),
			(shape) => shape,
		);
		pages.set(page, {
			shapes,
			wiresAt: (point) => {
				const found: PageWire[] = [];
				onWire(point, (wire) => {
					if (pointOnWire(point, wire.start, wire.end)) found.push(wire);
					return false;
				});
				return found;
			},
			labelsAt: (point) => {
				const found: TextShape[] = [];
				labels(point, (label) => {
					if (near(label, point)) found.push(label);
					return false;
				});
				return found;
			},
			atTerminal: (point) =>
				terminals(point, (terminal) => near(terminal, point)),
		});
	}
	geometryCache.set(schematic, pages);
	return pages;
}

function netIndex(schematic: ErcSchematic) {
	const supplies = new Set(
		schematic.shapes.flatMap((shape) =>
			shape.kind === "symbol" && shape.netSymbol ? [shape.id] : [],
		),
	);
	const byLabel = new Map<number, ElectricalNet>();
	const byWire = new Map<number, ElectricalNet>();
	const bySymbol = new Map<number, ElectricalNet>();
	for (const net of schematic.nets) {
		for (const id of net.labels) byLabel.set(id, net);
		for (const id of net.wires) byWire.set(id, net);
		for (const pin of net.pins) bySymbol.set(pin.shapeId, net);
	}
	const componentPins = (net: ElectricalNet | undefined) =>
		net?.pins.filter((pin) => !supplies.has(pin.shapeId)).length ?? 0;
	return { byLabel, byWire, bySymbol, componentPins };
}

function schematicRule(
	rule: Omit<ErcRule, "check"> & {
		check(schematic: ErcSchematic, context: ErcContext): Iterable<ErcFinding>;
	},
): ErcRule {
	return {
		...rule,
		check: (context) =>
			context.schematic ? rule.check(context.schematic, context) : [],
	};
}

export const duplicateReferenceRule = schematicRule({
	id: "duplicate-reference",
	title: "Duplicate reference",
	severity: "error",
	*check({ shapes }) {
		const clashes = new Map<EditorSymbol[], EditorSymbol[]>();
		for (const [duplicate, group] of symbolUnitGroups(shapes).duplicates)
			clashes.set(group, [...(clashes.get(group) ?? []), duplicate]);
		for (const [group, duplicates] of clashes) {
			const reference = group[0].attributes.reference.trim();
			const units = [...group, ...duplicates].every((shape) => shape.kicad);
			yield {
				message: `${group.length + duplicates.length} symbols use reference ${reference}. Give each part its own reference${units ? ", and place each unit once" : ""}.`,
				subjects: [...group, ...duplicates].map(shapeSubject),
			};
		}
	},
});

export const unannotatedSymbolRule = schematicRule({
	id: "unannotated-symbol",
	title: "Unannotated symbol",
	severity: "warning",
	*check({ shapes }, { circuit }) {
		const assigned = new Map<number, string>();
		for (const component of circuit.components)
			for (const id of component.schematicShapeIds ??
				(component.schematicShapeId === undefined
					? []
					: [component.schematicShapeId]))
				assigned.set(id, component.reference);
		for (const shape of shapes)
			if (
				isComponentSymbol(shape) &&
				!isAnnotated(shape.attributes.reference)
			) {
				const reference = assigned.get(shape.id);
				yield {
					message: `${shape.attributes.reference.trim() || "A symbol without a reference"} is not annotated.${reference ? ` The circuit numbers it ${reference}.` : ""}`,
					subjects: [shapeSubject(shape)],
				};
			}
	},
});

export const differentUnitValueRule = schematicRule({
	id: "different-unit-value",
	title: "Units with different values",
	severity: "error",
	*check({ shapes }) {
		for (const group of symbolUnitGroups(shapes).groups) {
			const values = new Set(
				group.map((shape) => shape.attributes.value.trim()),
			);
			if (values.size > 1)
				yield {
					message: `Units of ${group[0].attributes.reference.trim()} have different values: ${[
						...values,
					]
						.map((value) => value || "(empty)")
						.join(", ")}.`,
					subjects: group.map(shapeSubject),
				};
		}
	},
});

export const missingLibrarySymbolRule = schematicRule({
	id: "missing-library-symbol",
	title: "Symbol missing from its library",
	severity: "warning",
	*check({ shapes }) {
		for (const shape of shapes)
			if (shape.kind === "symbol" && shape.library && !shape.children.length)
				yield {
					message: `${symbolLabel(shape)} uses "${shape.definitionId}", which library "${shape.library.id}" does not contain. ERC cannot check its pins.`,
					subjects: [shapeSubject(shape)],
				};
	},
});

export const emptySupplyNameRule = schematicRule({
	id: "empty-supply-name",
	title: "Supply symbol without a name",
	severity: "error",
	*check({ shapes }) {
		for (const shape of shapes)
			if (
				shape.kind === "symbol" &&
				shape.netSymbol &&
				!shape.attributes.name.trim()
			)
				yield {
					message:
						"A supply symbol has no name, so it does not connect to any net.",
					subjects: [shapeSubject(shape)],
				};
	},
});

export const emptyNetLabelRule = schematicRule({
	id: "empty-net-label",
	title: "Net label without a name",
	severity: "error",
	*check({ shapes }) {
		for (const shape of shapes)
			if (isNetLabel(shape) && !shape.text.trim())
				yield {
					message: `A ${shape.electrical === "supply" ? "supply" : "net"} label has no name, so it does not name a net.`,
					subjects: [shapeSubject(shape)],
				};
	},
});

export const unconnectedLabelRule = schematicRule({
	id: "unconnected-label",
	title: "Unconnected label or supply symbol",
	severity: "warning",
	*check(schematic) {
		const nets = netIndex(schematic);
		for (const [, page] of pageGeometry(schematic)) {
			const open = new Set(openPins(page.shapes).map(({ shape }) => shape));
			for (const shape of page.shapes) {
				const name =
					isNetLabel(shape) && shape.text.trim()
						? `Label ${shape.text.trim()}`
						: shape.kind === "symbol" &&
								shape.netSymbol &&
								shape.attributes.name.trim()
							? `Supply symbol ${shape.attributes.name.trim()}`
							: undefined;
				if (!name) continue;
				const attached =
					shape.kind === "symbol"
						? !open.has(shape)
						: page.atTerminal(shape) || page.wiresAt(shape).length > 0;
				const net =
					shape.kind === "symbol"
						? nets.bySymbol.get(shape.id)
						: nets.byLabel.get(shape.id);
				if (!attached)
					yield {
						message: `${name} is not attached to a wire or pin.`,
						subjects: [shapeSubject(shape)],
					};
				else if (!nets.componentPins(net))
					yield {
						message: `${name} is on a net that connects no component pins.`,
						subjects: [shapeSubject(shape)],
					};
			}
		}
	},
});

const isFloating = (net: ElectricalNet) =>
	net.wires.length > 0 && !net.pins.length && !net.names.length;

export const floatingWireRule = schematicRule({
	id: "floating-wire",
	title: "Wire connected to nothing",
	severity: "warning",
	*check({ nets }) {
		for (const net of nets)
			if (isFloating(net))
				yield {
					message:
						net.wires.length === 1
							? "A wire connects to no pin or label."
							: `${net.wires.length} connected wire segments reach no pin or label.`,
					subjects: net.wires.map((id) => ({
						kind: "shape" as const,
						id: String(id),
					})),
				};
	},
});

function noConnectMarkers(page: PageGeometry) {
	return page.shapes.filter((shape) => shape.kind === "no-connect");
}

export const unconnectedWireEndRule = schematicRule({
	id: "unconnected-wire-end",
	title: "Unconnected wire end",
	severity: "warning",
	*check(schematic) {
		const floating = new Set(
			schematic.nets.filter(isFloating).flatMap((net) => net.wires),
		);
		for (const [, page] of pageGeometry(schematic)) {
			const markers = noConnectMarkers(page);
			const ends = new Map<WireShape, number>();
			for (const { shape, point } of openWireEnds(page.shapes)) {
				if (
					shape.kind !== "wire" ||
					floating.has(shape.id) ||
					markers.some((marker) => near(marker, point))
				)
					continue;
				ends.set(shape, (ends.get(shape) ?? 0) + 1);
			}
			for (const [wire, count] of ends)
				yield {
					message:
						count > 1
							? "Neither end of a wire connects to anything."
							: "A wire end connects to nothing.",
					subjects: [shapeSubject(wire)],
				};
		}
	},
});

export const strayNoConnectRule = schematicRule({
	id: "stray-no-connect",
	title: "No-connect marker off a pin",
	severity: "warning",
	*check(schematic) {
		const nets = netIndex(schematic);
		for (const [, page] of pageGeometry(schematic)) {
			for (const marker of noConnectMarkers(page)) {
				if (page.atTerminal(marker)) continue;
				const touched = new Set<ElectricalNet>();
				for (const wire of page.wiresAt(marker)) {
					const net = nets.byWire.get(wire.shape.id);
					if (net) touched.add(net);
				}
				for (const label of page.labelsAt(marker)) {
					const net = nets.byLabel.get(label.id);
					if (net) touched.add(net);
				}
				const pins = [...touched].reduce(
					(total, net) => total + nets.componentPins(net),
					0,
				);
				if (!touched.size)
					yield {
						message: "A no-connect marker is not on a pin or wire.",
						subjects: [shapeSubject(marker)],
						code: "unattached",
					};
				else if (pins > 1)
					yield {
						message: `A no-connect marker is on a wire that connects ${pins} pins.`,
						subjects: [shapeSubject(marker)],
						code: "connected",
					};
			}
		}
	},
});

export const labelMultipleWiresRule = schematicRule({
	id: "label-multiple-wires",
	title: "Label joins crossing wires",
	severity: "warning",
	*check(schematic) {
		for (const [, page] of pageGeometry(schematic))
			for (const shape of page.shapes) {
				if (!isNetLabel(shape) || !shape.text.trim()) continue;
				const crossed = page
					.wiresAt(shape)
					.filter(({ start, end }) => !near(shape, start) && !near(shape, end));
				if (crossed.length > 1)
					yield {
						message: `Label ${shape.text.trim()} sits on ${crossed.length} wires away from their ends and connects them all.`,
						subjects: [
							shapeSubject(shape),
							...crossed.map(({ shape }) => shapeSubject(shape)),
						],
					};
			}
	},
});

export const schematicOnlyErcRules: readonly ErcRule[] = [
	duplicateReferenceRule,
	unannotatedSymbolRule,
	differentUnitValueRule,
	missingLibrarySymbolRule,
	emptySupplyNameRule,
	emptyNetLabelRule,
	unconnectedLabelRule,
	floatingWireRule,
	unconnectedWireEndRule,
	strayNoConnectRule,
	labelMultipleWiresRule,
];

export const schematicErcRules: readonly ErcRule[] = [
	...defaultErcRules,
	...schematicOnlyErcRules,
];
