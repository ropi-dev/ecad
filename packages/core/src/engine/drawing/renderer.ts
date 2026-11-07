import {
	BufferGeometry,
	type CanvasTexture,
	Group,
	LineBasicMaterial,
	LineLoop,
	type Material,
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
	DrawingGeometry,
	DrawingTransform,
} from "#/drawing/display.ts";
import { darkSchematicTheme } from "#/drawing/schematic-theme.ts";
import type { WorksheetDisplay } from "#/drawing/worksheet.ts";
import {
	createRoundGeometry,
	createRoundMaterial,
	isRoundGeometry,
} from "#/engine/drawing/roundGeometry.ts";
import { createShapeGeometry } from "#/engine/drawing/shapeGeometry.ts";
import { createTextAtlas, createTextMaterial } from "#/engine/drawing/text.ts";
import { createWorksheetFromDisplay } from "#/engine/drawing/worksheet.ts";
import type { ViewerScene } from "#/engine/scene.ts";
import { createLifecycle } from "#/lib/lifecycle.ts";
import { measurePerformance } from "#/performance/runtime.ts";

let batchVersions = 0;

function touch(object: Object3D) {
	object.userData.batchVersion = ++batchVersions;
}

function applyTransform(
	object: Object3D,
	display: DrawingTransform & { renderOrder: number },
) {
	object.position.set(display.x, display.y, 0);
	object.scale.set(display.width, display.height, 1);
	object.rotation.z = display.rotation;
	object.renderOrder = display.renderOrder;
	object.matrixAutoUpdate = false;
	object.updateMatrix();
}

/** Plain display data is equal when every defined value matches. */
function sameData(first: unknown, second: unknown): boolean {
	if (first === second) return true;
	if (
		typeof first !== "object" ||
		typeof second !== "object" ||
		first === null ||
		second === null
	)
		return Number.isNaN(first) && Number.isNaN(second);
	if (Array.isArray(first) !== Array.isArray(second)) return false;
	if (Array.isArray(first) && first.length !== (second as unknown[]).length)
		return false;
	const a = first as Record<string, unknown>;
	const b = second as Record<string, unknown>;
	for (const key in a)
		if (a[key] !== undefined && !sameData(a[key], b[key])) return false;
	for (const key in b)
		if (b[key] !== undefined && a[key] === undefined) return false;
	return true;
}

/** Replaces an object's children without Three's per-child search and splice. */
function setChildren(parent: Object3D, objects: readonly Object3D[]) {
	const current = parent.children;
	if (
		current.length === objects.length &&
		current.every((object, index) => object === objects[index])
	)
		return;
	const kept = new Set(objects);
	for (const object of current)
		if (!kept.has(object) && object.parent === parent) object.parent = null;
	for (const object of objects)
		if (object.parent !== parent) {
			object.removeFromParent();
			object.parent = parent;
		}
	current.length = 0;
	for (const object of objects) current.push(object);
}

/** One persistent mesh for a display key, with its child meshes. */
interface MeshNode {
	key: string;
	object: Mesh;
	display: DisplayShape;
	parent: DisplayShape | undefined;
	atlas: number;
	children: MeshNode[];
	pinLabels: boolean;
	outline?: LineLoop;
}

/** GPU resources shared by every mesh with the same display key. */
interface KeyResources {
	refs: number;
	geometry?: {
		source: DrawingGeometry;
		uv: readonly number[] | undefined;
		value: BufferGeometry;
	};
	text?: ReturnType<typeof createTextMaterial> & {
		text: string;
		horizontalAlign?: DisplayShape["horizontalAlign"];
		bold?: true;
	};
}

/**
 * Converts display data to Three objects and owns their shared GPU resources.
 * Meshes persist per display key, so an update only touches changed displays.
 */
export function createDrawingRenderer(worksheet: WorksheetDisplay | null) {
	const lifetime = createLifecycle();
	const own = <A extends { dispose(): void }>(acquire: () => A) =>
		lifetime.acquire(acquire, (resource) => resource.dispose());
	try {
		const resources = new Map<string, KeyResources>();
		const retain = (key: string) => {
			let entry = resources.get(key);
			if (!entry) {
				entry = { refs: 0 };
				resources.set(key, entry);
			}
			entry.refs++;
			return entry;
		};
		const release = (node: MeshNode) => {
			for (const child of node.children) release(child);
			const entry = resources.get(node.key);
			if (!entry || --entry.refs > 0) return;
			entry.geometry?.value.dispose();
			entry.text?.dispose();
			resources.delete(node.key);
		};
		let pinAtlas: ReturnType<typeof createTextAtlas> | undefined;
		let pinAtlasTexts = new Set<string>();
		let atlasVersion = 0;
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
			for (const { geometry, text } of resources.values()) {
				geometry?.value.dispose();
				text?.dispose();
			}
			resources.clear();
		});
		const geometryFor = (display: DisplayShape, entry: KeyResources) => {
			const atlasEntry =
				display.pinLabel && display.text !== undefined
					? pinAtlas?.entries.get(display.text)
					: undefined;
			const uv = atlasEntry?.uv;
			const cached = entry.geometry;
			if (
				cached &&
				sameData(cached.uv, uv) &&
				sameData(cached.source, display.geometry)
			) {
				cached.source = display.geometry;
				return cached.value;
			}
			const geometry =
				(!uv && createRoundGeometry(display.geometry)) ||
				createShapeGeometry(display.geometry);
			if (uv) {
				const coordinates = geometry.getAttribute("uv");
				const [left, bottom, right, top] = uv;
				for (let index = 0; index < coordinates.count; index++)
					coordinates.setXY(
						index,
						left + coordinates.getX(index) * (right - left),
						bottom + coordinates.getY(index) * (top - bottom),
					);
			}
			cached?.value.dispose();
			entry.geometry = { source: display.geometry, uv, value: geometry };
			return geometry;
		};
		const frame = own(() => new BufferGeometry()).setFromPoints([
			new Vector3(-0.5, -0.5, 0),
			new Vector3(0.5, -0.5, 0),
			new Vector3(0.5, 0.5, 0),
			new Vector3(-0.5, 0.5, 0),
		]);
		const palette = (create: (color: string) => MeshBasicMaterial) =>
			Object.fromEntries(
				Object.entries(darkSchematicTheme.appearance).map(
					([appearance, color]) => [appearance, own(() => create(color))],
				),
			) as Record<DrawingAppearance, MeshBasicMaterial>;
		const colors = palette(
			(color) => new MeshBasicMaterial({ color, depthTest: false }),
		);
		const halos = palette(
			(color) =>
				new MeshBasicMaterial({
					color,
					transparent: true,
					opacity: 0.6,
					depthTest: false,
					depthWrite: false,
				}),
		);
		const rounds = palette((color) => createRoundMaterial({ color }));
		const roundHalos = palette((color) =>
			createRoundMaterial({ color, opacity: 0.6 }),
		);
		const selection = own(
			() =>
				new LineBasicMaterial({
					color: darkSchematicTheme.appearance.selected,
					depthTest: false,
				}),
		);
		const materialFor = (
			display: DisplayShape,
			entry: KeyResources,
			round: boolean,
		): Material => {
			const color = colors[display.appearance];
			if (display.text === undefined || display.pinLabel) {
				entry.text?.dispose();
				entry.text = undefined;
			}
			if (display.geometry.kind === "pin-halo")
				return (round ? roundHalos : halos)[display.appearance];
			if (round) return rounds[display.appearance];
			if (display.text === undefined) return color;
			if (display.pinLabel) {
				const atlasEntry = pinAtlas?.entries.get(display.text);
				if (!atlasEntry)
					throw new Error("Pin label is missing from the text atlas.");
				let materials = pinMaterials.get(atlasEntry.texture);
				if (!materials) {
					materials = new Map();
					pinMaterials.set(atlasEntry.texture, materials);
				}
				let material = materials.get(display.appearance);
				if (!material) {
					material = new MeshBasicMaterial({
						alphaMap: atlasEntry.texture,
						color: color.color,
						transparent: true,
						depthTest: false,
						depthWrite: false,
					});
					materials.set(display.appearance, material);
				}
				return material;
			}
			let cached = entry.text;
			if (
				!cached ||
				cached.text !== display.text ||
				cached.horizontalAlign !== display.horizontalAlign ||
				cached.bold !== display.bold
			) {
				const next = {
					...createTextMaterial(
						display.text,
						display.horizontalAlign,
						display.bold,
					),
					horizontalAlign: display.horizontalAlign,
					bold: display.bold,
					text: display.text,
				};
				cached?.dispose();
				cached = next;
				entry.text = cached;
			}
			cached.material.color.copy(color.color);
			return cached.material;
		};
		const scale = new Matrix4();
		const rotation = new Matrix4();
		const size = new Matrix4();
		const updateNode = (
			node: MeshNode | undefined,
			display: DisplayShape,
			parent: DisplayShape | undefined,
		): MeshNode => {
			const entry = node
				? (resources.get(display.key) ?? retain(display.key))
				: retain(display.key);
			const geometry = geometryFor(display, entry);
			const material = materialFor(display, entry, isRoundGeometry(geometry));
			let object = node?.object;
			if (!object) object = new Mesh(geometry, material);
			else {
				object.geometry = geometry;
				object.material = material;
			}
			object.name = display.name;
			touch(object);
			applyTransform(object, display);
			if (parent?.geometry.kind === "symbol" && display.rotation !== 0) {
				object.matrixAutoUpdate = false;
				object.matrix
					.makeTranslation(display.x, display.y, 0)
					.multiply(scale.makeScale(1 / parent.width, 1 / parent.height, 1))
					.multiply(rotation.makeRotationZ(display.rotation))
					.multiply(
						size.makeScale(
							display.width * parent.width,
							display.height * parent.height,
							1,
						),
					);
				object.matrixWorldNeedsUpdate = true;
			}
			const children = reconcile(
				node?.children ?? [],
				display.children ?? [],
				display,
			);
			let pinLabels = display.pinLabel === true;
			for (const child of children) pinLabels ||= child.pinLabels;
			setChildren(
				object,
				children.map((child) => child.object),
			);
			return {
				key: display.key,
				object,
				display,
				parent,
				atlas: atlasVersion,
				children,
				pinLabels,
				outline: node?.outline,
			};
		};
		const reconcileNode = (
			node: MeshNode | undefined,
			display: DisplayShape,
			parent: DisplayShape | undefined,
		) => {
			if (
				node?.display === display &&
				node.parent === parent &&
				(!node.pinLabels || node.atlas === atlasVersion)
			)
				return node;
			return updateNode(node, display, parent);
		};
		/** Matches meshes to displays by key, reusing duplicate keys in order. */
		const reconcile = (
			previous: readonly MeshNode[],
			displays: readonly DisplayShape[],
			parent: DisplayShape | undefined,
		) => {
			let aligned = true;
			for (let index = 0; aligned && index < displays.length; index++)
				aligned = previous[index]?.key === displays[index].key;
			let candidates: Map<string, MeshNode[]> | undefined;
			if (!aligned) {
				candidates = new Map();
				for (const node of previous) {
					const nodes = candidates.get(node.key);
					if (nodes) nodes.push(node);
					else candidates.set(node.key, [node]);
				}
				for (const nodes of candidates.values()) nodes.reverse();
			}
			const next = displays.map((display, index) =>
				reconcileNode(
					candidates ? candidates.get(display.key)?.pop() : previous[index],
					display,
					parent,
				),
			);
			// Release after reuse, so a shared key keeps its resources.
			if (candidates)
				for (const nodes of candidates.values())
					for (const node of nodes) release(node);
			else for (const node of previous.slice(displays.length)) release(node);
			return next;
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
		drawing.matrixAutoUpdate = false;
		const groups = (
			[
				["terminals", "editor-wire-terminals"],
				["junctions", "editor-wire-junctions"],
				["connections", "editor-symbol-connections"],
				["halos", "editor-pin-halos"],
			] as const
		).map(([section, name]) => {
			const group = new Group();
			group.name = name;
			group.matrixAutoUpdate = false;
			return { section, group, nodes: [] as MeshNode[] };
		});
		const previewGroup = new Group();
		previewGroup.name = "editor-previews";
		previewGroup.matrixAutoUpdate = false;
		let shapeNodes: MeshNode[] = [];
		let previewNodes: MeshNode[] = [];
		let rendered: DrawingDisplay | undefined;
		lifetime.addFinalizer(() => {
			for (const node of [
				...shapeNodes,
				...groups.flatMap(({ nodes }) => nodes),
				...previewNodes,
			])
				release(node);
			setChildren(drawing, []);
			setChildren(previewGroup, []);
			drawing.removeFromParent();
			previewGroup.removeFromParent();
		});
		const pinTexts = new WeakMap<DisplayShape, readonly string[]>();
		const pinTextsOf = (display: DisplayShape): readonly string[] => {
			if (!display.children?.length)
				return display.pinLabel && display.text !== undefined
					? [display.text]
					: [];
			let texts = pinTexts.get(display);
			if (!texts) {
				texts = [
					...(display.pinLabel && display.text !== undefined
						? [display.text]
						: []),
					...display.children.flatMap(pinTextsOf),
				];
				pinTexts.set(display, texts);
			}
			return texts;
		};
		const updatePinAtlas = (display: DrawingDisplay) => {
			const texts = new Set<string>();
			for (const displays of [
				display.shapes,
				display.terminals,
				display.junctions,
				display.connections,
				display.halos,
				display.previews,
			])
				for (const item of displays)
					for (const text of pinTextsOf(item)) texts.add(text);
			if (
				texts.size === pinAtlasTexts.size &&
				[...texts].every((text) => pinAtlasTexts.has(text))
			)
				return;
			const sorted = [...texts].sort();
			const next = measurePerformance(
				"editor.pin-label-atlas",
				() => createTextAtlas(sorted),
				{ labels: sorted.length },
			);
			clearPinAtlas();
			pinAtlas = next;
			pinAtlasTexts = texts;
			atlasVersion++;
		};
		const updateStatic = (display: DrawingDisplay) => {
			shapeNodes = reconcile(shapeNodes, display.shapes, undefined);
			const frames = new Map(
				display.selections.map((outline) => [outline.shapeKey, outline]),
			);
			const children: Object3D[] = [];
			for (const node of shapeNodes) {
				children.push(node.object);
				const outline = frames.get(node.key);
				if (!outline) {
					node.outline = undefined;
					continue;
				}
				node.outline ??= new LineLoop(frame, selection);
				touch(node.outline);
				applyTransform(node.outline, outline);
				children.push(node.outline);
			}
			for (const entry of groups) {
				entry.nodes = reconcile(entry.nodes, display[entry.section], undefined);
				setChildren(
					entry.group,
					entry.nodes.map((node) => node.object),
				);
				children.push(entry.group);
			}
			setChildren(drawing, children);
		};
		const update = (root: Object3D, display: DrawingDisplay) =>
			measurePerformance(
				"editor.scene-update",
				() => {
					const staticChanged =
						!rendered ||
						rendered.shapes !== display.shapes ||
						rendered.selections !== display.selections ||
						rendered.terminals !== display.terminals ||
						rendered.junctions !== display.junctions ||
						rendered.connections !== display.connections ||
						rendered.halos !== display.halos;
					const previewsChanged = rendered?.previews !== display.previews;
					const atlas = atlasVersion;
					if (staticChanged || previewsChanged) updatePinAtlas(display);
					const atlasChanged = atlas !== atlasVersion;
					if (staticChanged || atlasChanged) updateStatic(display);
					if (staticChanged || previewsChanged || atlasChanged) {
						previewNodes = reconcile(previewNodes, display.previews, undefined);
						setChildren(
							previewGroup,
							previewNodes.map((node) => node.object),
						);
					}
					rendered = display;
					if (drawing.parent !== root) root.add(drawing);
					if (previewGroup.parent !== root) root.add(previewGroup);
				},
				{ shapes: display.shapes.length },
			);
		return { scene, update, dispose: lifetime.dispose };
	} catch (error) {
		lifetime.dispose();
		throw error;
	}
}
