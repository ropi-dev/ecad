import { Box3, type Camera, Matrix4, Vector4, type WebGLRenderer } from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { UNFOCUSED_OUTLINE_WIDTH_MM } from "#/engine/layer-style.ts";
import { simplifyPlanarEdges } from "#/engine/planar-geometry.ts";

const viewBounds = new Box3();
const modelView = new Matrix4();
const viewport = new Vector4();

export class PlanarOutline extends LineSegments2 {
	private levels: Map<number, LineSegmentsGeometry>;

	constructor(
		geometry = new LineSegmentsGeometry(),
		material = new LineMaterial(),
	) {
		super(geometry, material);
		this.levels = new Map([[0, geometry]]);
	}

	copy(source: this, recursive = true) {
		super.copy(source, recursive);
		this.levels = source.levels;
		return this;
	}

	updateDetail(renderer: WebGLRenderer, camera: Camera) {
		renderer.getViewport(viewport);
		const original = this.levels.get(0);
		if (!original?.boundingBox) return;
		modelView.multiplyMatrices(camera.matrixWorldInverse, this.matrixWorld);
		viewBounds.copy(original.boundingBox).applyMatrix4(modelView);
		const projection = camera.projectionMatrix.elements;
		const distance = projection[11] === -1 ? Math.max(0, -viewBounds.max.z) : 1;
		const scale = this.matrixWorld.getMaxScaleOnAxis();
		const tolerance =
			Math.min(
				UNFOCUSED_OUTLINE_WIDTH_MM / 10,
				(0.25 * 2 * distance) / (projection[5] * viewport.w),
			) / scale;
		const detail =
			[0.005, 0.001, 0.0002].find((value) => value <= tolerance) ?? 0;
		let geometry = this.levels.get(detail);
		if (!geometry) {
			const edges = original.getAttribute("instanceStart");
			const data = new Float32Array(edges.count * 6);
			const ends = original.getAttribute("instanceEnd");
			for (let index = 0; index < edges.count; index++) {
				data.set(
					[
						edges.getX(index),
						edges.getY(index),
						edges.getZ(index),
						ends.getX(index),
						ends.getY(index),
						ends.getZ(index),
					],
					index * 6,
				);
			}
			geometry = new LineSegmentsGeometry().setPositions(
				simplifyPlanarEdges(data, detail),
			);
			this.levels.set(detail, geometry);
		}
		this.geometry = geometry;
	}

	disposeGeometry() {
		for (const geometry of this.levels.values()) geometry.dispose();
	}
}
