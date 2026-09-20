import { useCallback, useEffect, useState } from "react";
import {
	BufferGeometry,
	CircleGeometry,
	Group,
	LineBasicMaterial,
	LineLoop,
	Mesh,
	MeshBasicMaterial,
	type Object3D,
	PlaneGeometry,
	Shape,
	ShapeGeometry,
	Vector3,
} from "three";
import type { ViewerScene } from "#/engine/scene";
import { A3, type EditorShape } from "./shapes";

function createEditorAssets() {
	const triangle = new Shape();
	triangle.moveTo(-0.5, -0.5);
	triangle.lineTo(0.5, -0.5);
	triangle.lineTo(0, 0.5);
	triangle.closePath();
	const geometries = {
		rectangle: new PlaneGeometry(1, 1),
		circle: new CircleGeometry(0.5, 96),
		triangle: new ShapeGeometry(triangle),
		line: new PlaneGeometry(1, 1),
	};
	const frame = new BufferGeometry().setFromPoints([
		new Vector3(-0.5, -0.5, 0),
		new Vector3(0.5, -0.5, 0),
		new Vector3(0.5, 0.5, 0),
		new Vector3(-0.5, 0.5, 0),
	]);
	const fill = new MeshBasicMaterial({ color: "#76c4c0", depthTest: false });
	const selected = new MeshBasicMaterial({
		color: "#e8b77e",
		depthTest: false,
	});
	const border = new LineBasicMaterial({ color: "#9ba7b8", depthTest: false });
	const selection = new LineBasicMaterial({
		color: "#e8b77e",
		depthTest: false,
	});
	const paper = new Group();
	const outline = new LineLoop(frame, border);
	outline.scale.set(A3.width, A3.height, 1);
	outline.name = "A3 landscape, 420 × 297 mm";
	paper.add(outline);
	const scene: ViewerScene = [{ type: "spatial", object: paper }];
	return {
		scene,
		geometries,
		frame,
		fill,
		selected,
		selection,
		dispose() {
			for (const geometry of Object.values(geometries)) geometry.dispose();
			frame.dispose();
			for (const material of [fill, selected, border, selection])
				material.dispose();
		},
	};
}

export function useEditorScene(
	shapes: EditorShape[],
	selectedIds: ReadonlySet<number>,
) {
	const [assets, setAssets] = useState<ReturnType<typeof createEditorAssets>>();
	useEffect(() => {
		const next = createEditorAssets();
		setAssets(next);
		return () => next.dispose();
	}, []);
	const updateScene = useCallback(
		(root: Object3D) => {
			if (!assets) return;
			let drawing = root.getObjectByName("editor-shapes");
			if (!drawing) {
				drawing = new Group();
				drawing.name = "editor-shapes";
				root.add(drawing);
			}
			// Geometry and materials are shared and owned by this hook, including removed shapes.
			drawing.clear();
			for (const [index, shape] of shapes.entries()) {
				const size = shape;
				const mesh = new Mesh(
					assets.geometries[shape.kind],
					selectedIds.has(shape.id) ? assets.selected : assets.fill,
				);
				mesh.name = `${shape.kind} ${shape.id}`;
				mesh.position.set(shape.x, shape.y, 0);
				mesh.scale.set(size.width, size.height, 1);
				mesh.rotation.z = shape.rotation;
				mesh.renderOrder = index + 1;
				drawing.add(mesh);
				if (selectedIds.has(shape.id)) {
					const outline = new LineLoop(assets.frame, assets.selection);
					outline.position.copy(mesh.position);
					outline.rotation.copy(mesh.rotation);
					outline.scale.set(size.width + 4, size.height + 4, 1);
					outline.renderOrder = shapes.length + 1;
					drawing.add(outline);
				}
			}
		},
		[assets, shapes, selectedIds],
	);
	return { scene: assets?.scene, updateScene };
}
