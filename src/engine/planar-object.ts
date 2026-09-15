import {
	AdditiveBlending,
	AlwaysStencilFunc,
	BufferAttribute,
	BufferGeometry,
	DoubleSide,
	EqualStencilFunc,
	Group,
	Mesh,
	MeshBasicMaterial,
	NormalBlending,
	type Object3D,
	ReplaceStencilOp,
	type WebGLRenderer,
	ZeroStencilOp,
} from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import {
	UNFOCUSED_FILL_OPACITY,
	UNFOCUSED_OUTLINE_OPACITY,
	UNFOCUSED_OUTLINE_WIDTH,
	UNFOCUSED_XRAY_COLOR,
} from "./layer-style";
import { compilePlanarGeometry, type PlanarGeometry } from "./planar-geometry";
import type { PlanarObject } from "./types";

class PlanarFillMesh extends Mesh<BufferGeometry, MeshBasicMaterial> {
	onBeforeRender(renderer: WebGLRenderer) {
		if (this.material.stencilWrite) renderer.clearStencil();
	}
}

/** Builds actual triangle meshes and contour geometry, with no texture maps. */
export function createPlanarObject3D(
	source: PlanarObject,
	compiled: PlanarGeometry = compilePlanarGeometry(source.objects),
) {
	const object = new Group();
	object.name = source.name;
	object.visible = source.visible;
	object.userData.planarObject = true;
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
			stencilRef: 1,
			stencilFunc: AlwaysStencilFunc,
			stencilZPass: ReplaceStencilOp,
		});
		const fill = new PlanarFillMesh(geometry, material);
		fill.userData.planarPart = "fill";
		object.add(fill);
		if (compiled.edges.length) {
			const edgeGeometry = new LineSegmentsGeometry().setPositions(
				compiled.edges,
			);
			const edgeMaterial = new LineMaterial({
				color: UNFOCUSED_XRAY_COLOR,
				linewidth: UNFOCUSED_OUTLINE_WIDTH * 2,
				worldUnits: false,
				transparent: true,
				depthWrite: false,
				blending: AdditiveBlending,
				stencilWrite: true,
				stencilRef: 1,
				stencilFunc: EqualStencilFunc,
				stencilZPass: ZeroStencilOp,
			});
			const edges = new LineSegments2(edgeGeometry, edgeMaterial);
			edges.userData.planarPart = "outline";
			edges.visible = false;
			edges.renderOrder = 1;
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
) {
	object.traverse((part) => {
		if (!(part instanceof Mesh)) return;
		if (
			part.userData.planarPart === "fill" &&
			part.material instanceof MeshBasicMaterial
		) {
			part.material.color.set(xray ? UNFOCUSED_XRAY_COLOR : color);
			part.material.opacity = opacity * (xray ? UNFOCUSED_FILL_OPACITY : 1);
			part.material.blending = xray ? AdditiveBlending : NormalBlending;
			// Mark the filled surface, then consume that mark once per outline pixel.
			part.material.stencilWrite = xray;
		} else if (
			part.userData.planarPart === "outline" &&
			part.material instanceof LineMaterial
		) {
			part.visible = xray;
			part.material.opacity =
				opacity * (UNFOCUSED_OUTLINE_OPACITY - UNFOCUSED_FILL_OPACITY);
		}
	});
}

export function disposePlanarObject3D(object: Object3D) {
	object.traverse((part) => {
		if (!(part instanceof Mesh)) return;
		part.geometry.dispose();
		for (const material of Array.isArray(part.material)
			? part.material
			: [part.material])
			material.dispose();
	});
}
