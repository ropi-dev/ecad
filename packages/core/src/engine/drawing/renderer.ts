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
import type {
	DisplayShape,
	DrawingDisplay,
	DrawingTransform,
} from "#/drawing/display.ts";
import type { WorksheetDisplay } from "#/drawing/worksheet.ts";
import { createLifecycle } from "#/lib/lifecycle.ts";
import type { ViewerScene } from "../scene";
import { createShapeGeometry } from "./shapeGeometry";
import { createTextMaterial } from "./text";
import { createWorksheetFromDisplay } from "./worksheet";

function applyTransform(
	object: Object3D,
	display: DrawingTransform & { renderOrder: number },
) {
	object.position.set(display.x, display.y, 0);
	object.scale.set(display.width, display.height, 1);
	object.rotation.z = display.rotation;
	object.renderOrder = display.renderOrder;
}

/** Converts display data to Three objects and owns their shared GPU resources. */
export function createDrawingRenderer(worksheet: WorksheetDisplay | null) {
	const lifetime = createLifecycle();
	const own = <A extends { dispose(): void }>(acquire: () => A) =>
		lifetime.acquire(acquire, (resource) => resource.dispose());
	try {
		const geometries = new Map<
			string,
			{ key: string; geometry: BufferGeometry }
		>();
		const texts = new Map<
			string,
			ReturnType<typeof createTextMaterial> & { text: string }
		>();
		lifetime.addFinalizer(() => {
			for (const { geometry } of geometries.values()) geometry.dispose();
			geometries.clear();
			for (const text of texts.values()) text.dispose();
			texts.clear();
		});
		const geometryFor = (display: DisplayShape) => {
			const key = JSON.stringify(display.geometry);
			const cached = geometries.get(display.key);
			if (cached?.key === key) return cached.geometry;
			const geometry = createShapeGeometry(display.geometry);
			cached?.geometry.dispose();
			geometries.set(display.key, { key, geometry });
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
			() => new MeshBasicMaterial({ color: "#e8b77e", depthTest: false }),
		);
		const selection = own(
			() => new LineBasicMaterial({ color: "#e8b77e", depthTest: false }),
		);
		const materialFor = (display: DisplayShape) => {
			const color = display.appearance === "selected" ? selected : stroke;
			if (display.text === undefined) return color;
			let cached = texts.get(display.key);
			if (!cached || cached.text !== display.text) {
				const next = {
					...createTextMaterial(display.text),
					text: display.text,
				};
				cached?.dispose();
				cached = next;
				texts.set(display.key, cached);
			}
			cached.material.color.copy(color.color);
			return cached.material;
		};
		const meshFor = (display: DisplayShape) => {
			const mesh = new Mesh(geometryFor(display), materialFor(display));
			mesh.name = display.name;
			applyTransform(mesh, display);
			for (const child of display.children ?? []) mesh.add(meshFor(child));
			return mesh;
		};
		const scene: ViewerScene = worksheet
			? [
					{
						type: "spatial",
						object: own(() => createWorksheetFromDisplay(worksheet)).paper,
					},
				]
			: [];
		const drawing = new Group();
		drawing.name = "editor-shapes";
		const previews: Object3D[] = [];
		const clearPreviews = () => {
			for (const preview of previews.splice(0)) preview.removeFromParent();
		};
		lifetime.addFinalizer(() => {
			clearPreviews();
			drawing.clear();
			drawing.removeFromParent();
		});
		const update = (root: Object3D, display: DrawingDisplay) => {
			const meshes = [
				...display.shapes,
				...display.terminals,
				...display.previews,
			];
			const allMeshes = meshes.flatMap((mesh) => [
				mesh,
				...(mesh.children ?? []),
			]);
			const activeKeys = new Set(allMeshes.map(({ key }) => key));
			const textKeys = new Set(
				allMeshes
					.filter(({ text }) => text !== undefined)
					.map(({ key }) => key),
			);
			for (const [key, { geometry }] of geometries) {
				if (activeKeys.has(key)) continue;
				geometry.dispose();
				geometries.delete(key);
			}
			for (const [key, text] of texts) {
				if (textKeys.has(key)) continue;
				text.dispose();
				texts.delete(key);
			}
			drawing.clear();
			const frames = new Map(
				display.selections.map((outline) => [outline.shapeKey, outline]),
			);
			for (const shape of display.shapes) {
				drawing.add(meshFor(shape));
				const outline = frames.get(shape.key);
				if (outline) {
					const line = new LineLoop(frame, selection);
					applyTransform(line, outline);
					drawing.add(line);
				}
			}
			const terminals = new Group();
			terminals.name = "editor-wire-terminals";
			for (const terminal of display.terminals)
				terminals.add(meshFor(terminal));
			drawing.add(terminals);
			if (drawing.parent !== root) root.add(drawing);
			clearPreviews();
			for (const preview of display.previews) {
				const mesh = meshFor(preview);
				previews.push(mesh);
				root.add(mesh);
			}
		};
		return { scene, update, dispose: lifetime.dispose };
	} catch (error) {
		lifetime.dispose();
		throw error;
	}
}
