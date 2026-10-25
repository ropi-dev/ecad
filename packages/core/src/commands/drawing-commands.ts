import { Data, Effect } from "effect";
import {
	type DrawingDocument,
	type DrawingSnapshot,
	DrawingStore,
} from "#/commands/drawing-store.ts";
import {
	commitHistory,
	getHistoryState,
	type History,
	jumpHistory,
	redoHistory,
	undoHistory,
} from "#/drawing/history.ts";
import { type LineStyle, lineStyles } from "#/drawing/line-style.ts";
import { symbolChildOverridesSchema } from "#/drawing/schema.ts";
import {
	type EditorShape,
	isBasicShape,
	normalizeWireSegments,
} from "#/drawing/shapes.ts";
import { createSymbolFromShapes } from "#/drawing/symbols.ts";
import { validTextAlignment } from "#/drawing/text-alignment.ts";
import { measurePerformance } from "#/performance/runtime.ts";

type WithoutId<T> = T extends { id: number } ? Omit<T, "id"> : never;
/** Complete geometry, already resolved by the caller. Commands allocate IDs. */
export type ShapeInput = WithoutId<EditorShape>;

export interface RectangleInput {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	lineWidth: number;
	lineStyle?: LineStyle;
}

export interface CommandResult {
	readonly ids: number[];
	/** Includes unchanged shapes so callers can remap their own selection. */
	readonly idMap: ReadonlyMap<number, number>;
	/** All committed pieces of each source shape, including unchanged shapes. */
	readonly idsBySource: ReadonlyMap<number, readonly number[]>;
}

export class InvalidDrawingCommand extends Data.TaggedError(
	"InvalidDrawingCommand",
)<{ readonly message: string }> {}

function invalid(message: string): never {
	throw new InvalidDrawingCommand({ message });
}

function validateIds(ids: readonly number[]) {
	const seen = new Set<number>();
	for (const id of ids) {
		if (!Number.isSafeInteger(id) || id <= 0)
			invalid("Shape IDs must be positive safe integers.");
		if (seen.has(id)) invalid(`Duplicate shape ID ${id}.`);
		seen.add(id);
	}
}

function validateShape(shape: EditorShape) {
	if (shape && shape.locked !== undefined && typeof shape.locked !== "boolean")
		invalid("Shape locks must be booleans.");
	if (
		!shape ||
		![
			"rectangle",
			"circle",
			"triangle",
			"line",
			"wire",
			"pin",
			"text",
			"symbol",
		].includes(shape.kind)
	)
		invalid("A supported shape kind is required.");
	if (
		![
			shape.x,
			shape.y,
			shape.width,
			shape.height,
			shape.rotation,
			shape.lineWidth,
		].every(Number.isFinite)
	)
		invalid(
			"Shape position, dimensions, rotation and line width must be finite.",
		);
	if (
		shape.lineWidth <= 0 ||
		shape.height <= 0 ||
		(shape.kind === "wire" ? shape.width < 0 : shape.width <= 0)
	)
		invalid("Shape dimensions and line width must be positive.");
	if (shape.kind === "circle" && Math.abs(shape.width - shape.height) > 1e-9)
		invalid("A circle must have equal width and height.");
	if (
		isBasicShape(shape) &&
		shape.lineStyle !== undefined &&
		!lineStyles.includes(shape.lineStyle)
	)
		invalid("A supported line style is required.");
	if (shape.kind === "wire" && Math.abs(Math.sin(2 * shape.rotation)) > 1e-9)
		invalid("Wire segments must be horizontal or vertical.");
	if (shape.kind === "pin" && typeof shape.name !== "string")
		invalid("Pins require a name string.");
	if (shape.kind === "pin" && typeof shape.number !== "string")
		invalid("Pins require a number string.");
	if (
		shape.kind === "pin" &&
		shape.showLabels !== undefined &&
		typeof shape.showLabels !== "boolean"
	)
		invalid("Pin label visibility must be a boolean.");
	if (shape.kind === "text") {
		if (!validTextAlignment(shape)) invalid("Invalid text alignment.");
		if (
			typeof shape.text !== "string" ||
			!Number.isFinite(shape.fontSize) ||
			shape.fontSize <= 0
		)
			invalid("Text requires content and a positive finite font size.");
	}
	if (shape.kind === "symbol") {
		if (
			shape.library !== undefined &&
			(!shape.library ||
				!["user", "project"].includes(shape.library.scope) ||
				typeof shape.library.id !== "string" ||
				!shape.library.id.length)
		)
			invalid(
				"Symbol references require a library ID and a user or project scope.",
			);
		if (
			shape.strokeOverride !== undefined &&
			(!Number.isFinite(shape.strokeOverride) || shape.strokeOverride <= 0)
		)
			invalid("Symbol stroke overrides must be positive and finite.");
		if (
			typeof shape.definitionId !== "string" ||
			!Array.isArray(shape.children) ||
			(shape.children.length === 0 && !shape.library) ||
			!shape.attributes ||
			![
				shape.attributes.name,
				shape.attributes.reference,
				shape.attributes.value,
			].every((value) => typeof value === "string")
		)
			invalid("Symbols require a definition, children and text attributes.");
		if (
			!Array.isArray(shape.texts) ||
			shape.texts.some(
				(text) =>
					!text ||
					typeof text !== "object" ||
					!["name", "reference", "value"].includes(text.attribute) ||
					![text.x, text.y, text.fontSize].every(Number.isFinite) ||
					text.fontSize <= 0 ||
					(text.locked !== undefined && typeof text.locked !== "boolean") ||
					!validTextAlignment(text),
			)
		)
			invalid(
				"Symbol texts require valid attributes, positions and font sizes.",
			);
		if (
			shape.textAlignments !== undefined &&
			(!shape.textAlignments ||
				typeof shape.textAlignments !== "object" ||
				Array.isArray(shape.textAlignments) ||
				Object.entries(shape.textAlignments).some(
					([attribute, alignment]) =>
						!["name", "reference", "value"].includes(attribute) ||
						!alignment ||
						typeof alignment !== "object" ||
						Array.isArray(alignment) ||
						!validTextAlignment(alignment),
				))
		)
			invalid("Invalid symbol text alignment.");
		if (
			shape.childOverrides !== undefined &&
			!symbolChildOverridesSchema.safeParse(shape.childOverrides).success
		)
			invalid("Invalid symbol child overrides.");
		validateIds(shape.children.map((child) => child.id));
		if (
			shape.textPositions !== undefined &&
			(!shape.textPositions ||
				typeof shape.textPositions !== "object" ||
				Array.isArray(shape.textPositions) ||
				Object.entries(shape.textPositions).some(
					([attribute, position]) =>
						!["name", "reference", "value"].includes(attribute) ||
						!position ||
						![position.x, position.y].every(Number.isFinite),
				))
		)
			invalid(
				"Symbol text positions require valid attributes and finite coordinates.",
			);
		for (const child of shape.children) {
			if (
				![
					"rectangle",
					"circle",
					"triangle",
					"line",
					"wire",
					"pin",
					"text",
				].includes(child.kind)
			)
				invalid("Symbol children must be primitive shapes.");
			validateShape({
				...child,
				...shape.childOverrides?.[`shape:${child.id}`],
			});
		}
	}
}

function sameDrawing(first: DrawingDocument, second: DrawingDocument) {
	return (
		first.shapes.length === second.shapes.length &&
		first.shapes.every((shape, index) => {
			const other = second.shapes[index];
			return (
				shape.id === other.id &&
				shape.kind === other.kind &&
				(shape.locked ?? false) === (other.locked ?? false) &&
				(!isBasicShape(shape) ||
					(isBasicShape(other) &&
						(shape.lineStyle ?? "solid") === (other.lineStyle ?? "solid"))) &&
				(shape.kind !== "pin" ||
					(other.kind === "pin" &&
						shape.name === other.name &&
						shape.number === other.number)) &&
				(shape.kind !== "symbol" ||
					(other.kind === "symbol" &&
						shape.definitionId === other.definitionId &&
						JSON.stringify(shape.library) === JSON.stringify(other.library) &&
						shape.strokeOverride === other.strokeOverride &&
						JSON.stringify(shape.textAlignments) ===
							JSON.stringify(other.textAlignments) &&
						JSON.stringify(shape.childOverrides) ===
							JSON.stringify(other.childOverrides) &&
						JSON.stringify(shape.children) === JSON.stringify(other.children) &&
						JSON.stringify(shape.texts) === JSON.stringify(other.texts) &&
						JSON.stringify(shape.textPositions) ===
							JSON.stringify(other.textPositions) &&
						shape.attributes.name === other.attributes.name &&
						shape.attributes.reference === other.attributes.reference &&
						shape.attributes.value === other.attributes.value)) &&
				(shape.kind !== "text" ||
					(other.kind === "text" &&
						shape.text === other.text &&
						shape.fontSize === other.fontSize &&
						shape.horizontalAlign === other.horizontalAlign &&
						shape.verticalAlign === other.verticalAlign)) &&
				Math.abs(shape.x - other.x) < 1e-9 &&
				Math.abs(shape.y - other.y) < 1e-9 &&
				Math.abs(shape.width - other.width) < 1e-9 &&
				Math.abs(shape.height - other.height) < 1e-9 &&
				shape.lineWidth === other.lineWidth &&
				Math.abs(shape.rotation - other.rotation) < 1e-9
			);
		})
	);
}

function commit(
	current: DrawingSnapshot,
	shapes: EditorShape[],
	changedIds: readonly number[],
	label: string,
	nextShapeId = current.nextShapeId,
	preferredIds: readonly number[] = changedIds,
): readonly [CommandResult, DrawingSnapshot] {
	const normalized = measurePerformance(
		"editor.wire-normalize",
		() => normalizeWireSegments(shapes, new Set(preferredIds), nextShapeId),
		{ shapes: shapes.length },
	);
	nextShapeId = normalized.nextShapeId;
	if (!Number.isSafeInteger(nextShapeId))
		invalid("No more shape IDs are available.");
	const ids = [
		...new Set(
			changedIds.flatMap((id) => normalized.idsBySource.get(id) ?? []),
		),
	];
	const history = commitHistory(
		current.history,
		{ shapes: normalized.shapes },
		label,
		sameDrawing,
	);
	return [
		{ ids, idMap: normalized.idMap, idsBySource: normalized.idsBySource },
		history === current.history && nextShapeId === current.nextShapeId
			? current
			: { shapes: normalized.shapes, history, nextShapeId },
	];
}

function command<A>(
	transition: (current: DrawingSnapshot) => readonly [A, DrawingSnapshot],
) {
	return Effect.flatMap(DrawingStore, (store) =>
		Effect.try({
			try: () => store.transact(transition),
			catch: (error) => error,
		}).pipe(
			Effect.catchAll((error) =>
				error instanceof InvalidDrawingCommand
					? Effect.fail(error)
					: Effect.die(error),
			),
		),
	);
}

/** Capture inputs when constructing a command; replays cannot observe caller edits. */
function capture<I, A>(
	input: I,
	build: (captured: I) => Effect.Effect<A, InvalidDrawingCommand, DrawingStore>,
) {
	try {
		return build(structuredClone(input));
	} catch {
		return Effect.fail(
			new InvalidDrawingCommand({
				message: "Command inputs must be plain drawing data.",
			}),
		);
	}
}

export function placeShapesEffect(
	inputs: readonly ShapeInput[],
	label: string,
) {
	return capture(inputs, (captured) =>
		command((current) => {
			if (!Number.isSafeInteger(current.nextShapeId + captured.length))
				invalid("No more shape IDs are available.");
			const shapes = captured.map(
				(shape, index) =>
					({ ...shape, id: current.nextShapeId + index }) as EditorShape,
			);
			for (const shape of shapes) validateShape(shape);
			return commit(
				current,
				[...current.shapes, ...shapes],
				shapes.map((shape) => shape.id),
				label,
				current.nextShapeId + shapes.length,
			);
		}),
	);
}

export function placeRectangleEffect(input: RectangleInput) {
	return placeShapesEffect([{ ...input, kind: "rectangle" }], "Draw rectangle");
}

export function replaceShapesEffect(
	replacements: readonly EditorShape[],
	label: string,
	targetIds?: readonly number[],
) {
	return replaceAndPlaceShapesEffect(replacements, [], label, targetIds);
}

export function replaceAndPlaceShapesEffect(
	replacements: readonly EditorShape[],
	inputs: readonly ShapeInput[],
	label: string,
	targetIds?: readonly number[],
) {
	return capture({ replacements, inputs, targetIds }, (captured) =>
		command((current) => {
			const ids = captured.replacements.map((shape) => shape.id);
			validateIds(ids);
			const existing = new Map(
				current.shapes.map((shape) => [shape.id, shape]),
			);
			const preferredIds = captured.targetIds ?? ids;
			validateIds(preferredIds);
			for (const id of preferredIds)
				if (!existing.has(id)) invalid(`Target shape ${id} does not exist.`);
			for (const shape of captured.replacements) {
				validateShape(shape);
				if (!existing.has(shape.id))
					invalid(`Shape ${shape.id} does not exist.`);
			}
			const byId = new Map(
				captured.replacements.map((shape) => [shape.id, shape]),
			);
			if (!Number.isSafeInteger(current.nextShapeId + captured.inputs.length))
				invalid("No more shape IDs are available.");
			const additions = captured.inputs.map(
				(shape, index) =>
					({ ...shape, id: current.nextShapeId + index }) as EditorShape,
			);
			for (const shape of additions) validateShape(shape);
			return commit(
				current,
				[
					...current.shapes.map((shape) => byId.get(shape.id) ?? shape),
					...additions,
				],
				[...ids, ...additions.map((shape) => shape.id)],
				label,
				current.nextShapeId + additions.length,
				preferredIds,
			);
		}),
	);
}

export function rotateShapesEffect(
	ids: readonly number[],
	angle = Math.PI / 2,
) {
	return capture({ ids, angle }, (captured) =>
		command((current) => {
			validateIds(captured.ids);
			if (!Number.isFinite(captured.angle))
				invalid("Rotation angle must be finite radians.");
			const selectedIds = new Set(captured.ids);
			const existing = new Set(current.shapes.map((shape) => shape.id));
			for (const id of captured.ids)
				if (!existing.has(id)) invalid(`Shape ${id} does not exist.`);
			const turn = 2 * Math.PI;
			const angle = captured.angle % turn;
			const shapes = current.shapes.map((shape) => {
				if (!selectedIds.has(shape.id) || angle === 0) return shape;
				const rotated = {
					...shape,
					rotation: (((shape.rotation + angle) % turn) + turn) % turn,
				};
				validateShape(rotated);
				return rotated;
			});
			return commit(current, shapes, captured.ids, "Rotate selection");
		}),
	);
}

export function removeShapesEffect(
	ids: readonly number[],
	label = "Delete selection",
) {
	return capture(ids, (captured) =>
		command((current) => {
			validateIds(captured);
			const removed = new Set(captured);
			const existing = new Set(current.shapes.map((shape) => shape.id));
			for (const id of captured)
				if (!existing.has(id)) invalid(`Shape ${id} does not exist.`);
			return commit(
				current,
				current.shapes.filter((shape) => !removed.has(shape.id)),
				captured,
				label,
			);
		}),
	);
}

export function createSymbolFromSelectionEffect(
	ids: readonly number[],
	options: Parameters<typeof createSymbolFromShapes>[2] = {},
) {
	return capture(
		{ ids, options },
		({ ids: captured, options: capturedOptions }) =>
			command((current) => {
				const name = (capturedOptions.name ?? "Custom symbol").trim();
				if (!name || name.length > 100)
					invalid("Enter a symbol name of 1 to 100 characters.");
				validateIds(captured);
				if (captured.length < 2)
					invalid("Select at least two shapes to create a symbol.");
				const selectedIds = new Set(captured);
				const selected = current.shapes.filter((shape) =>
					selectedIds.has(shape.id),
				);
				if (selected.length !== captured.length)
					invalid("A selected shape no longer exists.");
				const primitives = selected.filter((shape) => shape.kind !== "symbol");
				if (primitives.length !== selected.length)
					invalid(
						"Select drawing shapes without existing symbols to create a symbol.",
					);
				if (!Number.isSafeInteger(current.nextShapeId + 1))
					invalid("No more shape IDs are available.");
				const symbol = createSymbolFromShapes(current.nextShapeId, primitives, {
					...capturedOptions,
					name,
				});
				validateShape(symbol);
				const firstId = selected[0].id;
				const shapes = current.shapes.flatMap((shape) =>
					shape.id === firstId
						? [symbol]
						: selectedIds.has(shape.id)
							? []
							: [shape],
				);
				const [result, next] = commit(
					current,
					shapes,
					[symbol.id],
					"Create symbol",
					current.nextShapeId + 1,
				);
				const idMap = new Map(result.idMap);
				const idsBySource = new Map(result.idsBySource);
				for (const id of captured) {
					idMap.set(id, symbol.id);
					idsBySource.set(id, [symbol.id]);
				}
				return [{ ...result, idMap, idsBySource }, next];
			}),
	);
}

function navigate(
	next: (history: History<DrawingDocument>) => History<DrawingDocument>,
) {
	return command<void>((current) => {
		const history = next(current.history);
		return [
			undefined,
			history === current.history
				? current
				: {
						...current,
						shapes: getHistoryState(history).shapes,
						history,
					},
		];
	});
}

export const undoEffect = navigate(undoHistory);
export const redoEffect = navigate(redoHistory);
export function jumpHistoryEffect(id: number) {
	return navigate((history) => {
		if (!Number.isSafeInteger(id) || !history.nodes[id])
			invalid(`History entry ${id} does not exist.`);
		return jumpHistory(history, id);
	});
}
