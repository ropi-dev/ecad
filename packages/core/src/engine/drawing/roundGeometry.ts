import {
	BufferGeometry,
	Float32BufferAttribute,
	type Material,
	MeshBasicMaterial,
	type MeshBasicMaterialParameters,
	Vector2,
	Vector4,
	type WebGLProgramParametersWithUniforms,
} from "three";
import type { DrawingGeometry } from "#/drawing/display.ts";

/**
 * A disk or ring at the origin plus a round-capped stroke along +x, in
 * millimeters. A zero outer radius or stroke radius leaves that part out.
 */
interface RoundOutline {
	outer: number;
	inner: number;
	length: number;
	radius: number;
}

function roundOutline(shape: DrawingGeometry): RoundOutline | undefined {
	const { width, height } = shape;
	// Tessellated circles stretch with unequal sides. A distance field cannot.
	if (!(width > 0) || width !== height) return undefined;
	if (shape.kind === "junction")
		return { outer: width / 2, inner: 0, length: 0, radius: 0 };
	if (shape.kind === "pin-halo")
		return { outer: width / 2, inner: width * 0.35, length: 0, radius: 0 };
	if (shape.kind !== "pin") return undefined;
	const length = shape.length ?? 0;
	const lead = length > 0 && shape.lineWidth > 0;
	return {
		outer: width * 0.3,
		inner: 0,
		length: lead ? length : 0,
		radius: lead ? shape.lineWidth / 2 : 0,
	};
}

/**
 * Pins, pin halos, and junctions as one triangle around their bounds. The
 * round material computes coverage from the distance to the outline, so a pin
 * and its lead cost one triangle instead of about eighty. Shapes without a
 * round outline return undefined and keep their tessellated mesh.
 */
export function createRoundGeometry(
	shape: DrawingGeometry,
): BufferGeometry | undefined {
	const outline = roundOutline(shape);
	if (!outline) return undefined;
	const { outer, inner, length, radius } = outline;
	const minX = -Math.max(outer, radius);
	const maxX = Math.max(outer, length + radius);
	const minY = -Math.max(outer, radius);
	const maxY = -minY;
	// A right triangle with legs twice the box sides has its hypotenuse
	// through the far corner, so it covers the box with one triangle.
	const points = [
		[minX, minY],
		[2 * maxX - minX, minY],
		[minX, 2 * maxY - minY],
	];
	// The vertex shader pushes each corner out by these many pixels along the
	// local axes, which keeps a one-pixel antialiasing margin around the box.
	const margins = [-1, -1, 3, -1, -1, 3];
	const geometry = new BufferGeometry();
	geometry.setAttribute(
		"position",
		new Float32BufferAttribute(
			points.flatMap(([x, y]) => [x / shape.width, y / shape.height, 0]),
			3,
		),
	);
	geometry.setAttribute(
		"roundPoint",
		new Float32BufferAttribute(points.flat(), 2),
	);
	geometry.setAttribute(
		"roundMargin",
		new Float32BufferAttribute(
			[0, 1, 2].flatMap((index) => [
				margins[index * 2],
				margins[index * 2 + 1],
				1 / shape.width,
				1 / shape.height,
			]),
			4,
		),
	);
	geometry.setAttribute(
		"roundOutline",
		new Float32BufferAttribute(
			[0, 1, 2].flatMap(() => [outer, inner, length, radius]),
			4,
		),
	);
	return geometry;
}

export const isRoundMaterial = (material: Material) =>
	material.userData.roundShape === true;

export const isRoundGeometry = (geometry: BufferGeometry) =>
	geometry.hasAttribute("roundOutline");

const roundProgramKey = "ecad-round-shape";

const vertexDeclarations = /* glsl */ `
attribute vec2 roundPoint;
attribute vec4 roundMargin;
attribute vec4 roundOutline;
uniform vec2 roundViewport;
varying vec2 vRoundPoint;
varying vec4 vRoundOutline;
`;

// Millimeters per pixel along each local axis, from how far one millimeter
// moves in clip space. Top-down cameras keep w constant across the plane.
const vertexOffset = /* glsl */ `
{
	mat4 roundClip = projectionMatrix * modelViewMatrix;
	float roundW = (roundClip * vec4(transformed, 1.0)).w;
	vec2 roundPixels = 0.5 * roundViewport / roundW;
	vec2 roundAlongX = (roundClip * vec4(roundMargin.z, 0.0, 0.0, 0.0)).xy * roundPixels;
	vec2 roundAlongY = (roundClip * vec4(0.0, roundMargin.w, 0.0, 0.0)).xy * roundPixels;
	vec2 roundOffset = roundMargin.xy / max(vec2(length(roundAlongX), length(roundAlongY)), vec2(1e-6));
	transformed.xy += roundOffset * roundMargin.zw;
	vRoundPoint = roundPoint + roundOffset;
	vRoundOutline = roundOutline;
}
`;

export const roundFragmentDeclarations = /* glsl */ `
varying vec2 vRoundPoint;
varying vec4 vRoundOutline;
`;

// Signed distance in millimeters, converted to pixels for a one-pixel ramp.
export const roundCoverage = /* glsl */ `
	float roundDistance = 1e6;
	float roundLength = length(roundPoint);
	if (vRoundOutline.x > 0.0) {
		roundDistance = roundLength - vRoundOutline.x;
		if (vRoundOutline.y > 0.0) roundDistance = max(roundDistance, vRoundOutline.y - roundLength);
	}
	if (vRoundOutline.w > 0.0) {
		vec2 roundLead = vec2(roundPoint.x - clamp(roundPoint.x, 0.0, vRoundOutline.z), roundPoint.y);
		roundDistance = min(roundDistance, length(roundLead) - vRoundOutline.w);
	}
	float roundCoverage = clamp(0.5 - roundDistance / roundPixel, 0.0, 1.0);
	if (roundCoverage <= 0.0) discard;
	diffuseColor.a *= roundCoverage;
`;

export const roundPixelSize = /* glsl */ `
	vec2 roundPoint = vRoundPoint;
	float roundPixel = max(length(vec2(length(dFdx(roundPoint)), length(dFdy(roundPoint)))) * 0.70710678, 1e-6);
`;

const fragmentCoverage = `{${roundPixelSize}${roundCoverage}}`;

function injectRoundShader(shader: WebGLProgramParametersWithUniforms) {
	shader.vertexShader = shader.vertexShader
		.replace("#include <common>", `#include <common>\n${vertexDeclarations}`)
		.replace(
			"#include <begin_vertex>",
			`#include <begin_vertex>\n${vertexOffset}`,
		);
	shader.fragmentShader = shader.fragmentShader
		.replace(
			"#include <common>",
			`#include <common>\n${roundFragmentDeclarations}`,
		)
		.replace(
			"#include <alphamap_fragment>",
			`#include <alphamap_fragment>\n${fragmentCoverage}`,
		);
}

/**
 * A blended basic material that draws round geometry. Partial coverage needs
 * blending, so round shapes always draw with transparent objects.
 */
export function createRoundMaterial(
	parameters: Omit<MeshBasicMaterialParameters, "transparent">,
) {
	const material = new MeshBasicMaterial({
		...parameters,
		transparent: true,
		depthTest: false,
		depthWrite: false,
	});
	const viewport = { value: new Vector2(1, 1) };
	const current = new Vector4();
	material.onBeforeCompile = (shader) => {
		shader.uniforms.roundViewport = viewport;
		injectRoundShader(shader);
	};
	material.customProgramCacheKey = () => roundProgramKey;
	material.userData.roundShape = true;
	material.onBeforeRender = (renderer) => {
		renderer.getCurrentViewport(current);
		viewport.value.set(current.z, current.w);
	};
	return material;
}
