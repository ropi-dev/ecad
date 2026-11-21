import {
	AdditiveBlending,
	AlwaysStencilFunc,
	Box3,
	BufferAttribute,
	BufferGeometry,
	type Camera,
	DoubleSide,
	DynamicDrawUsage,
	EqualStencilFunc,
	Group,
	InstancedBufferAttribute,
	InstancedBufferGeometry,
	type Intersection,
	Material,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	NormalBlending,
	type Object3D,
	PlaneGeometry,
	type Raycaster,
	ReplaceStencilOp,
	type Scene,
	Sphere,
	Vector3,
	type WebGLRenderer,
	ZeroStencilOp,
} from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { type ViewerTheme, viewerTheme } from "#/drawing/schematic-theme.ts";
import {
	UNFOCUSED_CAMERA_OUTLINE_OPACITY,
	UNFOCUSED_FILL_OPACITY,
	UNFOCUSED_OUTLINE_OPACITY,
	UNFOCUSED_OUTLINE_WIDTH,
	UNFOCUSED_OUTLINE_WIDTH_MM,
} from "#/engine/layer-style.ts";
import {
	compilePlanarGeometry,
	type PlanarGeometry,
} from "#/engine/planar-geometry.ts";
import {
	cutHoles,
	type HoleMask,
	pickThroughHoles,
} from "#/engine/planar-holes.ts";
import { PlanarOutline } from "#/engine/planar-outline.ts";
import { instancedRegions, type PlanarWalls } from "#/engine/planar-walls.ts";
import type { Bounds, PlanarObject } from "#/engine/types.ts";

const geometries = new WeakMap<Object3D, PlanarGeometry>();

/** Reuse resolved surfaces for picking, including meshes borrowed by another viewer. */
export const getPlanarGeometry = (object: Object3D) => geometries.get(object);

const WALL_SHADE = 0.6;
const SHEET_OPACITY = 0.15;
const SHEET_RENDER_ORDER = 3;
const INSTANCES_RENDER_ORDER = 0.5;

function placeSheet(sheet: Object3D, bounds: Bounds, z: number) {
	sheet.position.set(
		(bounds.minX + bounds.maxX) / 2,
		(bounds.minY + bounds.maxY) / 2,
		z,
	);
	sheet.scale.set(
		Math.max(bounds.maxX - bounds.minX, 1e-6),
		Math.max(bounds.maxY - bounds.minY, 1e-6),
		1,
	);
}

function setBounds(geometry: BufferGeometry, positions: Float32Array) {
	if (!positions.length) {
		geometry.boundingBox = new Box3(new Vector3(), new Vector3());
		geometry.boundingSphere = new Sphere(new Vector3(), 0);
		return;
	}
	let minX = Infinity,
		minY = Infinity,
		minZ = Infinity,
		maxX = -Infinity,
		maxY = -Infinity,
		maxZ = -Infinity;
	for (let index = 0; index < positions.length; index += 3) {
		const x = positions[index],
			y = positions[index + 1],
			z = positions[index + 2];
		minX = Math.min(minX, x);
		maxX = Math.max(maxX, x);
		minY = Math.min(minY, y);
		maxY = Math.max(maxY, y);
		minZ = Math.min(minZ, z);
		maxZ = Math.max(maxZ, z);
	}
	const box = new Box3(
		new Vector3(minX, minY, minZ),
		new Vector3(maxX, maxY, maxZ),
	);
	const center = box.getCenter(new Vector3());
	let radiusSquared = 0;
	for (let index = 0; index < positions.length; index += 3) {
		const x = positions[index] - center.x,
			y = positions[index + 1] - center.y,
			z = positions[index + 2] - center.z;
		radiusSquared = Math.max(radiusSquared, x * x + y * y + z * z);
	}
	geometry.boundingBox = box;
	geometry.boundingSphere = new Sphere(center, Math.sqrt(radiusSquared));
}
const cameraPosition = new Vector3();
const layerPosition = new Vector3();

function biasTowardCamera(
	mesh: Mesh<BufferGeometry, MeshBasicMaterial>,
	camera: Camera,
) {
	const bias: number = mesh.userData.depthBias ?? 0;
	if (!bias) return;
	const side = Math.sign(
		camera.getWorldPosition(cameraPosition).z -
			mesh.getWorldPosition(layerPosition).z,
	);
	mesh.material.polygonOffsetFactor = -bias * (side || 1);
	mesh.material.polygonOffsetUnits = -bias * (side || 1);
}

class PlanarFillMesh extends Mesh<BufferGeometry, MeshBasicMaterial> {
	onBeforeRender(renderer: WebGLRenderer, _scene: Scene, camera: Camera) {
		if (this.material.stencilWrite) renderer.clearStencil();
		biasTowardCamera(this, camera);
	}
}

const emptyGeometry = new BufferGeometry();
const emptyMaterial = new MeshBasicMaterial();
const probe = new Mesh<BufferGeometry, Material>(emptyGeometry, emptyMaterial);
const probeHits: Intersection[] = [];
const probeSphere = new Sphere();
const offsetMatrix = new Matrix4();

const shapes = new WeakMap<BufferGeometry, BufferGeometry>();

function offsetGeometry(shape: BufferGeometry, offsets: Float32Array) {
	const geometry = new InstancedBufferGeometry();
	for (const [name, attribute] of Object.entries(shape.attributes))
		geometry.setAttribute(name, attribute);
	geometry.setAttribute(
		"instanceOffset",
		new InstancedBufferAttribute(offsets, 2),
	);
	geometry.instanceCount = offsets.length / 2;
	setInstancedBounds(geometry, shape, offsets);
	shapes.set(geometry, shape);
	return geometry;
}

class OffsetInstances<TMaterial extends Material = Material> extends Mesh<
	InstancedBufferGeometry,
	TMaterial
> {
	onBeforeRender(_renderer: WebGLRenderer, _scene: Scene, _camera: Camera) {
		offsetInstances(this.material);
	}

	raycast(raycaster: Raycaster, intersects: Intersection[]) {
		const sphere = this.geometry.boundingSphere;
		if (
			!sphere ||
			!raycaster.ray.intersectsSphere(
				probeSphere.copy(sphere).applyMatrix4(this.matrixWorld),
			)
		)
			return;
		const shape = shapes.get(this.geometry);
		if (!shape) return;
		const offsets = this.geometry.getAttribute("instanceOffset");
		probe.geometry = shape;
		probe.material = this.material;
		probe.layers.mask = this.layers.mask;
		for (let index = 0; index < this.geometry.instanceCount; index++) {
			probe.matrixWorld.multiplyMatrices(
				this.matrixWorld,
				offsetMatrix.makeTranslation(
					offsets.getX(index),
					offsets.getY(index),
					0,
				),
			);
			probe.raycast(raycaster, probeHits);
			for (const hit of probeHits) {
				hit.object = this;
				hit.instanceId = index;
				intersects.push(hit);
			}
			probeHits.length = 0;
		}
		probe.geometry = emptyGeometry;
		probe.material = emptyMaterial;
	}
}

class PlanarFillInstances extends OffsetInstances<MeshBasicMaterial> {
	onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
		super.onBeforeRender(renderer, scene, camera);
		biasTowardCamera(this, camera);
	}
}

const offsetMaterials = new WeakSet<Material>();

function offsetInstances(material: Material) {
	if (offsetMaterials.has(material)) return;
	offsetMaterials.add(material);
	const compile = material.onBeforeCompile;
	const cacheKey = material.customProgramCacheKey;
	material.defines = { ...material.defines, PLANAR_INSTANCE_OFFSET: "" };
	material.onBeforeCompile = (shader, renderer) => {
		compile.call(material, shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace(
				"#include <common>",
				"#include <common>\nattribute vec2 instanceOffset;",
			)
			.replace(
				"#include <begin_vertex>",
				"#include <begin_vertex>\ntransformed.xy += instanceOffset;",
			);
	};
	material.customProgramCacheKey = () =>
		cacheKey === Material.prototype.customProgramCacheKey
			? "planar-instance-offset"
			: `${cacheKey.call(material)}+planar-instance-offset`;
	material.needsUpdate = true;
}

function setInstancedBounds(
	geometry: BufferGeometry,
	prototype: BufferGeometry,
	offsets: Float32Array,
) {
	const box = prototype.boundingBox;
	const sphere = prototype.boundingSphere;
	if (!box || !sphere || !offsets.length) return;
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	for (let index = 0; index < offsets.length; index += 2) {
		minX = Math.min(minX, offsets[index]);
		maxX = Math.max(maxX, offsets[index]);
		minY = Math.min(minY, offsets[index + 1]);
		maxY = Math.max(maxY, offsets[index + 1]);
	}
	const bounds = new Box3(
		new Vector3(box.min.x + minX, box.min.y + minY, box.min.z),
		new Vector3(box.max.x + maxX, box.max.y + maxY, box.max.z),
	);
	const center = bounds.getCenter(new Vector3());
	let farthest = 0;
	for (let index = 0; index < offsets.length; index += 2) {
		const x = sphere.center.x + offsets[index] - center.x,
			y = sphere.center.y + offsets[index + 1] - center.y,
			z = sphere.center.z - center.z;
		farthest = Math.max(farthest, x * x + y * y + z * z);
	}
	geometry.boundingBox = bounds;
	geometry.boundingSphere = new Sphere(
		center,
		Math.sqrt(farthest) + sphere.radius,
	);
}

function plainPositions({ positions, regions, instances }: PlanarGeometry) {
	if (!instances?.length) return positions;
	const drawn = instancedRegions(regions.length, instances);
	let count = 0;
	regions.forEach((region, index) => {
		if (!drawn[index]) count += region.count;
	});
	const plain = new Float32Array(count * 3);
	let offset = 0;
	regions.forEach((region, index) => {
		if (drawn[index]) return;
		plain.set(
			positions.subarray(region.start * 3, (region.start + region.count) * 3),
			offset,
		);
		offset += region.count * 3;
	});
	return plain;
}

function meshGeometry(positions: Float32Array, normals?: Float32Array) {
	const geometry = new BufferGeometry();
	geometry.setAttribute("position", new BufferAttribute(positions, 3));
	if (normals) geometry.setAttribute("normal", new BufferAttribute(normals, 3));
	setBounds(geometry, positions);
	return geometry;
}

/** Builds actual triangle meshes and contour geometry, with no texture maps. */
export function createPlanarObject3D(
	source: PlanarObject,
	compiled: PlanarGeometry = compilePlanarGeometry(source.objects),
	walls?: PlanarWalls,
	{
		outlines = true,
		rewritten = false,
	}: { outlines?: boolean; rewritten?: boolean } = {},
) {
	const extrude = walls?.extrude;
	const object = new Group();
	object.name = source.name;
	object.visible = source.visible;
	object.userData.planarObject = true;
	object.userData.planarExtrude = extrude;
	object.userData.planarBounds = source.bounds;
	geometries.set(object, compiled);
	try {
		const instances = rewritten ? undefined : compiled.instances;
		const positions = rewritten ? compiled.positions : plainPositions(compiled);
		const geometry = new BufferGeometry();
		geometry.setAttribute("position", new BufferAttribute(positions, 3));
		geometry.computeVertexNormals();
		setBounds(geometry, positions);
		const material = new MeshBasicMaterial({
			color: source.color,
			transparent: true,
			opacity: source.opacity,
			depthWrite: false,
			side: DoubleSide,
			forceSinglePass: true,
			stencilRef: 1,
			stencilFunc: AlwaysStencilFunc,
			stencilZPass: ReplaceStencilOp,
		});
		const fill = new PlanarFillMesh(geometry, material);
		fill.userData.planarPart = "fill";
		fill.frustumCulled = !instances?.length;
		object.add(fill);
		for (const instance of instances ?? []) {
			const prototype = meshGeometry(instance.positions);
			prototype.computeVertexNormals();
			const copies = new PlanarFillInstances(
				offsetGeometry(prototype, instance.offsets),
				material.clone(),
			);
			copies.userData.planarPart = "fill-instances";
			copies.renderOrder = INSTANCES_RENDER_ORDER;
			object.add(copies);
		}
		if (walls) {
			const wallMaterial =
				extrude === "barrel"
					? new MeshStandardMaterial({
							color: source.color,
							roughness: 0.55,
							metalness: 0.15,
							side: DoubleSide,
							polygonOffset: true,
							polygonOffsetUnits: -4,
						})
					: new MeshBasicMaterial({ color: source.color, side: DoubleSide });
			const wallMesh = new Mesh(
				meshGeometry(walls.positions, walls.normals),
				wallMaterial,
			);
			wallMesh.userData.planarPart = "walls";
			wallMesh.userData.planarEmpty = walls.positions.length === 0;
			wallMesh.visible = false;
			object.add(wallMesh);
			walls.instances?.forEach((wall, index) => {
				const instance = instances?.[index];
				if (!instance) return;
				const copies = new OffsetInstances(
					offsetGeometry(
						meshGeometry(wall.positions, wall.normals),
						instance.offsets,
					),
					wallMaterial.clone(),
				);
				copies.userData.planarPart = "walls-instances";
				copies.visible = false;
				object.add(copies);
			});
		}
		if (rewritten)
			object.traverse((part) => {
				if (!(part instanceof Mesh)) return;
				for (const name of ["position", "normal"]) {
					const attribute = part.geometry.getAttribute(name);
					if (attribute instanceof BufferAttribute)
						attribute.setUsage(DynamicDrawUsage);
				}
			});
		if (extrude === "slab") {
			const sheet = new Mesh(
				new PlaneGeometry(1, 1),
				new MeshBasicMaterial({
					color: source.color,
					transparent: true,
					opacity: SHEET_OPACITY,
					depthWrite: false,
					side: DoubleSide,
					forceSinglePass: true,
				}),
			);
			sheet.userData.planarPart = "sheet";
			sheet.renderOrder = SHEET_RENDER_ORDER;
			sheet.visible = false;
			placeSheet(sheet, source.bounds, 0);
			object.add(sheet);
		}
		for (const { linewidth, worldUnits } of outlines && compiled.edges.length
			? [
					{ linewidth: UNFOCUSED_OUTLINE_WIDTH * 2, worldUnits: false },
					{ linewidth: UNFOCUSED_OUTLINE_WIDTH_MM * 2, worldUnits: true },
				]
			: []) {
			const edgeGeometry = new LineSegmentsGeometry().setPositions(
				compiled.edges,
			);
			const edgeMaterial = new LineMaterial({
				color: viewerTheme().unfocusedLayer,
				linewidth,
				worldUnits,
				transparent: true,
				depthWrite: false,
				blending: viewerTheme().unfocusedAdditive
					? AdditiveBlending
					: NormalBlending,
				stencilWrite: true,
				stencilRef: 1,
				stencilFunc: EqualStencilFunc,
				stencilZPass: ZeroStencilOp,
			});
			const edges = new PlanarOutline(edgeGeometry, edgeMaterial);
			edges.userData.planarPart = "outline";
			edges.visible = false;
			edges.renderOrder = worldUnits ? 2 : 1;
			object.add(edges);
		}
		return object;
	} catch (error) {
		disposePlanarObject3D(object);
		throw error;
	}
}

const changedPoint = new Vector3();
const EDGE_TOUCH = 1e-6;

function followBounds(
	geometry: BufferGeometry,
	positions: Float32Array,
	[start, end]: readonly [number, number],
	vacated: Bounds | undefined,
) {
	const { boundingBox, boundingSphere } = geometry;
	if (
		!boundingBox ||
		!boundingSphere ||
		!vacated ||
		vacated.minX <= boundingBox.min.x + EDGE_TOUCH ||
		vacated.minY <= boundingBox.min.y + EDGE_TOUCH ||
		vacated.maxX >= boundingBox.max.x - EDGE_TOUCH ||
		vacated.maxY >= boundingBox.max.y - EDGE_TOUCH
	) {
		setBounds(geometry, positions);
		return;
	}
	for (let index = start; index < end; index += 3)
		boundingBox.expandByPoint(
			changedPoint.set(
				positions[index],
				positions[index + 1],
				positions[index + 2],
			),
		);
	boundingBox.getBoundingSphere(boundingSphere);
}

function reupload(
	mesh: Object3D | undefined,
	names: readonly string[],
	range: readonly [number, number] | undefined,
	vacated: Bounds | undefined,
) {
	if (!range || !(mesh instanceof Mesh)) return;
	const geometry: BufferGeometry = mesh.geometry;
	for (const name of names) {
		const attribute = geometry.getAttribute(name);
		if (!(attribute instanceof BufferAttribute)) continue;
		attribute.addUpdateRange(range[0], range[1] - range[0]);
		attribute.needsUpdate = true;
	}
	const positions = geometry.getAttribute("position").array;
	if (positions instanceof Float32Array)
		followBounds(geometry, positions, range, vacated);
}

export function reuploadPlanarObject3D(
	object: Object3D,
	changes: {
		positions?: readonly [number, number];
		walls?: readonly [number, number];
		vacated?: Bounds;
	},
	bounds: Bounds,
) {
	object.userData.planarBounds = bounds;
	const part = (name: string) =>
		object.children.find((child) => child.userData.planarPart === name);
	reupload(part("fill"), ["position"], changes.positions, changes.vacated);
	reupload(
		part("walls"),
		["position", "normal"],
		changes.walls,
		changes.vacated,
	);
}

export function stylePlanarObject3D(
	object: Object3D,
	color: string,
	opacity: number,
	xray: boolean,
	stack?: {
		z: number;
		thickness: number;
		depthBias: number;
		through: boolean;
		sheet?: Bounds;
		holes?: HoleMask;
	},
	film: ViewerTheme = viewerTheme(),
) {
	const solid = !!stack && !stack.through && !xray;
	const extrude = object.userData.planarExtrude;
	const barrel = extrude === "barrel" && !!stack?.through && !xray;
	const slab = extrude === "slab" && solid && (stack?.thickness ?? 0) > 0;
	const holes = stack && !stack.through ? stack.holes : undefined;
	const bias = solid ? (stack?.depthBias ?? 0) * Math.sign(stack?.z ?? 0) : 0;
	const filmBlending = film.unfocusedAdditive
		? AdditiveBlending
		: NormalBlending;
	object.traverse((part) => {
		if (!(part instanceof Mesh)) return;
		const role = part.userData.planarPart;
		if (
			(role === "fill" || role === "fill-instances") &&
			part.material instanceof MeshBasicMaterial
		) {
			part.visible = !barrel;
			part.userData.pickWhenHidden = barrel;
			pickThroughHoles(part, holes);
			part.material.color.set(xray ? film.unfocusedLayer : color);
			part.material.opacity = opacity * (xray ? UNFOCUSED_FILL_OPACITY : 1);
			part.material.blending = xray ? filmBlending : NormalBlending;
			part.material.depthWrite = solid;
			part.material.depthTest = !stack?.through;
			part.userData.depthBias = bias;
			part.material.polygonOffset = bias !== 0;
			// Mark the filled surface, then consume that mark once per outline pixel.
			part.material.stencilWrite = xray;
			part.updateMatrix();
			cutHoles(part.material, part.matrix, xray ? undefined : holes);
		} else if (
			(role === "walls" || role === "walls-instances") &&
			(part.material instanceof MeshStandardMaterial ||
				part.material instanceof MeshBasicMaterial)
		) {
			const thickness = stack?.thickness ?? 0;
			part.visible = (barrel || slab) && part.userData.planarEmpty !== true;
			part.scale.z = thickness || 1;
			part.position.z = slab
				? (-(Math.sign(stack?.z ?? 0) || 1) * thickness) / 2
				: 0;
			part.material.color.set(color);
			if (slab) part.material.color.multiplyScalar(WALL_SHADE);
		} else if (
			part.userData.planarPart === "sheet" &&
			part.material instanceof MeshBasicMaterial
		) {
			const sheet = slab ? stack?.sheet : undefined;
			const thickness = stack?.thickness ?? 0;
			part.visible = !!sheet;
			placeSheet(
				part,
				sheet ?? object.userData.planarBounds,
				sheet ? (-(Math.sign(stack?.z ?? 0) || 1) * thickness) / 2 : 0,
			);
			part.material.color.set(color);
			part.material.opacity = SHEET_OPACITY * opacity;
			part.updateMatrix();
			cutHoles(part.material, part.matrix, sheet ? holes : undefined);
		} else if (
			part.userData.planarPart === "outline" &&
			part.material instanceof LineMaterial
		) {
			part.visible = xray;
			part.material.depthTest = !stack?.through;
			part.material.color.set(film.unfocusedLayer);
			part.material.blending = filmBlending;
			const outlineOpacity = part.material.worldUnits
				? UNFOCUSED_OUTLINE_OPACITY
				: UNFOCUSED_CAMERA_OUTLINE_OPACITY;
			part.material.opacity =
				opacity * (outlineOpacity - UNFOCUSED_FILL_OPACITY);
		} else if (part.userData.planarPart === "text-walls") {
			const thickness = stack?.thickness ?? 0;
			part.visible = solid && thickness > 0;
			part.scale.z = thickness || 1;
			part.position.z = (-(Math.sign(stack?.z ?? 0) || 1) * thickness) / 2;
			for (const material of Array.isArray(part.material)
				? part.material
				: [part.material])
				if (material instanceof MeshBasicMaterial)
					material.color.set(color).multiplyScalar(WALL_SHADE);
		} else if (part.userData.planarPart === undefined) part.visible = !xray;
	});
}

export function disposePlanarObject3D(object: Object3D) {
	object.traverse((part) => {
		if (!(part instanceof Mesh)) return;
		if (part instanceof PlanarOutline) part.disposeGeometry();
		else part.geometry.dispose();
		for (const material of Array.isArray(part.material)
			? part.material
			: [part.material])
			material.dispose();
	});
}
