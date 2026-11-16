export type Color = readonly [red: number, green: number, blue: number];

export interface MeshPart {
	color: Color;
	positions: number[];
	normals: number[];
	indices: number[];
}

export class ModelMesh {
	readonly parts = new Map<string, MeshPart>();

	part(color: Color): MeshPart {
		const key = color.map((channel) => channel.toFixed(4)).join(",");
		let part = this.parts.get(key);
		if (!part) {
			part = { color, positions: [], normals: [], indices: [] };
			this.parts.set(key, part);
		}
		return part;
	}

	box(
		color: Color,
		[x0, y0, z0]: readonly [number, number, number],
		[x1, y1, z1]: readonly [number, number, number],
	) {
		const part = this.part(color);
		const faces: [number[][], number[]][] = [
			[
				[
					[x0, y0, z1],
					[x1, y0, z1],
					[x1, y1, z1],
					[x0, y1, z1],
				],
				[0, 0, 1],
			],
			[
				[
					[x0, y1, z0],
					[x1, y1, z0],
					[x1, y0, z0],
					[x0, y0, z0],
				],
				[0, 0, -1],
			],
			[
				[
					[x0, y0, z0],
					[x1, y0, z0],
					[x1, y0, z1],
					[x0, y0, z1],
				],
				[0, -1, 0],
			],
			[
				[
					[x1, y1, z0],
					[x0, y1, z0],
					[x0, y1, z1],
					[x1, y1, z1],
				],
				[0, 1, 0],
			],
			[
				[
					[x0, y1, z0],
					[x0, y0, z0],
					[x0, y0, z1],
					[x0, y1, z1],
				],
				[-1, 0, 0],
			],
			[
				[
					[x1, y0, z0],
					[x1, y1, z0],
					[x1, y1, z1],
					[x1, y0, z1],
				],
				[1, 0, 0],
			],
		];
		for (const [corners, normal] of faces) {
			const first = part.positions.length / 3;
			for (const corner of corners) {
				part.positions.push(...corner);
				part.normals.push(...normal);
			}
			part.indices.push(
				first,
				first + 1,
				first + 2,
				first,
				first + 2,
				first + 3,
			);
		}
	}

	cylinder(
		color: Color,
		[cx, cy]: readonly [number, number],
		radius: number,
		z0: number,
		z1: number,
		segments = 24,
	) {
		const part = this.part(color);
		const angles = Array.from(
			{ length: segments },
			(_, index) => (index / segments) * 2 * Math.PI,
		);
		const side = part.positions.length / 3;
		for (const angle of angles) {
			const nx = Math.cos(angle);
			const ny = Math.sin(angle);
			for (const z of [z0, z1]) {
				part.positions.push(cx + radius * nx, cy + radius * ny, z);
				part.normals.push(nx, ny, 0);
			}
		}
		for (let index = 0; index < segments; index++) {
			const a = side + 2 * index;
			const b = side + 2 * ((index + 1) % segments);
			part.indices.push(a, b, b + 1, a, b + 1, a + 1);
		}
		for (const [z, normal] of [
			[z1, 1],
			[z0, -1],
		] as const) {
			const center = part.positions.length / 3;
			part.positions.push(cx, cy, z);
			part.normals.push(0, 0, normal);
			for (const angle of angles) {
				part.positions.push(
					cx + radius * Math.cos(angle),
					cy + radius * Math.sin(angle),
					z,
				);
				part.normals.push(0, 0, normal);
			}
			for (let index = 0; index < segments; index++) {
				const a = center + 1 + index;
				const b = center + 1 + ((index + 1) % segments);
				if (normal > 0) part.indices.push(center, a, b);
				else part.indices.push(center, b, a);
			}
		}
	}
}
