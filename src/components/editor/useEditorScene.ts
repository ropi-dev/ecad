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
import { createLifecycle } from "#/lib/lifecycle";
import { A3, type EditorShape } from "./shapes";

function createEditorAssets() {
	const lifetime = createLifecycle();
	const own = <A extends { dispose(): void }>(acquire: () => A) =>
		lifetime.acquire(acquire, (resource) => resource.dispose());
	try {
		const triangle = new Shape();
		triangle.moveTo(-0.5, -0.5);
		triangle.lineTo(0.5, -0.5);
		triangle.lineTo(0, 0.5);
		triangle.closePath();
		const geometries = {
			rectangle: own(() => new PlaneGeometry(1, 1)),
			circle: own(() => new CircleGeometry(0.5, 96)),
			triangle: own(() => new ShapeGeometry(triangle)),
			line: own(() => new PlaneGeometry(1, 1)),
		};
		const frame = own(() => new BufferGeometry()).setFromPoints([
			new Vector3(-0.5, -0.5, 0),
			new Vector3(0.5, -0.5, 0),
			new Vector3(0.5, 0.5, 0),
			new Vector3(-0.5, 0.5, 0),
		]);
		const fill = own(
			() => new MeshBasicMaterial({ color: "#76c4c0", depthTest: false }),
		);
		const selected = own(
			() =>
				new MeshBasicMaterial({
					color: "#e8b77e",
					depthTest: false,
				}),
		);
		const border = own(
			() => new LineBasicMaterial({ color: "#9ba7b8", depthTest: false }),
		);
		const selection = own(
			() =>
				new LineBasicMaterial({
					color: "#e8b77e",
					depthTest: false,
				}),
		);
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
			dispose: lifetime.dispose,
		};
	} catch (error) {
		lifetime.dispose();
		throw error;
	}
}

export function useEditorScene(
	shapes: EditorShape[],
	selectedIds: ReadonlySet<number>,
	linePreview: EditorShape | null = null,
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
			root.getObjectByName("editor-line-preview")?.removeFromParent();
			if (linePreview && linePreview.width > 0) {
				const preview = new Mesh(assets.geometries.line, assets.selected);
				preview.name = "editor-line-preview";
				preview.position.set(linePreview.x, linePreview.y, 0);
				preview.scale.set(linePreview.width, linePreview.height, 1);
				preview.rotation.z = linePreview.rotation;
				preview.renderOrder = shapes.length + 2;
				root.add(preview);
			}
		},
		[assets, shapes, selectedIds, linePreview],
	);
	return { scene: assets?.scene, updateScene };
}
