import {
	BufferGeometry,
	CircleGeometry,
	Path,
	PlaneGeometry,
	Shape,
	ShapeGeometry,
	Vector2,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { DrawingGeometry } from "#/drawing/display.ts";

/** Mesh strokes keep their millimeter width on every renderer and at every zoom. */
export function createShapeGeometry(shape: DrawingGeometry): BufferGeometry {
	if (shape.kind === "symbol") {
		const children = shape.children.map((child) =>
			createShapeGeometry(child)
				.scale(
					child.width,
					child.kind === "wire" || child.kind === "line"
						? child.lineWidth
						: child.height,
					1,
				)
				.rotateZ(child.rotation)
				.translate(child.x, child.y, 0),
		);
		try {
			return (mergeGeometries(children) ?? new BufferGeometry()).scale(
				1 / shape.width,
				1 / shape.height,
				1,
			);
		} finally {
			for (const child of children) child.dispose();
		}
	}
	if (shape.kind === "wire" || shape.kind === "line" || shape.kind === "text")
		return new PlaneGeometry(1, 1);
	if (shape.kind === "pin") return new CircleGeometry(0.5, 32);
	const { width, height, lineWidth } = shape;
	if (width <= 0 || height <= 0) return new BufferGeometry();
	const halfStroke = lineWidth / 2;
	let contour: (offset: number) => Vector2[];
	let inradius: number;
	if (shape.kind === "circle") {
		inradius = width / 2;
		contour = (offset) =>
			Array.from({ length: 96 }, (_, index) => {
				const angle = (index * Math.PI * 2) / 96;
				return new Vector2(
					Math.cos(angle) * (inradius + offset),
					Math.sin(angle) * (inradius + offset),
				);
			});
	} else if (shape.kind === "rectangle") {
		inradius = Math.min(width, height) / 2;
		contour = (offset) => [
			new Vector2(-width / 2 - offset, -height / 2 - offset),
			new Vector2(width / 2 + offset, -height / 2 - offset),
			new Vector2(width / 2 + offset, height / 2 + offset),
			new Vector2(-width / 2 - offset, height / 2 + offset),
		];
	} else {
		inradius = (width * height) / (width + 2 * Math.hypot(width / 2, height));
		const centerY = -height / 2 + inradius;
		contour = (offset) => {
			const scale = (inradius + offset) / inradius;
			return [
				new Vector2(-width / 2, -height / 2),
				new Vector2(width / 2, -height / 2),
				new Vector2(0, height / 2),
			].map(
				(point) =>
					new Vector2(point.x * scale, centerY + (point.y - centerY) * scale),
			);
		};
	}
	const outline = new Shape(contour(halfStroke));
	if (halfStroke < inradius)
		outline.holes.push(new Path(contour(-halfStroke).reverse()));
	// Object scale continues to describe dimensions; only the stroke mesh changes.
	return new ShapeGeometry(outline).scale(1 / width, 1 / height, 1);
}
