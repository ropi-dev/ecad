import { transformPoint } from "./camera";
import { GeometryCompiler } from "./geometry";
import type { SceneObject } from "./types";

export type MeshObject = Pick<
	SceneObject,
	"geometry" | "transform" | "polarity"
>;
export type MeshRequest =
	| {
			type: "compile";
			layerId: string;
			revision: number;
			tolerance: number;
			objects?: MeshObject[];
	  }
	| { type: "release"; layerId: string; revision: number };
export interface MeshResult {
	layerId: string;
	revision: number;
	tolerance: number;
	vertices?: Float32Array;
	error?: string;
}

/** Preserve object order and exposure while preparing GPU vertex data off-thread. */
export function compileMesh(
	objects: readonly MeshObject[],
	compiler: GeometryCompiler,
	tolerance: number,
): Float32Array {
	const chunks = objects.map((object) => {
		const matrix = object.transform;
		const scale = matrix
			? Math.max(
					Math.hypot(matrix[0], matrix[1]),
					Math.hypot(matrix[2], matrix[3]),
					1,
				)
			: 1;
		return {
			object,
			mesh: compiler.compile(object.geometry, tolerance / scale).vertices,
		};
	});
	const count = chunks.reduce(
		(total, chunk) => total + chunk.mesh.length / 2,
		0,
	);
	const data = new Float32Array(count * 3);
	let cursor = 0;
	for (const { object, mesh } of chunks)
		for (let index = 0; index < mesh.length; index += 2) {
			const point = transformPoint(
				{ x: mesh[index], y: mesh[index + 1] },
				object.transform,
			);
			data[cursor++] = point.x;
			data[cursor++] = point.y;
			data[cursor++] = object.polarity === "clear" ? 0 : 1;
		}
	return data;
}
