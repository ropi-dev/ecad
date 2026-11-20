import {
	placeRectangleEffect,
	replaceShapesEffect,
} from "@ecad/drawing-core/commands/drawing-commands.ts";
import {
	createDrawingStore,
	DrawingStore,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import { render } from "@solidjs/web";
import { Effect } from "effect";
import { Mesh, MeshBasicMaterial, Scene, Vector3 } from "three";
import { Editor2D } from "#/components/editor/Editor2D.tsx";
import { darkSchematicTheme } from "#/drawing/schematic-theme.ts";
import { SymbolLibraryProvider } from "#/symbol-library/SymbolLibraryProvider.tsx";
import { createWebSymbolLibraryStorage } from "#web/symbol-library/storage.ts";
import { required } from "../helpers/required.ts";
import "#/styles.css";

Scene.prototype.onAfterRender = function (_renderer, _scene, camera) {
	const shapes = this.getObjectByName("editor-shapes");
	const preview = this.getObjectByName("editor-wire-preview");
	const placement =
		this.getObjectByName("editor-symbol-preview") ??
		this.getObjectByName("editor-shape-preview");
	const origin = new Vector3(0, 0, 0).project(camera);
	const corner = new Vector3(420, 297, 0).project(camera);
	required(document.querySelector("#editor-scene")).textContent =
		JSON.stringify({
			placement: placement
				? {
						x: placement.position.x,
						y: placement.position.y,
						rotation: placement.rotation.z,
					}
				: null,
			worksheet: this.getObjectByName("Worksheet frame")?.parent?.name,
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
export function replaceShapes(
	shapes: Parameters<typeof replaceShapesEffect>[0],
) {
	return Effect.runSync(
		replaceShapesEffect(shapes, "External edit").pipe(
			Effect.provideService(DrawingStore, drawingStore),
		),
	);
}
const showDocument = () => {
	const snapshot = drawingStore.getSnapshot();
	required(document.querySelector("#editor-document")).textContent =
		JSON.stringify({
			shapes: snapshot.shapes,
			sheet: snapshot.sheet,
		});
};
drawingStore.subscribe(showDocument);
showDocument();
const symbolLibraryStorage = createWebSymbolLibraryStorage();
render(
	() => (
		<SymbolLibraryProvider storage={symbolLibraryStorage}>
			<Editor2D store={drawingStore} />
		</SymbolLibraryProvider>
	),
	required(document.getElementById("root")),
);
