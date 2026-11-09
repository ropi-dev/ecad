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
	isImmutable,
	jumpHistory,
	redoHistory,
	undoHistory,
} from "#/drawing/history.ts";
import {
	type DrawingPage,
	drawingPages,
	drawingPagesSchema,
	pageId,
	savedPages,
	shapesOnPage,
	withPage,
} from "#/drawing/pages.ts";
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
	cutWiresUnderSymbols,
	isUnsafeMove,
	normalizeNetSymbol,
	normalizeWireSegments,
	pinTerminals,
	withFullRouting,
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

interface CommitOptions {
	/** The page of new shapes that do not name one, such as routed wires. */
	readonly page?: number;
	/** The drawing's new page list, when the command changes it. */
	readonly pages?: readonly DrawingPage[];
}

/**
 * Shapes on the first page omit `page`, and every other shape names a page of
 * the drawing. New shapes without a page go to the command's page.
 */
function canonicalPages(
	current: DrawingSnapshot,
	shapes: EditorShape[],
	{ page, pages = current.pages }: CommitOptions,
): EditorShape[] {
	const list = drawingPages(pages);
	const first = list[0].id;
	const ids = new Set(list.map((item) => item.id));
	let changed = false;
	const result = shapes.map((shape) => {
		let next = shape;
		if (
			next.page === undefined &&
			page !== undefined &&
			next.id >= current.nextShapeId
		)
			next = withPage(next, page, pages);
		if (next.page !== undefined) {
			if (!ids.has(next.page)) invalid(`Page ${next.page} does not exist.`);
			if (next.page === first) next = withPage(next, first, pages);
		}
		if (next !== shape) changed = true;
		return next;
	});
	return changed ? result : shapes;
}

function commit(
	current: DrawingSnapshot,
	shapes: EditorShape[],
	changedIds: readonly number[],
	label: string,
	nextShapeId = current.nextShapeId,
	preferredIds: readonly number[] = changedIds,
	options: CommitOptions = {},
): readonly [CommandResult, DrawingSnapshot] {
	const pages = savedPages(options.pages ?? current.pages);
	const paged = canonicalPages(current, shapes, options);
	const normalized = measurePerformance(
		"editor.wire-normalize",
		() => normalizeWireSegments(paged, new Set(preferredIds), nextShapeId),
		{ shapes: paged.length },
	);
	nextShapeId = normalized.nextShapeId;
	if (!Number.isSafeInteger(nextShapeId))
		invalid("No more shape IDs are available.");
	const ids = [
		...new Set(
			changedIds.flatMap((id) => normalized.idsBySource.get(id) ?? []),
		),
	];
	const document: DrawingDocument = pages
		? { shapes: normalized.shapes, pages }
		: { shapes: normalized.shapes };
	const history = measurePerformance(
		"drawing.history-commit",
		() => commitHistory(current.history, freeze(document), label, sameDrawing),
		{ shapes: normalized.shapes.length },
	);
	return [
		{ ids, idMap: normalized.idMap, idsBySource: normalized.idsBySource },
		history === current.history && nextShapeId === current.nextShapeId
			? current
			: { ...document, history, nextShapeId },
	];
}

/**
 * Circuit net labels at a pin of a selected symbol, which move with it. A
 * locked label moves only when it is selected too.
 */
function pinnedLabels(
	shapes: readonly EditorShape[],
	selectedIds: ReadonlySet<number>,
) {
	const components = shapes.filter(
		(shape) => selectedIds.has(shape.id) && shape.kind === "symbol",
	);
	return shapes.flatMap((label) => {
		if (
			label.kind !== "text" ||
			!label.circuitNet?.pinId ||
			(label.locked && !selectedIds.has(label.id))
		)
			return [];
		const component = components.find((shape) =>
			pinTerminals(shape).some(
				(pin) =>
					Math.hypot(pin.x - label.x, pin.y - label.y) <= connectionTolerance,
			),
		);
		return component ? [{ label, component }] : [];
	});
}

/** The one page that all of `shapes` are on. */
function singlePage(
	current: DrawingSnapshot,
	shapes: readonly EditorShape[],
	action: string,
): number {
	const first = drawingPages(current.pages)[0].id;
	const pages = new Set(shapes.map((shape) => shape.page ?? first));
	if (pages.size > 1) invalid(`${action} shapes on one page at a time.`);
	return pages.values().next().value ?? first;
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

function capturedValue<T>(value: T): T {
	if (isImmutable(value)) return value;
	if (Array.isArray(value)) return Array.from(value, capturedValue) as T;
	return structuredClone(value);
}

/** Capture inputs when constructing a command; replays cannot observe caller edits. */
function capture<I, A>(
	input: I,
	build: (captured: I) => Effect.Effect<A, InvalidDrawingCommand, DrawingStore>,
) {
	try {
		return build(
			input && Object.getPrototypeOf(input) === Object.prototype
				? (Object.fromEntries(
						Object.entries(input).map(([key, item]) => [
							key,
							capturedValue(item),
						]),
					) as I)
				: capturedValue(input),
		);
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
			const cut = cutWiresUnderSymbols(
				current.shapes,
				shapes,
				current.nextShapeId + shapes.length,
			);
			return commit(
				current,
				[...cut.shapes, ...shapes],
				shapes.map((shape) => shape.id),
				label,
				cut.nextShapeId,
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
			const page = singlePage(
				current,
				current.shapes.filter((shape) => selectedIds.has(shape.id)),
				"Rotate",
			);
			// Rotated items connect only to shapes on their own page.
			const pageShapes = shapesOnPage(current.shapes, page, current.pages);
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
			for (const { label, component } of pinnedLabels(
				pageShapes,
				selectedIds,
			)) {
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
			const originals = pageShapes.filter((shape) => selectedIds.has(shape.id));
			const connected = withFullRouting(() =>
				connectTransformedTerminals(
					originals,
					originals.map((shape) => transformed.get(shape.id) ?? shape),
					pageShapes,
					current.nextShapeId,
				),
			);
			if (isUnsafeMove(connected))
				invalid(
					"No wire route avoids other nets after this rotation, so it was not applied.",
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
				undefined,
				{ page },
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
				singlePage(current, selected, "Group");
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
		if (history === current.history) return [undefined, current];
		const { pages: _pages, ...rest } = current;
		const { shapes, pages } = history.nodes[history.currentId].state;
		return [
			undefined,
			{ ...rest, shapes, ...(pages ? { pages } : {}), history },
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

/**
 * Replaces the page list: adds, renames, reorders and removes pages. Shapes on
 * a removed page are deleted with it.
 */
export function setPagesEffect(
	pages: readonly DrawingPage[],
	label = "Edit pages",
) {
	return capture(pages, (captured) =>
		command((current) => {
			const parsed = drawingPagesSchema.safeParse(captured);
			if (!parsed.success)
				invalid(parsed.error.issues[0]?.message ?? "Invalid pages.");
			const next = parsed.data;
			const first = drawingPages(current.pages)[0].id;
			const kept = new Set(next.map((page) => page.id));
			const removed: number[] = [];
			const shapes = current.shapes.flatMap((shape) => {
				const page = shape.page ?? first;
				if (!kept.has(page)) {
					removed.push(shape.id);
					return [];
				}
				return [withPage(shape, page, next)];
			});
			return commit(current, shapes, removed, label, current.nextShapeId, [], {
				pages: next,
			});
		}),
	);
}

/** Moves shapes to another page at the same coordinates. */
export function moveShapesToPageEffect(
	ids: readonly number[],
	page: number,
	label = "Move to page",
) {
	return capture({ ids, page }, (captured) =>
		command((current) => {
			validateIds(captured.ids);
			if (!pageId.safeParse(captured.page).success)
				invalid("Page IDs must be positive safe integers.");
			if (
				!drawingPages(current.pages).some((item) => item.id === captured.page)
			)
				invalid(`Page ${captured.page} does not exist.`);
			const moved = new Set(captured.ids);
			const existing = new Set(current.shapes.map((shape) => shape.id));
			for (const id of captured.ids)
				if (!existing.has(id)) invalid(`Shape ${id} does not exist.`);
			// A symbol's circuit labels sit on its pins, so they go with it.
			const first = drawingPages(current.pages)[0].id;
			for (const page of new Set(
				current.shapes
					.filter((shape) => moved.has(shape.id))
					.map((shape) => shape.page ?? first),
			))
				for (const pinned of pinnedLabels(
					shapesOnPage(current.shapes, page, current.pages),
					new Set(captured.ids),
				))
					moved.add(pinned.label.id);
			return commit(
				current,
				current.shapes.map((shape) =>
					moved.has(shape.id)
						? withPage(shape, captured.page, current.pages)
						: shape,
				),
				[...moved],
				label,
			);
		}),
	);
}
