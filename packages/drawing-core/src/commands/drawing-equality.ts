import type { DrawingDocument } from "#/commands/drawing-store.ts";

type PlainRecord = Readonly<Record<string, unknown>>;

/** Numbers this close are equal, so rounding noise does not create history. */
const NUMBER_TOLERANCE = 1e-9;

/**
 * Optional top-level shape fields whose absence means the listed value.
 * Nested records keep exact presence. An absent `locked` on a symbol child
 * means locked unless the child is text. An explicit default in a child
 * override still replaces the child's own value.
 */
const SHAPE_DEFAULTS: PlainRecord = {
	locked: false,
	lineStyle: "solid",
	filled: false,
};

function isPlainRecord(value: unknown): value is PlainRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/** Structural equality over plain data. Other objects are never equal. */
function sameValue(first: unknown, second: unknown): boolean {
	if (first === second) return true;
	if (typeof first === "number")
		return (
			typeof second === "number" && Math.abs(first - second) < NUMBER_TOLERANCE
		);
	if (Array.isArray(first)) {
		if (!Array.isArray(second) || first.length !== second.length) return false;
		for (let index = 0; index < first.length; index++)
			if (!sameValue(first[index], second[index])) return false;
		return true;
	}
	return (
		isPlainRecord(first) && isPlainRecord(second) && sameRecord(first, second)
	);
}

/**
 * A key that is absent and a key whose value is `undefined` are equal, as in
 * the saved JSON form and the snapshot schema. That holds inside child
 * overrides too: `{ showName: undefined }` saves as `{}`, so recording it would
 * create history that reverts on reload.
 */
function sameRecord(
	first: PlainRecord,
	second: PlainRecord,
	defaults?: PlainRecord,
): boolean {
	for (const key in first) {
		let value = first[key];
		let other = second[key];
		if (value === other) continue;
		if (defaults && Object.hasOwn(defaults, key)) {
			value ??= defaults[key];
			other ??= defaults[key];
		}
		if (!sameValue(value, other)) return false;
	}
	for (const key in second) {
		const other = second[key];
		if (other === undefined || Object.hasOwn(first, key)) continue;
		if (
			!defaults ||
			!Object.hasOwn(defaults, key) ||
			!sameValue(defaults[key], other)
		)
			return false;
	}
	return true;
}

/**
 * Whether two drawings are the same, so a transaction between them is a no-op.
 * Every field is compared, including fields added after this was written.
 */
export function sameDrawing(
	first: DrawingDocument,
	second: DrawingDocument,
): boolean {
	if (first === second) return true;
	const { shapes: firstShapes, ...firstRest } = first;
	const { shapes: secondShapes, ...secondRest } = second;
	if (firstShapes.length !== secondShapes.length) return false;
	for (let index = 0; index < firstShapes.length; index++) {
		const shape = firstShapes[index];
		const other = secondShapes[index];
		if (
			shape !== other &&
			!(
				isPlainRecord(shape) &&
				isPlainRecord(other) &&
				sameRecord(shape, other, SHAPE_DEFAULTS)
			)
		)
			return false;
	}
	return sameValue(firstRest, secondRest);
}
