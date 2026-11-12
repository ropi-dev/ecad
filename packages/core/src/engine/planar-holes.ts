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
