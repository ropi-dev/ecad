import { useCallback, useEffect, useState } from "react";
import {
	BufferGeometry,
	Group,
	LineBasicMaterial,
	LineLoop,
	Mesh,
	MeshBasicMaterial,
	type Object3D,
	Vector3,
} from "three";
import type { ViewerScene } from "#/engine/scene";
import { createLifecycle } from "#/lib/lifecycle";
import { createShapeGeometry } from "./shapeGeometry";
import { A3, type EditorShape } from "./shapes";

function createEditorAssets() {
	const lifetime = createLifecycle();
	const own = <A extends { dispose(): void }>(acquire: () => A) =>
		lifetime.acquire(acquire, (resource) => resource.dispose());
	try {
		const geometries = new Map<
			number,
			{ key: string; geometry: BufferGeometry }
		>();
		lifetime.acquire(
			() => geometries,
			(cache) => {
				for (const { geometry } of cache.values()) geometry.dispose();
				cache.clear();
			},
		);
		const geometryFor = (shape: EditorShape) => {
			const key = `${shape.kind}:${shape.width}:${shape.height}:${shape.lineWidth}:${shape.kind === "symbol" ? JSON.stringify(shape.children) : ""}`;
			const cached = geometries.get(shape.id);
			if (cached?.key === key) return cached.geometry;
			cached?.geometry.dispose();
			const geometry = createShapeGeometry(shape);
			geometries.set(shape.id, { key, geometry });
			return geometry;
		};
		const frame = own(() => new BufferGeometry()).setFromPoints([
			new Vector3(-0.5, -0.5, 0),
			new Vector3(0.5, -0.5, 0),
			new Vector3(0.5, 0.5, 0),
			new Vector3(-0.5, 0.5, 0),
		]);
		const stroke = own(
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
			stroke,
			geometryFor,
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
	previews: EditorShape[] = [],
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
			// Dispose cached strokes when their shapes are removed, including canceled previews.
			const activeIds = new Set(shapes.map((shape) => shape.id));
			for (const preview of previews) activeIds.add(preview.id);
			for (const [id, { geometry }] of assets.geometries) {
				if (activeIds.has(id)) continue;
				geometry.dispose();
				assets.geometries.delete(id);
			}
			drawing.clear();
			for (const [index, shape] of shapes.entries()) {
				const size = shape;
				const mesh = new Mesh(
					assets.geometryFor(shape),
					selectedIds.has(shape.id) ? assets.selected : assets.stroke,
				);
				mesh.name = `${shape.kind} ${shape.id}`;
				mesh.position.set(shape.x, shape.y, 0);
				mesh.scale.set(
					size.width,
					shape.kind === "wire" ? shape.lineWidth : size.height,
					1,
				);
				mesh.rotation.z = shape.rotation;
				mesh.renderOrder = index + 1;
				drawing.add(mesh);
				if (selectedIds.has(shape.id)) {
					const outline = new LineLoop(assets.frame, assets.selection);
					outline.position.copy(mesh.position);
					outline.rotation.copy(mesh.rotation);
					outline.scale.set(size.width + 4, mesh.scale.y + 4, 1);
					outline.renderOrder = shapes.length + 1;
					drawing.add(outline);
				}
			}
			root.getObjectByName("editor-wire-preview")?.removeFromParent();
			root.getObjectByName("editor-wire-tail-preview")?.removeFromParent();
			root.getObjectByName("editor-symbol-preview")?.removeFromParent();
			for (const [index, wirePreview] of previews.entries()) {
				if (wirePreview.width <= 0) continue;
				const preview = new Mesh(
					assets.geometryFor(wirePreview),
					assets.selected,
				);
				preview.name =
					wirePreview.kind === "symbol"
						? "editor-symbol-preview"
						: index === 0
							? "editor-wire-preview"
							: "editor-wire-tail-preview";
				preview.position.set(wirePreview.x, wirePreview.y, 0);
				preview.scale.set(
					wirePreview.width,
					wirePreview.kind === "wire"
						? wirePreview.lineWidth
						: wirePreview.height,
					1,
				);
				preview.rotation.z = wirePreview.rotation;
				preview.renderOrder = shapes.length + 2;
				root.add(preview);
			}
		},
		[assets, shapes, selectedIds, previews],
	);
	return { scene: assets?.scene, updateScene };
}
