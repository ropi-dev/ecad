import type { LineStyle } from "@ecad/drawing-core/drawing/line-style.ts";
import { BufferGeometry, Float32BufferAttribute, Vector2 } from "three";

const patterns: Record<Exclude<LineStyle, "solid">, readonly number[]> = {
	dashed: [6, 3],
	dotted: [0, 3],
	"dash-dot": [6, 3, 0, 3],
	"dash-dot-dot": [6, 3, 0, 3, 0, 3],
};

export function createLineStyleGeometry(
	points: Vector2[],
	lineWidth: number,
	style: Exclude<LineStyle, "solid">,
): BufferGeometry {
	const lengths = [0];
	for (let index = 1; index < points.length; index++)
		lengths.push(
			lengths[index - 1] + points[index].distanceTo(points[index - 1]),
		);
	const length = lengths[lengths.length - 1];
	if (length <= 0 || lineWidth <= 0) return new BufferGeometry();
	const pattern = patterns[style];
	const cycle = pattern.reduce((sum, value) => sum + value, 0);
	const unit = Math.max(lineWidth, length / (cycle * 2048));
	const radius = lineWidth / 2;
	const vertices: number[] = [];
	const triangle = (a: Vector2, b: Vector2, c: Vector2) => {
		vertices.push(a.x, a.y, 0, b.x, b.y, 0, c.x, c.y, 0);
	};
	const disk = (center: Vector2) => {
		for (let index = 0; index < 16; index++) {
			const first = (index * Math.PI * 2) / 16;
			const second = ((index + 1) * Math.PI * 2) / 16;
			triangle(
				center,
				new Vector2(
					center.x + radius * Math.cos(first),
					center.y + radius * Math.sin(first),
				),
				new Vector2(
					center.x + radius * Math.cos(second),
					center.y + radius * Math.sin(second),
				),
			);
		}
	};
	const pointAt = (distance: number, segment: number) =>
		points[segment]
			.clone()
			.lerp(
				points[segment + 1],
				(distance - lengths[segment]) /
					(lengths[segment + 1] - lengths[segment]),
			);
	let segment = 0;
	let distance = 0;
	let patternIndex = 0;
	while (distance < length) {
		const end = Math.min(length, distance + pattern[patternIndex] * unit);
		if (patternIndex % 2 === 0) {
			while (segment < points.length - 2 && lengths[segment + 1] <= distance)
				segment++;
			let start = pointAt(distance, segment);
			disk(start);
			let position = distance;
			while (position < end) {
				const next = Math.min(end, lengths[segment + 1]);
				const finish = pointAt(next, segment);
				const normal = new Vector2(finish.y - start.y, start.x - finish.x)
					.normalize()
					.multiplyScalar(radius);
				const a = start.clone().add(normal);
				const b = finish.clone().add(normal);
				const c = finish.clone().sub(normal);
				const d = start.clone().sub(normal);
				triangle(a, b, c);
				triangle(a, c, d);
				disk(finish);
				start = finish;
				position = next;
				if (segment < points.length - 2 && position >= lengths[segment + 1])
					segment++;
			}
		}
		distance = end;
		patternIndex = (patternIndex + 1) % pattern.length;
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
	geometry.setIndex(
		Array.from({ length: vertices.length / 3 }, (_, index) => index),
	);
	geometry.setAttribute(
		"uv",
		new Float32BufferAttribute(new Float32Array((vertices.length / 3) * 2), 2),
	);
	geometry.computeVertexNormals();
	return geometry;
}
