import {
	BufferGeometry,
	CircleGeometry,
	Path,
	PlaneGeometry,
	RingGeometry,
	Shape,
	ShapeGeometry,
	Vector2,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { DrawingGeometry } from "#/drawing/display.ts";
import { createLineStyleGeometry } from "#/engine/drawing/lineStyleGeometry.ts";
import { measurePerformance } from "#/performance/runtime.ts";

/** Mesh strokes keep their millimeter width on every renderer and at every zoom. */
export function createShapeGeometry(shape: DrawingGeometry): BufferGeometry {
	if (shape.kind === "symbol") {
		if (!shape.children.length) return new BufferGeometry();
		const children = shape.children
			.filter((child) => child.kind !== "text")
			.map((child) =>
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
		if (!children.length) return new BufferGeometry();
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
	if (
		shape.lineStyle &&
		shape.lineStyle !== "solid" &&
		(shape.kind === "rectangle" ||
			shape.kind === "circle" ||
			shape.kind === "triangle" ||
			shape.kind === "line")
	) {
		const { width, height, lineWidth, lineStyle, kind } = shape;
		if (width <= 0 || height <= 0 || lineWidth <= 0)
			return new BufferGeometry();
		return measurePerformance(
			"editor.line-style-geometry",
			() => {
				let points: Vector2[];
				if (kind === "line")
					points = [new Vector2(-width / 2, 0), new Vector2(width / 2, 0)];
				else if (kind === "circle")
					points = Array.from({ length: 97 }, (_, index) => {
						const angle = (index * Math.PI * 2) / 96;
						return new Vector2(
							(Math.cos(angle) * width) / 2,
							(Math.sin(angle) * width) / 2,
						);
					});
				else {
					points = [
						new Vector2(-width / 2, -height / 2),
						new Vector2(width / 2, -height / 2),
					];
					if (kind === "rectangle")
						points.push(
							new Vector2(width / 2, height / 2),
							new Vector2(-width / 2, height / 2),
						);
					else points.push(new Vector2(0, height / 2));
					points.push(points[0]);
				}
				return createLineStyleGeometry(points, lineWidth, lineStyle).scale(
					1 / width,
					1 / (kind === "line" ? lineWidth : height),
					1,
				);
			},
			{ kind, style: lineStyle },
		);
	}
	if (shape.kind === "wire" || shape.kind === "line") {
		const { width, lineWidth } = shape;
		if (width <= 0 || lineWidth <= 0) return new BufferGeometry();
		if (
			shape.kind === "wire" &&
			(shape.bridges?.length || shape.gaps?.length)
		) {
			const pieces: BufferGeometry[] = [];
			const halfLength = width / 2;
			const intervals = [
				...(shape.bridges ?? []).map((bridge) => ({
					start: bridge.offset - bridge.radius,
					end: bridge.offset + bridge.radius,
					bridge,
				})),
				...(shape.gaps ?? []).map((gap) => ({ ...gap, bridge: undefined })),
			].sort((a, b) => a.start - b.start);
			const segment = (start: number, end: number) => {
				if (end <= start) return;
				pieces.push(
					createShapeGeometry({
						kind: "wire",
						width: end - start,
						height: lineWidth,
						lineWidth,
					})
						.scale(end - start, lineWidth, 1)
						.translate((start + end) / 2, 0, 0),
				);
			};
			let position = -halfLength;
			for (const { start, end, bridge } of intervals) {
				segment(position, Math.min(halfLength, start));
				if (bridge)
					pieces.push(
						new RingGeometry(
							Math.max(0, bridge.radius - lineWidth / 2),
							bridge.radius + lineWidth / 2,
							32,
							1,
							bridge.side > 0 ? 0 : Math.PI,
							Math.PI,
						).translate(bridge.offset, 0, 0),
					);
				position = Math.max(position, Math.min(halfLength, end));
			}
			segment(position, halfLength);
			if (!pieces.length) return new BufferGeometry();
			try {
				return (mergeGeometries(pieces) ?? new BufferGeometry()).scale(
					1 / width,
					1 / lineWidth,
					1,
				);
			} finally {
				for (const piece of pieces) piece.dispose();
			}
		}
		const radius = lineWidth / 2;
		const halfLength = width / 2;
		const outline = new Shape();
		outline.moveTo(-halfLength, -radius);
		outline.lineTo(halfLength, -radius);
		outline.absarc(halfLength, 0, radius, -Math.PI / 2, Math.PI / 2, false);
		outline.lineTo(-halfLength, radius);
		outline.absarc(-halfLength, 0, radius, Math.PI / 2, Math.PI * 1.5, false);
		outline.closePath();
		// Build caps in millimeters before normalizing to avoid stretching them.
		return new ShapeGeometry(outline).scale(1 / width, 1 / lineWidth, 1);
	}
	if (shape.kind === "text") return new PlaneGeometry(1, 1);
	if (shape.kind === "pin") return new CircleGeometry(0.5, 32);
	if (shape.kind === "pin-halo") return new RingGeometry(0.4, 0.5, 32);
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
