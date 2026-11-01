import {
	BufferGeometry,
	type CanvasTexture,
	Group,
	LineBasicMaterial,
	LineLoop,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	type Object3D,
	Vector3,
} from "three";
import type {
	DisplayShape,
	DrawingAppearance,
	DrawingDisplay,
	DrawingTransform,
} from "#/drawing/display.ts";
import type { WorksheetDisplay } from "#/drawing/worksheet.ts";
import { createLifecycle } from "#/lib/lifecycle.ts";
import { measurePerformance } from "#/performance/runtime.ts";
import type { ViewerScene } from "../scene";
import { createShapeGeometry } from "./shapeGeometry";
import { createTextAtlas, createTextMaterial } from "./text";
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
			ReturnType<typeof createTextMaterial> & {
				text: string;
				horizontalAlign?: DisplayShape["horizontalAlign"];
			}
		>();
		let pinAtlas: ReturnType<typeof createTextAtlas> | undefined;
		let pinAtlasKey = "";
		const pinMaterials = new Map<
			CanvasTexture,
			Map<DrawingAppearance, MeshBasicMaterial>
		>();
		const clearPinAtlas = () => {
			for (const materials of pinMaterials.values())
				for (const material of materials.values()) material.dispose();
			pinMaterials.clear();
			pinAtlas?.dispose();
		};
		lifetime.addFinalizer(clearPinAtlas);
		lifetime.addFinalizer(() => {
			for (const { geometry } of geometries.values()) geometry.dispose();
			geometries.clear();
			for (const text of texts.values()) text.dispose();
			texts.clear();
		});
		const geometryFor = (display: DisplayShape) => {
			const entry =
				display.pinLabel && display.text !== undefined
					? pinAtlas?.entries.get(display.text)
					: undefined;
			const key = JSON.stringify([display.geometry, entry?.uv]);
			const cached = geometries.get(display.key);
			if (cached?.key === key) return cached.geometry;
			const geometry = createShapeGeometry(display.geometry);
			if (entry) {
				const uv = geometry.getAttribute("uv");
				const [left, bottom, right, top] = entry.uv;
				for (let index = 0; index < uv.count; index++)
					uv.setXY(
						index,
						left + uv.getX(index) * (right - left),
						bottom + uv.getY(index) * (top - bottom),
					);
			}
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
		const fill = own(
			() => new MeshBasicMaterial({ color: "#18282b", depthTest: false }),
		);
		const wire = own(
			() => new MeshBasicMaterial({ color: "#ef8f9c", depthTest: false }),
		);
		const selected = own(
			() => new MeshBasicMaterial({ color: "#e8b77e", depthTest: false }),
		);
		const highlighted = own(
			() => new MeshBasicMaterial({ color: "#f6cbd1", depthTest: false }),
		);
		const selection = own(
			() => new LineBasicMaterial({ color: "#e8b77e", depthTest: false }),
		);
		const materialFor = (display: DisplayShape) => {
			const color = { stroke, pin: stroke, wire, highlighted, selected, fill }[
				display.appearance
			];
			if (display.text === undefined) return color;
			if (display.pinLabel) {
				const entry = pinAtlas?.entries.get(display.text);
				if (!entry)
					throw new Error("Pin label is missing from the text atlas.");
				let materials = pinMaterials.get(entry.texture);
				if (!materials) {
					materials = new Map();
					pinMaterials.set(entry.texture, materials);
				}
				let material = materials.get(display.appearance);
				if (!material) {
					material = new MeshBasicMaterial({
						map: entry.texture,
						color: color.color,
						transparent: true,
						depthTest: false,
						depthWrite: false,
					});
					materials.set(display.appearance, material);
				}
				return material;
			}
			let cached = texts.get(display.key);
			if (
				!cached ||
				cached.text !== display.text ||
				cached.horizontalAlign !== display.horizontalAlign
			) {
				const next = {
					...createTextMaterial(display.text, display.horizontalAlign),
					horizontalAlign: display.horizontalAlign,
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
			for (const child of display.children ?? []) {
				const childMesh = meshFor(child);
				if (display.geometry.kind === "symbol" && child.rotation !== 0) {
					childMesh.matrixAutoUpdate = false;
					childMesh.matrix
						.makeTranslation(child.x, child.y, 0)
						.multiply(
							new Matrix4().makeScale(1 / display.width, 1 / display.height, 1),
						)
						.multiply(new Matrix4().makeRotationZ(child.rotation))
						.multiply(
							new Matrix4().makeScale(
								child.width * display.width,
								child.height * display.height,
								1,
							),
						);
				}
				mesh.add(childMesh);
			}
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
				...display.junctions,
				...display.connections,
				...display.halos,
				...display.previews,
			];
			const allMeshes = meshes.flatMap((mesh) => [
				mesh,
				...(mesh.children ?? []),
			]);
			const pinTexts = [
				...new Set(
					allMeshes.flatMap((mesh) =>
						mesh.pinLabel && mesh.text !== undefined ? [mesh.text] : [],
					),
				),
			].sort();
			const nextPinAtlasKey = JSON.stringify(pinTexts);
			if (nextPinAtlasKey !== pinAtlasKey) {
				const next = measurePerformance(
					"editor.pin-label-atlas",
					() => createTextAtlas(pinTexts),
					{ labels: pinTexts.length },
				);
				clearPinAtlas();
				pinAtlas = next;
				pinAtlasKey = nextPinAtlasKey;
			}
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
			for (const [name, displays] of [
				["editor-wire-junctions", display.junctions],
				["editor-symbol-connections", display.connections],
				["editor-pin-halos", display.halos],
			] as const) {
				const group = new Group();
				group.name = name;
				for (const display of displays) group.add(meshFor(display));
				drawing.add(group);
			}
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
