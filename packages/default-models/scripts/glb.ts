import type { Color, ModelMesh } from "./mesh.ts";

const linear = (channel: number) =>
	channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

export function finish(color: Color) {
	const max = Math.max(...color);
	const min = Math.min(...color);
	const saturation = max === 0 ? 0 : (max - min) / max;
	const [red, green, blue] = color;
	const gold = red >= green && green >= blue && saturation > 0.2 && max > 0.55;
	const metal = (saturation < 0.12 && max > 0.55) || gold;
	return metal
		? { metallicFactor: 0.3, roughnessFactor: 0.4 }
		: { metallicFactor: 0, roughnessFactor: 0.6 };
}

const round = (value: number) => Math.round(value * 1e5) / 1e5 || 0;

export function writeGlb(mesh: ModelMesh, name: string): Uint8Array {
	const parts = [...mesh.parts.values()].filter(
		(part) => part.indices.length > 0,
	);
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	const bufferViews: object[] = [];
	const accessors: object[] = [];
	const add = (data: ArrayBufferView, target: number) => {
		const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
		const padding = (4 - (bytes.byteLength % 4)) % 4;
		chunks.push(bytes, new Uint8Array(padding));
		bufferViews.push({
			buffer: 0,
			byteOffset: byteLength,
			byteLength: bytes.byteLength,
			target,
		});
		byteLength += bytes.byteLength + padding;
		return bufferViews.length - 1;
	};
	const primitives = parts.map((part, material) => {
		const positions = new Float32Array(part.positions.map(round));
		const min = [Infinity, Infinity, Infinity];
		const max = [-Infinity, -Infinity, -Infinity];
		positions.forEach((value, index) => {
			const axis = index % 3;
			min[axis] = Math.min(min[axis], value);
			max[axis] = Math.max(max[axis], value);
		});
		const count = positions.length / 3;
		accessors.push({
			bufferView: add(positions, 34962),
			componentType: 5126,
			count,
			type: "VEC3",
			min,
			max,
		});
		const position = accessors.length - 1;
		accessors.push({
			bufferView: add(new Float32Array(part.normals), 34962),
			componentType: 5126,
			count,
			type: "VEC3",
		});
		const normal = accessors.length - 1;
		const indices =
			count > 65535
				? new Uint32Array(part.indices)
				: new Uint16Array(part.indices);
		accessors.push({
			bufferView: add(indices, 34963),
			componentType: count > 65535 ? 5125 : 5123,
			count: indices.length,
			type: "SCALAR",
		});
		return {
			attributes: { POSITION: position, NORMAL: normal },
			indices: accessors.length - 1,
			material,
		};
	});
	const json = {
		asset: { version: "2.0", generator: "@ecad/default-models" },
		scene: 0,
		scenes: [{ nodes: [0] }],
		nodes: [{ mesh: 0, name }],
		meshes: [{ name, primitives }],
		materials: parts.map((part) => ({
			pbrMetallicRoughness: {
				baseColorFactor: [
					...part.color.map((value) => round(linear(value))),
					1,
				],
				...finish(part.color),
			},
			doubleSided: true,
		})),
		accessors,
		bufferViews,
		buffers: [{ byteLength }],
	};
	const text = new TextEncoder().encode(JSON.stringify(json));
	const jsonLength = Math.ceil(text.byteLength / 4) * 4;
	const total = 12 + 8 + jsonLength + 8 + byteLength;
	const output = new Uint8Array(total);
	const view = new DataView(output.buffer);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, total, true);
	view.setUint32(12, jsonLength, true);
	view.setUint32(16, 0x4e4f534a, true);
	output.fill(0x20, 20, 20 + jsonLength);
	output.set(text, 20);
	let at = 20 + jsonLength;
	view.setUint32(at, byteLength, true);
	view.setUint32(at + 4, 0x004e4942, true);
	at += 8;
	for (const chunk of chunks) {
		output.set(chunk, at);
		at += chunk.byteLength;
	}
	return output;
}
