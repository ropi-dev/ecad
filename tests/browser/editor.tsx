import {
	placeRectangleEffect,
	placeShapesEffect,
	removeShapesEffect,
	replaceShapesEffect,
} from "@ecad/drawing-core/commands/drawing-commands.ts";
import {
	createDrawingStore,
	DrawingStore,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import { Effect } from "effect";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LineLoop, Mesh, MeshBasicMaterial, Scene, Vector3 } from "three";
import { Editor2D } from "#/components/editor/Editor2D.tsx";
import { darkSchematicTheme } from "#/drawing/schematic-theme.ts";
import type { SheetSize } from "#/drawing/worksheet.ts";
import { SymbolLibraryProvider } from "#/symbol-library/storage.tsx";
import { createWebSymbolLibraryStorage } from "#web/symbol-library/storage.ts";
import { required } from "../helpers/required.ts";
import "#/styles.css";

Scene.prototype.onAfterRender = function (renderer, _scene, camera) {
	const shapes = this.getObjectByName("editor-shapes");
	const preview = this.getObjectByName("editor-wire-preview");
	const placement =
		this.getObjectByName("editor-symbol-preview") ??
		this.getObjectByName("editor-shape-preview");
	const origin = new Vector3(0, 0, 0).project(camera);
	const corner = new Vector3(420, 297, 0).project(camera);
	const pinTexts: { name: string; texture?: string; rotation: number }[] = [];
	const symbolStaticTexts: {
		name: string;
		rotation: number;
		x: number;
		y: number;
	}[] = [];
	shapes?.traverse((child) => {
		if (child instanceof Mesh && /^text \d+:\d+$/.test(child.name))
			symbolStaticTexts.push({
				name: child.name,
				rotation: child.rotation.z,
				x: child.position.x,
				y: child.position.y,
			});
		if (child instanceof Mesh && /^pin (name|number) /.test(child.name))
			pinTexts.push({
				name: child.name,
				texture:
					child.material instanceof MeshBasicMaterial
						? child.material.alphaMap?.uuid
						: undefined,
				rotation: child.rotation.z + (child.parent?.rotation.z ?? 0),
			});
	});
	required(document.querySelector("#editor-scene")).textContent =
		JSON.stringify({
			placement: placement
				? {
						x: placement.position.x,
						y: placement.position.y,
						rotation: placement.rotation.z,
					}
				: null,
			pinTexts,
			symbolStaticTexts,
			worksheet: this.getObjectByName("Worksheet frame")?.parent?.name,
			camera: camera.type,
			textures: renderer.info.memory.textures,
			outlines: shapes?.children
				.filter((shape) => shape instanceof LineLoop)
				.map((shape) => ({ width: shape.scale.x, height: shape.scale.y })),
			wireTerminals: this.getObjectByName(
				"editor-wire-terminals",
			)?.children.map((terminal) => ({
				x: terminal.position.x,
				y: terminal.position.y,
				width: terminal.scale.x,
				height: terminal.scale.y,
			})),
			wireJunctions: this.getObjectByName(
				"editor-wire-junctions",
			)?.children.map((junction) => ({
				x: junction.position.x,
				y: junction.position.y,
				width: junction.scale.x,
				height: junction.scale.y,
			})),
			wireBridges: shapes?.children
				.filter((shape) => {
					if (!(shape instanceof Mesh) || !shape.name.startsWith("wire "))
						return false;
					shape.geometry.computeBoundingBox();
					return (
						(shape.geometry.boundingBox?.max.y ?? 0) > 0.51 ||
						(shape.geometry.boundingBox?.min.y ?? 0) < -0.51
					);
				})
				.map((shape) => shape.name),
			direction: camera.getWorldDirection(new Vector3()).toArray(),
			origin: origin.toArray(),
			corner: corner.toArray(),
			preview:
				preview instanceof Mesh
					? {
							width: preview.scale.x,
							height: preview.scale.y,
							rotation: preview.rotation.z,
							x: preview.position.x,
							y: preview.position.y,
						}
					: null,
			shapes: shapes?.children
				.filter((shape) => shape instanceof Mesh)
				.map((shape) => ({
					name: shape.name,
					color:
						shape.material instanceof MeshBasicMaterial
							? shape.material.color.getHexString()
							: undefined,
					texture:
						shape.material instanceof MeshBasicMaterial
							? shape.material.alphaMap?.uuid
							: undefined,
					width: shape.scale.x,
					height: shape.scale.y,
					rotation: shape.rotation.z,
					x: shape.position.x,
					y: shape.position.y,
					selected:
						shape.material instanceof MeshBasicMaterial &&
						shape.material.color.getHexString() ===
							darkSchematicTheme.appearance.selected.slice(1),
				})),
			symbolTexts: shapes?.children
				.filter(
					(shape) => shape instanceof Mesh && shape.name.startsWith("symbol "),
				)
				.flatMap((symbol) =>
					symbol.children
						.filter((child) => child instanceof Mesh)
						.map((child) => ({
							symbol: symbol.name,
							name: child.name,
							corners: [new Vector3(-0.5, 0, 0), new Vector3(0.5, 0, 0)].map(
								(point) => child.localToWorld(point).toArray(),
							),
							texture:
								child.material instanceof MeshBasicMaterial
									? child.material.alphaMap?.uuid
									: undefined,
							x: child.getWorldPosition(new Vector3()).x,
							y: child.getWorldPosition(new Vector3()).y,
						})),
				),
		});
};

export const drawingStore = createDrawingStore();
export function placeRectangle(
	input: Parameters<typeof placeRectangleEffect>[0],
) {
	return Effect.runSync(
		placeRectangleEffect(input).pipe(
			Effect.provideService(DrawingStore, drawingStore),
		),
	);
}
export function placeShapes(shapes: Parameters<typeof placeShapesEffect>[0]) {
	return Effect.runSync(
		placeShapesEffect(shapes, "External place").pipe(
			Effect.provideService(DrawingStore, drawingStore),
		),
	);
}
export function replaceShapes(
	shapes: Parameters<typeof replaceShapesEffect>[0],
) {
	return Effect.runSync(
		replaceShapesEffect(shapes, "External edit").pipe(
			Effect.provideService(DrawingStore, drawingStore),
		),
	);
}
export function removeShapes(ids: number[]) {
	return Effect.runSync(
		removeShapesEffect(ids).pipe(
			Effect.provideService(DrawingStore, drawingStore),
		),
	);
}
const showDocument = () => {
	const snapshot = drawingStore.getSnapshot();
	required(document.querySelector("#editor-document")).textContent =
		JSON.stringify({
			shapes: snapshot.shapes,
			historyId: snapshot.history.currentId,
			historySize: Object.keys(snapshot.history.nodes).length,
			nextShapeId: snapshot.nextShapeId,
		});
};
drawingStore.subscribe(showDocument);
showDocument();
const root = createRoot(required(document.getElementById("root")));
const symbolLibraryStorage = createWebSymbolLibraryStorage();
function renderEditor(sheet?: SheetSize) {
	root.render(
		<StrictMode>
			<SymbolLibraryProvider storage={symbolLibraryStorage}>
				<Editor2D sheet={sheet} store={drawingStore} />
			</SymbolLibraryProvider>
		</StrictMode>,
	);
}
window.addEventListener("editor-sheet-size", (event) => {
	renderEditor((event as CustomEvent<SheetSize>).detail);
});
renderEditor();
