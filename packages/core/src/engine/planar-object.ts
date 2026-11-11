import {
	AdditiveBlending,
	AlwaysStencilFunc,
	BufferAttribute,
	BufferGeometry,
	type Camera,
	DoubleSide,
	EqualStencilFunc,
	Group,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	NormalBlending,
	type Object3D,
	PlaneGeometry,
	ReplaceStencilOp,
	type Scene,
	Vector3,
	type WebGLRenderer,
	ZeroStencilOp,
} from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import {
	UNFOCUSED_CAMERA_OUTLINE_OPACITY,
	UNFOCUSED_FILL_OPACITY,
	UNFOCUSED_OUTLINE_OPACITY,
	UNFOCUSED_OUTLINE_WIDTH,
	UNFOCUSED_OUTLINE_WIDTH_MM,
	UNFOCUSED_XRAY_COLOR,
} from "#/engine/layer-style.ts";
import {
	compilePlanarGeometry,
	type PlanarGeometry,
} from "#/engine/planar-geometry.ts";
import {
	createTubeGeometry,
	cutHoles,
	type HoleMask,
	pickThroughHoles,
} from "#/engine/planar-holes.ts";
import { PlanarOutline } from "#/engine/planar-outline.ts";
import type { Bounds, PlanarObject } from "#/engine/types.ts";

const geometries = new WeakMap<Object3D, PlanarGeometry>();

/** Reuse resolved surfaces for picking, including meshes borrowed by another viewer. */
export const getPlanarGeometry = (object: Object3D) => geometries.get(object);

const WALL_SHADE = 0.6;
const SHEET_OPACITY = 0.15;
const SHEET_RENDER_ORDER = 3;

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
const cameraPosition = new Vector3();
const layerPosition = new Vector3();

class PlanarFillMesh extends Mesh<BufferGeometry, MeshBasicMaterial> {
	onBeforeRender(renderer: WebGLRenderer, _scene: Scene, camera: Camera) {
		if (this.material.stencilWrite) renderer.clearStencil();
		const bias: number = this.userData.depthBias ?? 0;
		if (!bias) return;
		const side = Math.sign(
			camera.getWorldPosition(cameraPosition).z -
				this.getWorldPosition(layerPosition).z,
		);
		this.material.polygonOffsetFactor = -bias * (side || 1);
		this.material.polygonOffsetUnits = -bias * (side || 1);
	}
}

function createWallGeometry({ edges }: PlanarGeometry) {
	const vertices = new Float32Array(edges.length * 3);
	let offset = 0;
	const push = (x: number, y: number, z: number) => {
		vertices[offset++] = x;
		vertices[offset++] = y;
		vertices[offset++] = z;
	};
	for (let index = 0; index < edges.length; index += 6) {
		const ax = edges[index],
			ay = edges[index + 1],
			bx = edges[index + 3],
			by = edges[index + 4];
		push(ax, ay, -0.5);
		push(bx, by, -0.5);
		push(bx, by, 0.5);
		push(ax, ay, -0.5);
		push(bx, by, 0.5);
		push(ax, ay, 0.5);
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute("position", new BufferAttribute(vertices, 3));
	return geometry;
}

/** Builds actual triangle meshes and contour geometry, with no texture maps. */
export function createPlanarObject3D(
	source: PlanarObject,
	compiled: PlanarGeometry = compilePlanarGeometry(source.objects),
	{ extrude, wall = 0 }: { extrude?: "slab" | "barrel"; wall?: number } = {},
) {
	const object = new Group();
	object.name = source.name;
	object.visible = source.visible;
	object.userData.planarObject = true;
	object.userData.planarExtrude = extrude;
	object.userData.planarBounds = source.bounds;
	geometries.set(object, compiled);
	try {
		const geometry = new BufferGeometry();
		geometry.setAttribute(
			"position",
			new BufferAttribute(compiled.positions, 3),
		);
		geometry.computeVertexNormals();
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
		object.add(fill);
		if (extrude) {
			const walls = new Mesh(
				extrude === "barrel"
					? createTubeGeometry(compiled, wall)
					: createWallGeometry(compiled),
				extrude === "barrel"
					? new MeshStandardMaterial({
							color: source.color,
							roughness: 0.55,
							metalness: 0.15,
							side: DoubleSide,
							polygonOffset: true,
							polygonOffsetFactor: -4,
							polygonOffsetUnits: -4,
						})
					: new MeshBasicMaterial({ color: source.color, side: DoubleSide }),
			);
			walls.userData.planarPart = "walls";
			walls.visible = false;
			object.add(walls);
		}
		if (extrude === "slab") {
			const sheet = new Mesh(
				new PlaneGeometry(1, 1),
				new MeshBasicMaterial({
					color: source.color,
					transparent: true,
					opacity: SHEET_OPACITY,
					depthWrite: false,
					side: DoubleSide,
				}),
			);
			sheet.userData.planarPart = "sheet";
			sheet.renderOrder = SHEET_RENDER_ORDER;
			sheet.visible = false;
			placeSheet(sheet, source.bounds, 0);
			object.add(sheet);
		}
		for (const { linewidth, worldUnits } of compiled.edges.length
			? [
					{ linewidth: UNFOCUSED_OUTLINE_WIDTH * 2, worldUnits: false },
					{ linewidth: UNFOCUSED_OUTLINE_WIDTH_MM * 2, worldUnits: true },
				]
			: []) {
			const edgeGeometry = new LineSegmentsGeometry().setPositions(
				compiled.edges,
			);
			const edgeMaterial = new LineMaterial({
				color: UNFOCUSED_XRAY_COLOR,
				linewidth,
				worldUnits,
				transparent: true,
				depthWrite: false,
				blending: AdditiveBlending,
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
) {
	const solid = !!stack && !stack.through && !xray;
	const extrude = object.userData.planarExtrude;
	const barrel = extrude === "barrel" && !!stack?.through && !xray;
	const slab = extrude === "slab" && solid && (stack?.thickness ?? 0) > 0;
	const holes = stack && !stack.through ? stack.holes : undefined;
	const bias = solid ? (stack?.depthBias ?? 0) * Math.sign(stack?.z ?? 0) : 0;
	object.traverse((part) => {
		if (!(part instanceof Mesh)) return;
		if (
			part.userData.planarPart === "fill" &&
			part.material instanceof MeshBasicMaterial
		) {
			part.visible = !barrel;
			part.userData.pickWhenHidden = barrel;
			pickThroughHoles(part, holes);
			part.material.color.set(xray ? UNFOCUSED_XRAY_COLOR : color);
			part.material.opacity = opacity * (xray ? UNFOCUSED_FILL_OPACITY : 1);
			part.material.blending = xray ? AdditiveBlending : NormalBlending;
			part.material.depthWrite = solid;
			part.material.depthTest = !stack?.through;
			part.userData.depthBias = bias;
			part.material.polygonOffset = bias !== 0;
			// Mark the filled surface, then consume that mark once per outline pixel.
			part.material.stencilWrite = xray;
			part.updateMatrix();
			cutHoles(part.material, part.matrix, xray ? undefined : holes);
		} else if (
			part.userData.planarPart === "walls" &&
			(part.material instanceof MeshStandardMaterial ||
				part.material instanceof MeshBasicMaterial)
		) {
			const thickness = stack?.thickness ?? 0;
			part.visible = barrel || slab;
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
			const outlineOpacity = part.material.worldUnits
				? UNFOCUSED_OUTLINE_OPACITY
				: UNFOCUSED_CAMERA_OUTLINE_OPACITY;
			part.material.opacity =
				opacity * (outlineOpacity - UNFOCUSED_FILL_OPACITY);
		}
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
