import {
	BufferAttribute,
	BufferGeometry,
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
import type { Bounds } from "#/engine/types.ts";

type Ring = [number, number][];

const MASK_SIZE = 2048;
const MAX_WALL_FRACTION = 0.4;
const MAX_MITER = 2;

export function planarRings(edges: Float32Array): Ring[] {
	const rings: Ring[] = [];
	let ring: Ring = [];
	for (let index = 0; index < edges.length; index += 6) {
		ring.push([edges[index], edges[index + 1]]);
		if (edges[index + 3] === ring[0][0] && edges[index + 4] === ring[0][1]) {
			rings.push(ring);
			ring = [];
		}
	}
	if (ring.length > 2) rings.push(ring);
	return rings;
}

function signedArea(ring: Ring) {
	let area = 0;
	for (let index = 0; index < ring.length; index++) {
		const [ax, ay] = ring[index];
		const [bx, by] = ring[(index + 1) % ring.length];
		area += ax * by - bx * ay;
	}
	return area / 2;
}

export function offsetRing(ring: Ring, distance: number): Ring {
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
	const wall = Math.min(
		distance,
		MAX_WALL_FRACTION * Math.min(maxX - minX, maxY - minY),
	);
	const inward = Math.sign(signedArea(ring)) || 1;
	const normal = (a: [number, number], b: [number, number]) => {
		const dx = b[0] - a[0],
			dy = b[1] - a[1];
		const length = Math.hypot(dx, dy) || 1;
		return [(-dy / length) * inward, (dx / length) * inward];
	};
	return ring.map((point, index) => {
		const previous = normal(
			ring[(index + ring.length - 1) % ring.length],
			point,
		);
		const next = normal(point, ring[(index + 1) % ring.length]);
		const x = previous[0] + next[0],
			y = previous[1] + next[1];
		const length = Math.hypot(x, y) || 1;
		const cosine = (x / length) * next[0] + (y / length) * next[1];
		const scale = Math.min(1 / Math.max(cosine, 1e-6), MAX_MITER) * wall;
		return [point[0] + (x / length) * scale, point[1] + (y / length) * scale];
	});
}

export function createTubeGeometry(compiled: PlanarGeometry, wall: number) {
	const rings = planarRings(compiled.edges);
	const vertices = new Float32Array(
		rings.reduce((count, ring) => count + ring.length * 24 * 3, 0),
	);
	let offset = 0;
	const push = (x: number, y: number, z: number) => {
		vertices[offset++] = x;
		vertices[offset++] = y;
		vertices[offset++] = z;
	};
	const quad = (
		a: [number, number, number],
		b: [number, number, number],
		c: [number, number, number],
		d: [number, number, number],
	) => {
		for (const point of [a, b, c, a, c, d]) push(...point);
	};
	for (const outer of rings) {
		const inner = offsetRing(outer, wall);
		for (let index = 0; index < outer.length; index++) {
			const next = (index + 1) % outer.length;
			const [ox, oy] = outer[index],
				[nx, ny] = outer[next];
			const [ix, iy] = inner[index],
				[jx, jy] = inner[next];
			quad([ox, oy, -0.5], [nx, ny, -0.5], [nx, ny, 0.5], [ox, oy, 0.5]);
			quad([ix, iy, -0.5], [ix, iy, 0.5], [jx, jy, 0.5], [jx, jy, -0.5]);
			quad([ox, oy, 0.5], [nx, ny, 0.5], [jx, jy, 0.5], [ix, iy, 0.5]);
			quad([ox, oy, -0.5], [ix, iy, -0.5], [jx, jy, -0.5], [nx, ny, -0.5]);
		}
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute("position", new BufferAttribute(vertices, 3));
	geometry.computeVertexNormals();
	return geometry;
}

export interface HoleMask {
	texture: Texture;
	bounds: Bounds;
	contains: (x: number, y: number) => boolean;
	dispose: () => void;
}

export function createHoleMask(
	sources: readonly PlanarGeometry[],
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
	const padding = Math.max(maxX - minX, maxY - minY, 1) * 0.01;
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
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) return undefined;
	context.fillStyle = "#fff";
	context.beginPath();
	for (const ring of rings)
		ring.forEach(([x, y], index) => {
			const px = (x - bounds.minX) * scale,
				py = (bounds.maxY - y) * scale;
			if (index) context.lineTo(px, py);
			else context.moveTo(px, py);
		});
	context.fill("evenodd");
	const pixels = context.getImageData(0, 0, width, height).data;
	const data = new Uint8Array(width * height);
	for (let row = 0; row < height; row++)
		for (let column = 0; column < width; column++)
			data[(height - 1 - row) * width + column] =
				pixels[(row * width + column) * 4];
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
	texture.needsUpdate = true;
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
	return { texture, bounds, contains, dispose: () => texture.dispose() };
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
