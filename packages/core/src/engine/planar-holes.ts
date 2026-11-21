import {
	DataTexture,
	LinearFilter,
	Material,
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
/** Texels on each side of a hole's edge that hold its distance. */
const BAND = 2;

type Ring = readonly (readonly [number, number])[];

export interface HoleMask {
	texture: Texture;
	bounds: Bounds;
	contains: (x: number, y: number) => boolean;
	repaint: (sources: readonly PlanarGeometry[]) => boolean;
	dispose: () => void;
}

function ringBounds(ring: Ring): Bounds {
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	for (const [x, y] of ring) {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}
	return { minX, minY, maxX, maxY };
}

/**
 * Each texel holds the signed distance to the nearest hole edge, so linear
 * filtering keeps the cut round at any zoom. Values above half are inside.
 */
export function createHoleMask(
	sources: readonly PlanarGeometry[],
	onPaint?: (columns: number, rows: number) => void,
): HoleMask | undefined {
	let rings = sources.flatMap((source) => planarRings(source.edges));
	if (!rings.length) return undefined;
	let extents = rings.map(ringBounds);
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	for (const extent of extents) {
		minX = Math.min(minX, extent.minX);
		minY = Math.min(minY, extent.minY);
		maxX = Math.max(maxX, extent.maxX);
		maxY = Math.max(maxY, extent.maxY);
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
	const texelX = sizeX / width,
		texelY = sizeY / height;
	const band = BAND * Math.max(texelX, texelY);
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
	const paint = (left: number, bottom: number, right: number, top: number) => {
		left = Math.max(0, left);
		bottom = Math.max(0, bottom);
		right = Math.min(width, right);
		top = Math.min(height, top);
		if (left >= right || bottom >= top) return;
		for (let row = bottom; row < top; row++)
			data.fill(0, row * width + left, row * width + right);
		rings.forEach((ring, index) => {
			const extent = extents[index];
			const fromColumn = Math.max(
				left,
				Math.floor((extent.minX - band - bounds.minX) / texelX),
			);
			const toColumn = Math.min(
				right,
				Math.ceil((extent.maxX + band - bounds.minX) / texelX),
			);
			const fromRow = Math.max(
				bottom,
				Math.floor((extent.minY - band - bounds.minY) / texelY),
			);
			const toRow = Math.min(
				top,
				Math.ceil((extent.maxY + band - bounds.minY) / texelY),
			);
			if (fromColumn >= toColumn || fromRow >= toRow) return;
			const spanColumns = toColumn - fromColumn;
			const near = new Float32Array(spanColumns * (toRow - fromRow)).fill(
				band * band,
			);
			for (let at = 0; at < ring.length; at++) {
				const [ax, ay] = ring[at];
				const [bx, by] = ring[(at + 1) % ring.length];
				const dx = bx - ax,
					dy = by - ay;
				const length = dx * dx + dy * dy;
				const firstColumn = Math.max(
					fromColumn,
					Math.floor((Math.min(ax, bx) - band - bounds.minX) / texelX),
				);
				const lastColumn = Math.min(
					toColumn,
					Math.ceil((Math.max(ax, bx) + band - bounds.minX) / texelX),
				);
				const firstRow = Math.max(
					fromRow,
					Math.floor((Math.min(ay, by) - band - bounds.minY) / texelY),
				);
				const lastRow = Math.min(
					toRow,
					Math.ceil((Math.max(ay, by) + band - bounds.minY) / texelY),
				);
				for (let row = firstRow; row < lastRow; row++) {
					const y = bounds.minY + (row + 0.5) * texelY;
					for (let column = firstColumn; column < lastColumn; column++) {
						const x = bounds.minX + (column + 0.5) * texelX;
						const t = length
							? Math.max(
									0,
									Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length),
								)
							: 0;
						const px = ax + t * dx - x,
							py = ay + t * dy - y;
						const squared = px * px + py * py;
						const cell = (row - fromRow) * spanColumns + column - fromColumn;
						if (squared < near[cell]) near[cell] = squared;
					}
				}
			}
			const crossings: number[] = [];
			for (let row = fromRow; row < toRow; row++) {
				const y = bounds.minY + (row + 0.5) * texelY;
				crossings.length = 0;
				for (let at = 0; at < ring.length; at++) {
					const [ax, ay] = ring[at];
					const [bx, by] = ring[(at + 1) % ring.length];
					if (ay > y !== by > y)
						crossings.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
				}
				crossings.sort((a, b) => a - b);
				let crossed = 0;
				for (let column = fromColumn; column < toColumn; column++) {
					const x = bounds.minX + (column + 0.5) * texelX;
					while (crossed < crossings.length && crossings[crossed] < x)
						crossed++;
					const distance = Math.sqrt(
						near[(row - fromRow) * spanColumns + column - fromColumn],
					);
					const signed = Math.fround(crossed % 2 ? -distance : distance);
					const value = Math.round(
						255 * Math.max(0, Math.min(1, 0.5 - signed / (2 * band))),
					);
					const at = row * width + column;
					if (value > data[at]) data[at] = value;
				}
			}
		});
		onPaint?.(right - left, top - bottom);
		texture.needsUpdate = true;
	};
	paint(0, 0, width, height);
	const painted = sources.map((source) => source.edges.slice());
	const contains = (x: number, y: number) => {
		const column = Math.floor((x - bounds.minX) / texelX);
		const row = Math.floor((y - bounds.minY) / texelY);
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
		next.forEach((source, index) => {
			painted[index].set(source.edges);
		});
		rings = next.flatMap((source) => planarRings(source.edges));
		extents = rings.map(ringBounds);
		const margin = REPAINT_MARGIN + BAND;
		paint(
			Math.floor((changedMinX - bounds.minX) / texelX) - margin,
			Math.floor((changedMinY - bounds.minY) / texelY) - margin,
			Math.ceil((changedMaxX - bounds.minX) / texelX) + margin,
			Math.ceil((changedMaxY - bounds.minY) / texelY) + margin,
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
	const compile = material.onBeforeCompile;
	const cacheKey = material.customProgramCacheKey;
	material.onBeforeCompile = (shader, renderer) => {
		compile.call(material, shader, renderer);
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace(
				"#include <common>",
				"#include <common>\nuniform mat4 holeLocal;\nuniform vec2 holeMin;\nuniform vec2 holeSize;\nvarying vec2 vHoleUv;",
			)
			.replace(
				"#include <begin_vertex>",
				"#include <begin_vertex>\n#ifdef PLANAR_INSTANCE_OFFSET\nvHoleUv = ((holeLocal * vec4(position.xy + instanceOffset, position.z, 1.0)).xy - holeMin) / holeSize;\n#else\nvHoleUv = ((holeLocal * vec4(position, 1.0)).xy - holeMin) / holeSize;\n#endif",
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
	material.customProgramCacheKey = () =>
		cacheKey === Material.prototype.customProgramCacheKey
			? "planar-hole-cut"
			: `${cacheKey.call(material)}+planar-hole-cut`;
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
