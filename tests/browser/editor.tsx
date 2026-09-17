import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Mesh, MeshBasicMaterial, Scene, Vector3 } from "three";
import { Editor2D } from "../../src/components/editor/Editor2D";
import "../../src/styles.css";

Scene.prototype.onAfterRender = function (_renderer, _scene, camera) {
	const shapes = this.getObjectByName("editor-shapes");
	const origin = new Vector3(0, 0, 0).project(camera);
	const corner = new Vector3(420, 297, 0).project(camera);
	document.querySelector("#editor-scene")!.textContent = JSON.stringify({
		camera: camera.type,
		direction: camera.getWorldDirection(new Vector3()).toArray(),
		origin: origin.toArray(), corner: corner.toArray(),
		shapes: shapes?.children.filter((shape) => shape instanceof Mesh).map((shape) => ({ name: shape.name, width: shape.scale.x, height: shape.scale.y, rotation: shape.rotation.z, x: shape.position.x, y: shape.position.y, selected: shape.material instanceof MeshBasicMaterial && shape.material.color.getHexString() === "e8b77e" })),
	});
};

createRoot(document.getElementById("root")!).render(<StrictMode><Editor2D /></StrictMode>);
