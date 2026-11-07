import {
	drawShape,
	type EditorShape,
	pinTerminals,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { buildPreviewDisplay, buildStaticDisplay } from "#/drawing/display.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { buildWorksheetDisplay } from "#/drawing/worksheet.ts";
import { createDrawingRenderer } from "#/engine/drawing/renderer.ts";
import { measureText } from "#/engine/drawing/text.ts";
import { createSceneViewport } from "#/engine/scene-viewport.ts";
import { required } from "../helpers/required.ts";

function fixture() {
	const resistor = required(
		symbolDefinitions.find((definition) => definition.id === "resistor"),
	);
	const shapes: EditorShape[] = [];
	let id = 1;
	for (let row = 0; row < 3; row++) {
		let previous: EditorShape | undefined;
		for (let column = 0; column < 4; column++) {
			const part = createSymbol(id++, resistor, {
				x: -38.1 + column * 25.4,
				y: -15.24 + row * 15.24,
			});
			shapes.push(part);
			if (previous) {
				const [start] = pinTerminals(previous).slice(1);
				const [end] = pinTerminals(part);
				shapes.push(drawShape(id++, "wire", start, end));
			}
			previous = part;
		}
	}
	shapes.push(
		drawShape(id++, "wire", { x: -25.4, y: -25.4 }, { x: -25.4, y: 25.4 }),
		drawShape(id++, "wire", { x: 0, y: -25.4 }, { x: 0, y: 0 }),
		drawShape(id++, "wire", { x: -12.7, y: -7.62 }, { x: 12.7, y: -7.62 }),
		drawShape(id++, "rectangle", { x: 30, y: 20 }, { x: 45, y: 28 }),
		drawShape(id++, "circle", { x: -45, y: 20 }, { x: -38, y: 27 }),
		{
			...drawShape(id++, "line", { x: -45, y: -28 }, { x: -20, y: -28 }),
			lineStyle: "dashed",
		} as EditorShape,
		drawShape(id++, "no-connect", { x: 40, y: -25 }, { x: 40, y: -25 }),
	);
	return shapes;
}

const base = fixture();
const sheet = buildWorksheetDisplay({ width: 120, height: 80, name: "Test" });

interface State {
	selected?: number[];
	moved?: Record<number, [number, number]>;
	removed?: number[];
	preview?: [number, number];
	renamed?: Record<number, string>;
}

const views = (["batched", "meshes"] as const).map((name) => {
	const renderer = createDrawingRenderer(sheet);
	let display = {
		...buildStaticDisplay(base, new Set(), measureText),
		previews: [],
	} as ReturnType<typeof buildStaticDisplay> & {
		previews: ReturnType<typeof buildPreviewDisplay>;
	};
	const runtime = createSceneViewport(required(document.getElementById(name)), {
		scene: renderer.scene,
		cameraMode: "top",
		projection: "orthographic",
		lockProjection: true,
		fitZoom: 1.1,
		selectionEnabled: name === "meshes",
		updateScene: (root) => renderer.update(root, display),
	});
	runtime.resize(480, 360);
	return {
		runtime,
		show(next: typeof display) {
			display = next;
			runtime.update((root) => renderer.update(root, display));
		},
	};
});

const frames = (count: number) =>
	new Promise<void>((resolve) => {
		const step = (left: number) =>
			left ? requestAnimationFrame(() => step(left - 1)) : resolve();
		step(count);
	});

Object.assign(window, {
	harness: {
		async show({
			selected = [],
			moved = {},
			removed = [],
			preview,
			renamed = {},
		}: State) {
			const shapes = base
				.filter((shape) => !removed.includes(shape.id))
				.map((shape) => {
					const offset = moved[shape.id];
					return offset
						? { ...shape, x: shape.x + offset[0], y: shape.y + offset[1] }
						: shape;
				})
				.map((shape) =>
					shape.kind === "symbol" && renamed[shape.id]
						? {
								...shape,
								attributes: {
									...shape.attributes,
									reference: renamed[shape.id],
								},
							}
						: shape,
				);
			const resistor = required(
				symbolDefinitions.find((definition) => definition.id === "resistor"),
			);
			const previews = preview
				? [createSymbol(999, resistor, { x: preview[0], y: preview[1] })]
				: [];
			const display = {
				...buildStaticDisplay(shapes, new Set(selected), measureText),
				previews: buildPreviewDisplay(previews, shapes.length, measureText),
			};
			for (const view of views) view.show(display);
			await frames(3);
		},
		async pan(x: number, y: number) {
			for (const view of views) view.runtime.pan(x, y);
			await frames(3);
		},
		async redraw() {
			views[0].runtime.zoom(1);
			await frames(3);
		},
	},
});
