import { A3 } from "./shapes";
import type { Point } from "./types";

export interface SheetSize {
	width: number;
	height: number;
	name?: string;
}

export const defaultSheet: SheetSize = { ...A3, name: "A3" };

function rowLabel(index: number): string {
	let result = "";
	for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26))
		result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
	return result;
}

export interface WorksheetLabel extends Point {
	text: string;
	fontSize: number;
	align: "left" | "center";
	maxWidth: number;
}

export interface WorksheetDisplay {
	name: string;
	labels: WorksheetLabel[];
	frame: Point[];
	edge: Point[];
}

/** Worksheet layout in millimetres, independent of Three.js and React. */
export function buildWorksheetDisplay(
	sheet: SheetSize = defaultSheet,
): WorksheetDisplay {
	const { width, height } = sheet;
	if (![width, height].every((value) => Number.isFinite(value) && value > 0))
		throw new RangeError(
			"Sheet width and height must be positive, finite millimetres.",
		);
	const labels: WorksheetLabel[] = [];
	let segments: Point[] = [];
	const line = (x1: number, y1: number, x2: number, y2: number) => {
		segments.push({ x: x1, y: y1 }, { x: x2, y: y2 });
	};
	const rectangle = (
		left: number,
		bottom: number,
		right: number,
		top: number,
	) => {
		line(left, bottom, right, bottom);
		line(right, bottom, right, top);
		line(right, top, left, top);
		line(left, top, left, bottom);
	};
	const margin = Math.min(10, Math.min(width, height) / 10);
	const band = Math.min(2, margin / 5);
	const left = -width / 2 + margin;
	const right = width / 2 - margin;
	const bottom = -height / 2 + margin;
	const top = height / 2 - margin;
	const label = (
		text: string,
		x: number,
		y: number,
		fontSize = 1.5,
		align: "left" | "center" = "center",
		maxWidth = Infinity,
	) => {
		labels.push({ text, x, y, fontSize, align, maxWidth });
	};

	rectangle(left, bottom, right, top);
	rectangle(left + band, bottom + band, right - band, top - band);
	// Equal zones avoid a narrow leftover cell on custom page sizes. Bound the
	// count so even very large sheets have a practical number of labels.
	const columns = Math.min(100, Math.max(1, Math.round((right - left) / 50)));
	const rows = Math.min(100, Math.max(1, Math.round((top - bottom) / 50)));
	const columnWidth = (right - left) / columns;
	const rowHeight = (top - bottom) / rows;
	for (let index = 0; index < columns; index++) {
		const x = left + index * columnWidth;
		if (index > 0) {
			line(x, top, x, top - band);
			line(x, bottom, x, bottom + band);
		}
		label(
			String(index + 1),
			x + columnWidth / 2,
			top - band / 2,
			band * 0.65,
			"center",
			columnWidth - band,
		);
		label(
			String(index + 1),
			x + columnWidth / 2,
			bottom + band / 2,
			band * 0.65,
			"center",
			columnWidth - band,
		);
	}
	for (let index = 0; index < rows; index++) {
		const y = top - index * rowHeight;
		if (index > 0) {
			line(left, y, left + band, y);
			line(right, y, right - band, y);
		}
		label(
			rowLabel(index),
			left + band / 2,
			y - rowHeight / 2,
			band * 0.65,
			"center",
			band * 0.9,
		);
		label(
			rowLabel(index),
			right - band / 2,
			y - rowHeight / 2,
			band * 0.65,
			"center",
			band * 0.9,
		);
	}

	// Title block shares its bottom and right edges with the inner frame.
	const titleScale = Math.min(
		1,
		(right - left - band * 2) / 108,
		(top - bottom - band * 2) / 80,
	);
	const titleLeft = right - band - 108 * titleScale;
	const titleBottom = bottom + band;
	const titleLine = (x1: number, y1: number, x2: number, y2: number) =>
		line(
			titleLeft + x1 * titleScale,
			titleBottom + y1 * titleScale,
			titleLeft + x2 * titleScale,
			titleBottom + y2 * titleScale,
		);
	titleLine(0, 0, 0, 32);
	titleLine(0, 32, 108, 32);
	for (const offset of [3.5, 6.5, 10.5, 16.5])
		titleLine(0, offset, 108, offset);
	titleLine(20, 3.5, 20, 6.5);
	titleLine(84, 0, 84, 6.5);
	for (const [text, x, y, size, maxWidth] of [
		["Sheet: /", 1, 15, 1.5, 106],
		["File:", 1, 12.3, 1.5, 106],
		["Title:", 1, 8.7, 2, 106],
		[`Size: ${sheet.name || `${width} × ${height} mm`}`, 1, 4.9, 1.5, 18],
		["Date:", 23, 4.9, 1.5, 60],
		["Rev:", 86, 4.9, 1.5, 21],
		["ECAD", 1, 2.1, 1.5, 82],
		["Id: 1/1", 86, 2.1, 1.5, 21],
	] as const)
		label(
			text,
			titleLeft + x * titleScale,
			titleBottom + y * titleScale,
			size * titleScale,
			"left",
			maxWidth * titleScale,
		);
	const frame = segments;
	segments = [];
	rectangle(-width / 2, -height / 2, width / 2, height / 2);
	return {
		name: `${sheet.name ? `${sheet.name}, ` : ""}${width} × ${height} mm`,
		labels,
		frame,
		edge: segments,
	};
}
