type Ring = [number, number][];

export interface PlanarWalls {
	extrude: "slab" | "barrel";
	positions: Float32Array;
	normals?: Float32Array;
}

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

function faceNormals(vertices: Float32Array) {
	const normals = new Float32Array(vertices.length);
	for (let index = 0; index < vertices.length; index += 9) {
		const abx = vertices[index] - vertices[index + 3],
			aby = vertices[index + 1] - vertices[index + 4],
			abz = vertices[index + 2] - vertices[index + 5];
		const cbx = vertices[index + 6] - vertices[index + 3],
			cby = vertices[index + 7] - vertices[index + 4],
			cbz = vertices[index + 8] - vertices[index + 5];
		const x = Math.fround(cby * abz - cbz * aby),
			y = Math.fround(cbz * abx - cbx * abz),
			z = Math.fround(cbx * aby - cby * abx);
		const scale = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
		for (let corner = index; corner < index + 9; corner += 3) {
			normals[corner] = x * scale;
			normals[corner + 1] = y * scale;
			normals[corner + 2] = z * scale;
		}
	}
	return normals;
}

function barrelPositions(edges: Float32Array, wall: number) {
	const rings = planarRings(edges);
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
		ax: number,
		ay: number,
		az: number,
		bx: number,
		by: number,
		bz: number,
		cx: number,
		cy: number,
		cz: number,
		dx: number,
		dy: number,
		dz: number,
	) => {
		push(ax, ay, az);
		push(bx, by, bz);
		push(cx, cy, cz);
		push(ax, ay, az);
		push(cx, cy, cz);
		push(dx, dy, dz);
	};
	for (const outer of rings) {
		const inner = offsetRing(outer, wall);
		for (let index = 0; index < outer.length; index++) {
			const next = (index + 1) % outer.length;
			const [ox, oy] = outer[index],
				[nx, ny] = outer[next];
			const [ix, iy] = inner[index],
				[jx, jy] = inner[next];
			quad(ox, oy, -0.5, nx, ny, -0.5, nx, ny, 0.5, ox, oy, 0.5);
			quad(ix, iy, -0.5, ix, iy, 0.5, jx, jy, 0.5, jx, jy, -0.5);
			quad(ox, oy, 0.5, nx, ny, 0.5, jx, jy, 0.5, ix, iy, 0.5);
			quad(ox, oy, -0.5, ix, iy, -0.5, jx, jy, -0.5, nx, ny, -0.5);
		}
	}
	return vertices;
}

function slabPositions(edges: Float32Array) {
	const vertices = new Float32Array(edges.length * 3);
	let offset = 0;
	const push = (x: number, y: number, z: number) => {
		vertices[offset++] = x;
		vertices[offset++] = y;
		vertices[offset++] = z;
	};
	for (let index = 0; index < edges.length; index += 6) {
		const ax = edges[index],
			ay = edges[index + 1],
			bx = edges[index + 3],
			by = edges[index + 4];
		push(ax, ay, -0.5);
		push(bx, by, -0.5);
		push(bx, by, 0.5);
		push(ax, ay, -0.5);
		push(bx, by, 0.5);
		push(ax, ay, 0.5);
	}
	return vertices;
}

export function buildPlanarWalls(
	edges: Float32Array,
	extrude: PlanarWalls["extrude"],
	wall = 0,
): PlanarWalls {
	if (extrude === "slab") return { extrude, positions: slabPositions(edges) };
	const positions = barrelPositions(edges, wall);
	return { extrude, positions, normals: faceNormals(positions) };
}
