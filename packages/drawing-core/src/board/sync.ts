import {
	copperItems,
	itemDistance,
	nearbyPairs,
	sharesLayer,
} from "#/board/connectivity.ts";
import { boardOutlineSegments, outlineBounds } from "#/board/drc.ts";
import {
	type BoardFootprint,
	createBoardFootprint,
	type FootprintSource,
	isBoardFootprint,
	replaceBoardFootprintSource,
} from "#/board/footprints.ts";
import { boardNetlist } from "#/board/netlist.ts";
import type { Circuit, CircuitComponent } from "#/circuit/model.ts";
import type { EditorShape } from "#/drawing/schema.ts";
import { mergeBounds, shapeBounds } from "#/drawing/shape-geometry.ts";
import { symbolShapes } from "#/drawing/symbol-instances.ts";
import {
	type FootprintReference,
	sameFootprint,
} from "#/footprint/reference.ts";

interface BoardSyncInput {
	shapes: readonly EditorShape[];
	circuit: Circuit;
	footprintOf(component: CircuitComponent): FootprintReference | undefined;
	source(reference: FootprintReference): FootprintSource | undefined;
	nextId: number;
}

interface BoardSyncResult {
	place: EditorShape[];
	replace: EditorShape[];
	remove: number[];
	/** Components without a footprint, or whose footprint is not available. */
	missing: string[];
	/** Tracks, vias and zones left on a net the circuit no longer has. */
	stale: number;
}

const naturalOrder = new Intl.Collator("en", { numeric: true }).compare;
const gap = 1.5;

/**
 * Brings a board up to date with its circuit: places a footprint for each new
 * component, swaps footprints the schematic changed, updates references and
 * values, and removes footprints whose component is gone. Placed footprints
 * keep their position, rotation and side. A footprint whose component has
 * another footprint loses its component instead of being removed. Tracks,
 * vias and zones on a net the circuit no longer has take the net of the pads
 * their tracks and vias touch, when those pads agree on one net.
 */
export function synchronizeBoard(input: BoardSyncInput): BoardSyncResult {
	const result: BoardSyncResult = {
		place: [],
		replace: [],
		remove: [],
		missing: [],
		stale: 0,
	};
	const placed = new Map<string, BoardFootprint>();
	for (const shape of input.shapes)
		if (isBoardFootprint(shape) && shape.component) {
			if (placed.has(shape.component)) {
				const { component: _component, ...detached } = shape;
				result.replace.push(detached);
			} else placed.set(shape.component, shape);
		}
	const components = new Map(
		input.circuit.components.map((component) => [component.id, component]),
	);
	for (const [id, footprint] of placed)
		if (!components.has(id)) result.remove.push(footprint.id);
	const copper = renamedCopper(input.shapes, input.circuit);
	result.replace.push(...copper.replace);
	result.stale = copper.stale;
	const added: { component: CircuitComponent; source: FootprintSource }[] = [];
	for (const component of input.circuit.components) {
		const reference = input.footprintOf(component);
		const source = reference ? input.source(reference) : undefined;
		const existing = placed.get(component.id);
		if (!reference || !source) {
			result.missing.push(component.reference);
			continue;
		}
		if (!existing) {
			added.push({ component, source });
			continue;
		}
		let next: BoardFootprint = existing;
		if (!sameFootprint(existing.footprint, reference))
			next = replaceBoardFootprintSource(existing, source);
		if (
			next.attributes.reference !== component.reference ||
			next.attributes.value !== component.value
		)
			next = {
				...next,
				attributes: {
					...next.attributes,
					reference: component.reference,
					value: component.value,
				},
			};
		if (next !== existing) result.replace.push(next);
	}
	if (!added.length) return result;
	added.sort((a, b) =>
		naturalOrder(a.component.reference, b.component.reference),
	);
	const kept = input.shapes.filter(
		(shape) => !result.remove.includes(shape.id),
	);
	const outline = outlineBounds(boardOutlineSegments(kept));
	const startX = outline ? outline.maxX + 5 : 0;
	let x = startX;
	let y = outline ? outline.maxY : 0;
	let rowHeight = 0;
	const rowWidth = Math.max(60, outline ? outline.maxX - outline.minX : 60);
	let id = input.nextId;
	const snap = (value: number) => Math.round(value / 0.05) * 0.05;
	for (const { component, source } of added) {
		const footprint = createBoardFootprint(
			id++,
			source,
			{
				component: component.id,
				reference: component.reference,
				value: component.value,
			},
			{ x: 0, y: 0 },
		);
		const local = mergeBounds(symbolShapes(footprint).map(shapeBounds));
		const width = local.maxX - local.minX;
		const height = local.maxY - local.minY + 2;
		if (x > startX && x + width > startX + rowWidth) {
			x = startX;
			y -= rowHeight + gap;
			rowHeight = 0;
		}
		result.place.push({
			...footprint,
			x: snap(x - local.minX),
			y: snap(y - local.maxY - 2),
		});
		x += width + gap;
		rowHeight = Math.max(rowHeight, height);
	}
	return result;
}

function renamedCopper(
	shapes: readonly EditorShape[],
	circuit: Circuit,
): { replace: EditorShape[]; stale: number } {
	const netlist = boardNetlist(circuit);
	const items = copperItems(shapes, netlist);
	const stale = (net: string | undefined): net is string =>
		net !== undefined && !netlist.nets.has(net);
	if (!items.some((item) => stale(item.net))) return { replace: [], stale: 0 };
	const votes = new Map<string, Set<string>>();
	nearbyPairs(items, 1e-6, (a, b) => {
		for (const [own, pad] of [
			[a, b],
			[b, a],
		]) {
			if (own.kind !== "track" && own.kind !== "via") continue;
			if (!stale(own.net) || pad.kind !== "pad" || !pad.net) continue;
			if (!sharesLayer(own, pad) || itemDistance(own, pad) > 1e-6) continue;
			const tally = votes.get(own.net) ?? new Set<string>();
			tally.add(pad.net);
			votes.set(own.net, tally);
		}
	});
	const renamed = new Map<string, string>();
	for (const [net, tally] of votes)
		if (tally.size === 1) renamed.set(net, [...tally.keys()][0]);
	let left = 0;
	const replace = shapes.flatMap((shape) => {
		const net = "net" in shape ? shape.net : undefined;
		if (shape.kind === "symbol" || !stale(net)) return [];
		const next = renamed.get(net);
		if (!next) {
			left++;
			return [];
		}
		return [{ ...shape, net: next }];
	});
	return { replace, stale: left };
}

export function schematicFootprints(schematic: readonly EditorShape[]) {
	const symbols = new Map(
		schematic.flatMap((shape) =>
			shape.kind === "symbol" ? [[shape.id, shape] as const] : [],
		),
	);
	return (component: CircuitComponent): FootprintReference | undefined => {
		for (const id of component.schematicShapeIds ?? [
			component.schematicShapeId ?? 0,
		]) {
			const footprint = symbols.get(id)?.footprint;
			if (footprint) return footprint;
		}
		return undefined;
	};
}
