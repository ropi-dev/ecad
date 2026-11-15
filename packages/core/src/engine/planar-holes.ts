import {
	DataTexture,
	LinearFilter,
	type Material,
	Matrix4,
	type Object3D,
	RedFormat,
	type Texture,
	UnsignedByteType,
	Vector2,
} from "three";
import type { PlanarGeometry } from "#/engine/planar-geometry.ts";
import { planarRings } from "#/engine/planar-walls.ts";
import type { Bounds } from "#/engine/types.ts";

const MASK_SIZE = 2048;
const EDGE_SIZE = 6;
const REPAINT_MARGIN = 2;
const LEAST_PADDING = 1;

export interface HoleMask {
	texture: Texture;
	bounds: Bounds;
	contains: (x: number, y: number) => boolean;
	repaint: (sources: readonly PlanarGeometry[]) => boolean;
	dispose: () => void;
}

export function createHoleMask(
	sources: readonly PlanarGeometry[],
	createCanvas = () => document.createElement("canvas"),
): HoleMask | undefined {
	const rings = sources.flatMap((source) => planarRings(source.edges));
	if (!rings.length) return undefined;
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	for (const ring of rings)
		for (const [x, y] of ring) {
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
	const padding = Math.max(
		Math.max(maxX - minX, maxY - minY) * 0.01,
		LEAST_PADDING,
	);
	const bounds = {
		minX: minX - padding,
		minY: minY - padding,
		maxX: maxX + padding,
		maxY: maxY + padding,
	};
	const sizeX = bounds.maxX - bounds.minX,
		sizeY = bounds.maxY - bounds.minY;
	const scale = MASK_SIZE / Math.max(sizeX, sizeY);
	const width = Math.max(1, Math.ceil(sizeX * scale));
	const height = Math.max(1, Math.ceil(sizeY * scale));
	const canvas = createCanvas();
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) return undefined;
	const data = new Uint8Array(width * height);
	const texture = new DataTexture(
		data,
		width,
		height,
		RedFormat,
		UnsignedByteType,
	);
	texture.minFilter = LinearFilter;
	texture.magFilter = LinearFilter;
	texture.unpackAlignment = 1;
	const paint = (
		holes: readonly (readonly (readonly [number, number])[])[],
		left: number,
		top: number,
		columns: number,
		rows: number,
	) => {
		context.save();
		context.beginPath();
		context.rect(left, top, columns, rows);
		context.clip();
		context.clearRect(left, top, columns, rows);
		context.fillStyle = "#fff";
		context.beginPath();
		for (const ring of holes)
			ring.forEach(([x, y], index) => {
				const px = (x - bounds.minX) * scale,
					py = (bounds.maxY - y) * scale;
				if (index) context.lineTo(px, py);
				else context.moveTo(px, py);
			});
		context.fill("nonzero");
		context.restore();
		const pixels = context.getImageData(left, top, columns, rows).data;
		for (let row = 0; row < rows; row++)
			for (let column = 0; column < columns; column++)
				data[(height - 1 - top - row) * width + left + column] =
					pixels[(row * columns + column) * 4];
		texture.needsUpdate = true;
	};
	paint(rings, 0, 0, width, height);
	const painted = sources.map((source) => source.edges.slice());
	const contains = (x: number, y: number) => {
		const column = Math.floor(((x - bounds.minX) / sizeX) * width);
		const row = Math.floor(((y - bounds.minY) / sizeY) * height);
		return (
			column >= 0 &&
			row >= 0 &&
			column < width &&
			row < height &&
			data[row * width + column] > 127
		);
	};
	const repaint = (next: readonly PlanarGeometry[]) => {
		if (
			next.length !== painted.length ||
			next.some(
				(source, index) => source.edges.length !== painted[index].length,
			)
		)
			return false;
		let changedMinX = Infinity,
			changedMinY = Infinity,
			changedMaxX = -Infinity,
			changedMaxY = -Infinity;
		next.forEach(({ edges }, index) => {
			const before = painted[index];
			for (let at = 0; at < edges.length; at += EDGE_SIZE) {
				if (
					edges[at] === before[at] &&
					edges[at + 1] === before[at + 1] &&
					edges[at + 3] === before[at + 3] &&
					edges[at + 4] === before[at + 4]
				)
					continue;
				for (const values of [edges, before])
					for (const point of [at, at + 3]) {
						changedMinX = Math.min(changedMinX, values[point]);
						changedMaxX = Math.max(changedMaxX, values[point]);
						changedMinY = Math.min(changedMinY, values[point + 1]);
						changedMaxY = Math.max(changedMaxY, values[point + 1]);
					}
			}
		});
		if (changedMinX > changedMaxX) return true;
		if (
			changedMinX < bounds.minX ||
			changedMinY < bounds.minY ||
			changedMaxX > bounds.maxX ||
			changedMaxY > bounds.maxY
		)
			return false;
		const left = Math.max(
			0,
			Math.floor((changedMinX - bounds.minX) * scale) - REPAINT_MARGIN,
		);
		const top = Math.max(
			0,
			Math.floor((bounds.maxY - changedMaxY) * scale) - REPAINT_MARGIN,
		);
		const right = Math.min(
			width,
			Math.ceil((changedMaxX - bounds.minX) * scale) + REPAINT_MARGIN,
		);
		const bottom = Math.min(
			height,
			Math.ceil((bounds.maxY - changedMinY) * scale) + REPAINT_MARGIN,
		);
		next.forEach((source, index) => {
			painted[index].set(source.edges);
		});
		paint(
			next.flatMap((source) => planarRings(source.edges)),
			left,
			top,
			right - left,
			bottom - top,
		);
		return true;
	};
	return {
		texture,
		bounds,
		contains,
		repaint,
		dispose: () => texture.dispose(),
	};
}

interface HoleUniforms {
	holeMask: { value: Texture | null };
	holeEnabled: { value: boolean };
	holeMin: { value: Vector2 };
	holeSize: { value: Vector2 };
	holeLocal: { value: Matrix4 };
}

const cuts = new WeakMap<Material, HoleUniforms>();
const masks = new WeakMap<Material, HoleMask>();
const pickMasks = new WeakMap<Object3D, HoleMask>();
const IDENTITY = new Matrix4();

function installHoleCut(material: Material) {
	const existing = cuts.get(material);
	if (existing) return existing;
	const uniforms: HoleUniforms = {
		holeMask: { value: null },
		holeEnabled: { value: false },
		holeMin: { value: new Vector2() },
		holeSize: { value: new Vector2(1, 1) },
		holeLocal: { value: new Matrix4() },
	};
	cuts.set(material, uniforms);
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace(
				"#include <common>",
				"#include <common>\nuniform mat4 holeLocal;\nuniform vec2 holeMin;\nuniform vec2 holeSize;\nvarying vec2 vHoleUv;",
			)
			.replace(
				"#include <begin_vertex>",
				"#include <begin_vertex>\nvHoleUv = ((holeLocal * vec4(position, 1.0)).xy - holeMin) / holeSize;",
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				"#include <common>",
				"#include <common>\nuniform sampler2D holeMask;\nuniform bool holeEnabled;\nvarying vec2 vHoleUv;",
			)
			.replace(
				"void main() {",
				"void main() {\n\tif (holeEnabled && all(greaterThanEqual(vHoleUv, vec2(0.0))) && all(lessThanEqual(vHoleUv, vec2(1.0))) && texture2D(holeMask, vHoleUv).r > 0.5) discard;",
			);
	};
	material.customProgramCacheKey = () => "planar-hole-cut";
	material.needsUpdate = true;
	return uniforms;
}

export function cutHoles(
	material: Material,
	local: Matrix4,
	mask: HoleMask | undefined,
) {
	if (!mask && !cuts.has(material)) return;
	const uniforms = installHoleCut(material);
	if (mask) masks.set(material, mask);
	else masks.delete(material);
	uniforms.holeEnabled.value = !!mask;
	uniforms.holeMask.value = mask?.texture ?? null;
	if (!mask) return;
	uniforms.holeMin.value.set(mask.bounds.minX, mask.bounds.minY);
	uniforms.holeSize.value.set(
		mask.bounds.maxX - mask.bounds.minX,
		mask.bounds.maxY - mask.bounds.minY,
	);
	uniforms.holeLocal.value.copy(local);
}

export function copyHoleCut(source: Material, target: Material) {
	cutHoles(target, IDENTITY, masks.get(source));
}

export function pickThroughHoles(object: Object3D, mask: HoleMask | undefined) {
	if (mask) pickMasks.set(object, mask);
	else pickMasks.delete(object);
}

export const insideHole = (object: Object3D, x: number, y: number) =>
	pickMasks.get(object)?.contains(x, y) ?? false;
