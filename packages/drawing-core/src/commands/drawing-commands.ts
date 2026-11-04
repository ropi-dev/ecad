import { Data, Effect } from "effect";
import type { z } from "zod";
import { sameDrawing } from "#/commands/drawing-equality.ts";
import {
	type DrawingDocument,
	type DrawingSnapshot,
	DrawingStore,
} from "#/commands/drawing-store.ts";
import { createSymbolFromShapes } from "#/drawing/group-symbol.ts";
import {
	commitHistory,
	type History,
	jumpHistory,
	redoHistory,
	undoHistory,
} from "#/drawing/history.ts";
import {
	type EditorShape,
	editorShapeSchema,
	type RectangleInput,
	type Same,
	type shapeInputSchema,
} from "#/drawing/schema.ts";
import {
	connectionTolerance,
	connectTransformedTerminals,
	normalizeNetSymbol,
	normalizeWireSegments,
	pinTerminals,
} from "#/drawing/shapes.ts";
import { freeze } from "#/lib/freeze.ts";
import { measurePerformance } from "#/performance/runtime.ts";

type WithoutId<T> = T extends { id: number } ? Omit<T, "id"> : never;
/** Complete geometry, already resolved by the caller. Commands allocate IDs. */
export type ShapeInput = WithoutId<EditorShape>;
true satisfies Same<ShapeInput, z.output<typeof shapeInputSchema>>;

export type { RectangleInput };

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

function hasUndefined(value: unknown): boolean {
	if (value === undefined) return true;
	if (!value || typeof value !== "object") return false;
	for (const item of Object.values(value)) if (hasUndefined(item)) return true;
	return false;
}

/** The saved form of plain data: JSON drops keys whose value is undefined. */
function savedForm(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(savedForm);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value).flatMap(([key, item]) =>
			item === undefined ? [] : [[key, savedForm(item)]],
		),
	);
}

/**
 * Commands apply the drawing schema's rules to the shape as it will be saved,
 * and commit that form. Editor spreads such as `{ circuitNet: undefined }`
 * pass, and an undefined override cannot hide a child field in memory.
 */
function validShape<T extends EditorShape>(shape: T): T {
	const saved = hasUndefined(shape) ? (savedForm(shape) as T) : shape;
	const issue = editorShapeSchema.safeParse(saved).error?.issues[0];
	if (!issue) return saved;
	const path = issue.path.join(".");
	invalid(path ? `${path}: ${issue.message}` : issue.message);
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
	const history = measurePerformance(
		"drawing.history-commit",
		() =>
			commitHistory(
				current.history,
				freeze({ shapes: normalized.shapes }),
				label,
				sameDrawing,
			),
		{ shapes: normalized.shapes.length },
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
			const shapes = captured.map((shape, index) => {
				const placed = validShape({
					...shape,
					id: current.nextShapeId + index,
				} as EditorShape);
				return placed.kind === "symbol" ? normalizeNetSymbol(placed) : placed;
			});
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
			const replacements = captured.replacements.map((shape) => {
				const valid = validShape(shape);
				if (!existing.has(shape.id))
					invalid(`Shape ${shape.id} does not exist.`);
				return valid;
			});
			const byId = new Map(
				replacements.map((shape) => [
					shape.id,
					shape.kind === "symbol" ? normalizeNetSymbol(shape) : shape,
				]),
			);
			if (!Number.isSafeInteger(current.nextShapeId + captured.inputs.length))
				invalid("No more shape IDs are available.");
			const additions = captured.inputs.map((shape, index) => {
				const placed = validShape({
					...shape,
					id: current.nextShapeId + index,
				} as EditorShape);
				return placed.kind === "symbol" ? normalizeNetSymbol(placed) : placed;
			});
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
				return validShape({
					...shape,
					rotation: (((shape.rotation + angle) % turn) + turn) % turn,
				});
			});
			const transformed = new Map(shapes.map((shape) => [shape.id, shape]));
			const components = current.shapes.filter(
				(shape) => selectedIds.has(shape.id) && shape.kind === "symbol",
			);
			for (const label of current.shapes) {
				if (
					label.kind !== "text" ||
					!label.circuitNet?.pinId ||
					(label.locked && !selectedIds.has(label.id))
				)
					continue;
				const component = components.find((shape) =>
					pinTerminals(shape).some(
						(pin) =>
							Math.hypot(pin.x - label.x, pin.y - label.y) <=
							connectionTolerance,
					),
				);
				if (!component) continue;
				const x = label.x - component.x,
					y = label.y - component.y;
				transformed.set(label.id, {
					...label,
					rotation: transformed.get(label.id)?.rotation ?? label.rotation,
					x: component.x + x * Math.cos(angle) - y * Math.sin(angle),
					y: component.y + x * Math.sin(angle) + y * Math.cos(angle),
				});
				selectedIds.add(label.id);
			}
			const originals = current.shapes.filter((shape) =>
				selectedIds.has(shape.id),
			);
			const connected = connectTransformedTerminals(
				originals,
				originals.map((shape) => transformed.get(shape.id) ?? shape),
				current.shapes,
				current.nextShapeId,
				true,
			);
			const updates = new Map(connected.map((shape) => [shape.id, shape]));
			const additions = connected.filter((shape) => !existing.has(shape.id));
			return commit(
				current,
				[
					...shapes.map((shape) => updates.get(shape.id) ?? shape),
					...additions,
				],
				captured.ids,
				"Rotate selection",
				current.nextShapeId + additions.length,
			);
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
				if (selected.some((shape) => shape.kind === "text" && shape.electrical))
					invalid("Electrical labels must remain standalone drawing items.");
				const primitives = selected.filter((shape) => shape.kind !== "symbol");
				if (primitives.length !== selected.length)
					invalid(
						"Select drawing shapes without existing symbols to create a symbol.",
					);
				if (!Number.isSafeInteger(current.nextShapeId + 1))
					invalid("No more shape IDs are available.");
				const symbol = validShape(
					createSymbolFromShapes(current.nextShapeId, primitives, {
						...capturedOptions,
						name,
					}),
				);
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
						shapes: history.nodes[history.currentId].state.shapes,
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
