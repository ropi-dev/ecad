import {
	BufferGeometry,
	Group,
	LineBasicMaterial,
	LineSegments,
	Mesh,
	PlaneGeometry,
	Vector3,
} from "three";
import { createLifecycle } from "#/lib/lifecycle";
import { A3 } from "./shapes";
import { createTextMaterial, updateText } from "./text";

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

/** Millimetre worksheet dimensions; small sheets reduce margins and title text together. */
export function createWorksheet(sheet: SheetSize = defaultSheet) {
	const { width, height } = sheet;
	if (![width, height].every((value) => Number.isFinite(value) && value > 0))
		throw new RangeError(
			"Sheet width and height must be positive, finite millimetres.",
		);
	const lifetime = createLifecycle();
	const resources: { dispose(): void }[] = [];
	// Release a large worksheet in one synchronous finalizer, including shared glyphs.
	lifetime.addFinalizer(() => {
		for (const resource of resources.splice(0).reverse()) resource.dispose();
	});
	const own = <T extends { dispose(): void }>(create: () => T) => {
		const resource = create();
		resources.push(resource);
		return resource;
	};
	try {
		const paper = new Group();
		paper.name = `${sheet.name ? `${sheet.name}, ` : ""}${width} × ${height} mm`;
		const color = "#b87979";
		const segments: Vector3[] = [];
		const line = (x1: number, y1: number, x2: number, y2: number) => {
			segments.push(new Vector3(x1, y1, 0), new Vector3(x2, y2, 0));
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
		const glyphPlane = own(() => new PlaneGeometry(1, 1));
		const labels = new Map<string, ReturnType<typeof createTextMaterial>>();
		const label = (
			text: string,
			x: number,
			y: number,
			fontSize = 1.3,
			align: "left" | "center" = "center",
			maxWidth = Infinity,
		) => {
			let glyphs = labels.get(text);
			if (!glyphs) {
				glyphs = own(() => createTextMaterial(text));
				glyphs.material.color.set(color);
				labels.set(text, glyphs);
			}
			const size = updateText(
				{
					id: -1,
					kind: "text",
					text,
					fontSize,
					x,
					y,
					width: 1,
					height: 1,
					rotation: 0,
					lineWidth: 0,
				},
				text,
			);
			const mesh = new Mesh(glyphPlane, glyphs.material);
			const fit = Math.min(1, maxWidth / size.width);
			mesh.name = `Worksheet: ${text}`;
			mesh.position.set(
				align === "left" ? x + (size.width * fit) / 2 : x,
				y,
				0,
			);
			mesh.scale.set(size.width * fit, size.height * fit, 1);
			mesh.renderOrder = -1;
			paper.add(mesh);
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

		const frame = new LineSegments(
			own(() => new BufferGeometry().setFromPoints(segments)),
			own(
				() =>
					new LineBasicMaterial({ color, depthTest: false, depthWrite: false }),
			),
		);
		frame.name = "Worksheet frame";
		frame.renderOrder = -2;
		paper.add(frame);

		// Fit-to-sheet uses the physical page edge, including its print margins.
		segments.length = 0;
		rectangle(-width / 2, -height / 2, width / 2, height / 2);
		const edge = new LineSegments(
			own(() => new BufferGeometry().setFromPoints(segments)),
			own(
				() =>
					new LineBasicMaterial({
						color: "#59616e",
						depthTest: false,
						depthWrite: false,
					}),
			),
		);
		edge.name = "Paper edge";
		edge.renderOrder = -2;
		paper.add(edge);
		return { paper, dispose: lifetime.dispose };
	} catch (error) {
		lifetime.dispose();
		throw error;
	}
}
