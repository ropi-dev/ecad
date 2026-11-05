import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import {
	BufferGeometry,
	Group,
	LineBasicMaterial,
	LineSegments,
	Mesh,
	PlaneGeometry,
	Vector3,
} from "three";
import { darkSchematicTheme } from "#/drawing/schematic-theme.ts";
import { updateText } from "#/drawing/text.ts";
import {
	buildWorksheetDisplay,
	defaultSheet,
	type SheetSize,
	type WorksheetDisplay,
} from "#/drawing/worksheet.ts";
import { createTextMaterial, measureText } from "#/engine/drawing/text.ts";
import { createLifecycle } from "#/lib/lifecycle.ts";

export function createWorksheet(sheet: SheetSize = defaultSheet) {
	return createWorksheetFromDisplay(buildWorksheetDisplay(sheet));
}

/** Owns the GPU resources for a resolved worksheet layout. */
export function createWorksheetFromDisplay(display: WorksheetDisplay) {
	const lifetime = createLifecycle();
	const resources: { dispose(): void }[] = [];
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
		paper.name = display.name;
		const color = darkSchematicTheme.sheet;
		const glyphPlane = own(() => new PlaneGeometry(1, 1));
		const labels = new Map<string, ReturnType<typeof createTextMaterial>>();
		for (const { text, x, y, fontSize, align, maxWidth } of display.labels) {
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
				measureText,
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
		}
		const addLines = (name: string, points: Point[], color: string) => {
			const lines = new LineSegments(
				own(() =>
					new BufferGeometry().setFromPoints(
						points.map(({ x, y }) => new Vector3(x, y, 0)),
					),
				),
				own(
					() =>
						new LineBasicMaterial({
							color,
							depthTest: false,
							depthWrite: false,
						}),
				),
			);
			lines.name = name;
			lines.renderOrder = -2;
			paper.add(lines);
		};
		addLines("Worksheet frame", display.frame, color);
		addLines("Paper edge", display.edge, darkSchematicTheme.paperEdge);
		return { paper, dispose: lifetime.dispose };
	} catch (error) {
		lifetime.dispose();
		throw error;
	}
}
