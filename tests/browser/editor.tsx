import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LineLoop, Mesh, MeshBasicMaterial, Scene, Vector3 } from "three";
import { Editor2D } from "../../src/components/editor/Editor2D";
import type { SheetSize } from "../../src/components/editor/worksheet";
import "../../src/styles.css";

Scene.prototype.onAfterRender = function (renderer, _scene, camera) {
	const shapes = this.getObjectByName("editor-shapes");
	const preview = this.getObjectByName("editor-wire-preview");
	const origin = new Vector3(0, 0, 0).project(camera);
	const corner = new Vector3(420, 297, 0).project(camera);
	document.querySelector("#editor-scene")!.textContent = JSON.stringify({
		worksheet: this.getObjectByName("Worksheet frame")?.parent?.name,
		camera: camera.type,
		textures: renderer.info.memory.textures,
		outlines: shapes?.children.filter((shape) => shape instanceof LineLoop).map((shape) => ({ width: shape.scale.x, height: shape.scale.y })),
		wireTerminals: this.getObjectByName("editor-wire-terminals")?.children.map((terminal) => ({ x: terminal.position.x, y: terminal.position.y, width: terminal.scale.x, height: terminal.scale.y })),
		direction: camera.getWorldDirection(new Vector3()).toArray(),
		origin: origin.toArray(), corner: corner.toArray(),
		preview: preview instanceof Mesh ? { width: preview.scale.x, height: preview.scale.y, rotation: preview.rotation.z, x: preview.position.x, y: preview.position.y } : null,
		shapes: shapes?.children.filter((shape) => shape instanceof Mesh).map((shape) => ({ name: shape.name, texture: shape.material instanceof MeshBasicMaterial ? shape.material.map?.uuid : undefined, width: shape.scale.x, height: shape.scale.y, rotation: shape.rotation.z, x: shape.position.x, y: shape.position.y, selected: shape.material instanceof MeshBasicMaterial && shape.material.color.getHexString() === "e8b77e" })),
	});
};

const root = createRoot(document.getElementById("root")!);
function renderEditor(sheet?: SheetSize) {
	root.render(<StrictMode><Editor2D sheet={sheet} /></StrictMode>);
}
window.addEventListener("editor-sheet-size", (event) => {
	renderEditor((event as CustomEvent<SheetSize>).detail);
});
renderEditor();
