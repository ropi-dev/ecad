import { Effect } from "effect";
import { placeRectangleEffect, replaceShapesEffect, removeShapesEffect } from "#/commands/drawing-commands.ts";
import { createDrawingStore, DrawingStore } from "#/commands/drawing-store.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LineLoop, Mesh, MeshBasicMaterial, Scene, Vector3 } from "three";
import { Editor2D } from "#/components/editor/Editor2D.tsx";
import { SymbolLibraryProvider } from "#/symbol-library/storage.tsx";
import { createWebSymbolLibraryStorage } from "#web/symbol-library/storage.ts";
import type { SheetSize } from "#/drawing/worksheet.ts";
import "#/styles.css";

Scene.prototype.onAfterRender = function (renderer, _scene, camera) {
	const shapes = this.getObjectByName("editor-shapes");
	const preview = this.getObjectByName("editor-wire-preview");
	const origin = new Vector3(0, 0, 0).project(camera);
	const corner = new Vector3(420, 297, 0).project(camera);
	const pinTexts: { name: string; texture?: string; rotation: number }[] = [];
	shapes?.traverse((child) => {
		if (child instanceof Mesh && /^pin (name|number) /.test(child.name))
			pinTexts.push({ name: child.name, texture: child.material instanceof MeshBasicMaterial ? child.material.map?.uuid : undefined, rotation: child.rotation.z + (child.parent?.rotation.z ?? 0) });
	});
	document.querySelector("#editor-scene")!.textContent = JSON.stringify({
		pinTexts,
		worksheet: this.getObjectByName("Worksheet frame")?.parent?.name,
		camera: camera.type,
		textures: renderer.info.memory.textures,
		outlines: shapes?.children.filter((shape) => shape instanceof LineLoop).map((shape) => ({ width: shape.scale.x, height: shape.scale.y })),
		wireTerminals: this.getObjectByName("editor-wire-terminals")?.children.map((terminal) => ({ x: terminal.position.x, y: terminal.position.y, width: terminal.scale.x, height: terminal.scale.y })),
		direction: camera.getWorldDirection(new Vector3()).toArray(),
		origin: origin.toArray(), corner: corner.toArray(),
		preview: preview instanceof Mesh ? { width: preview.scale.x, height: preview.scale.y, rotation: preview.rotation.z, x: preview.position.x, y: preview.position.y } : null,
		shapes: shapes?.children.filter((shape) => shape instanceof Mesh).map((shape) => ({ name: shape.name, texture: shape.material instanceof MeshBasicMaterial ? shape.material.map?.uuid : undefined, width: shape.scale.x, height: shape.scale.y, rotation: shape.rotation.z, x: shape.position.x, y: shape.position.y, selected: shape.material instanceof MeshBasicMaterial && shape.material.color.getHexString() === "e8b77e" })),
		symbolTexts: shapes?.children.filter((shape) => shape instanceof Mesh && shape.name.startsWith("symbol ")).flatMap((symbol) => symbol.children.filter((child) => child instanceof Mesh).map((child) => ({ symbol: symbol.name, name: child.name, texture: child.material instanceof MeshBasicMaterial ? child.material.map?.uuid : undefined, x: child.getWorldPosition(new Vector3()).x, y: child.getWorldPosition(new Vector3()).y }))),
	});
};

export const drawingStore = createDrawingStore();
export function placeRectangle(input: Parameters<typeof placeRectangleEffect>[0]) {
	return Effect.runSync(placeRectangleEffect(input).pipe(Effect.provideService(DrawingStore, drawingStore)));
}
export function replaceShapes(shapes: Parameters<typeof replaceShapesEffect>[0]) {
	return Effect.runSync(replaceShapesEffect(shapes, "External edit").pipe(Effect.provideService(DrawingStore, drawingStore)));
}
export function removeShapes(ids: number[]) {
	return Effect.runSync(removeShapesEffect(ids).pipe(Effect.provideService(DrawingStore, drawingStore)));
}
const showDocument = () => {
	const snapshot = drawingStore.getSnapshot();
	document.querySelector("#editor-document")!.textContent = JSON.stringify({
		shapes: snapshot.shapes,
		historyId: snapshot.history.currentId,
		historySize: Object.keys(snapshot.history.nodes).length,
		nextShapeId: snapshot.nextShapeId,
	});
};
drawingStore.subscribe(showDocument);
showDocument();
const root = createRoot(document.getElementById("root")!);
const symbolLibraryStorage = createWebSymbolLibraryStorage();
function renderEditor(sheet?: SheetSize) {
	root.render(<StrictMode><SymbolLibraryProvider storage={symbolLibraryStorage}><Editor2D sheet={sheet} store={drawingStore} /></SymbolLibraryProvider></StrictMode>);
}
window.addEventListener("editor-sheet-size", (event) => {
	renderEditor((event as CustomEvent<SheetSize>).detail);
});
renderEditor();
