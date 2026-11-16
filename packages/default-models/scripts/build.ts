import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { unzipSync } from "fflate";
import createImporter from "occt-import-js";
import { ecadModels } from "./ecad-models.ts";
import { writeGlb } from "./glb.ts";
import { type Color, ModelMesh } from "./mesh.ts";
import {
	kicadCommit,
	type Placement,
	raspberryPiArchive,
	sourceModels,
} from "./sources.ts";

const root = resolve(import.meta.dirname, "..");
const cache = resolve(root, "../../node_modules/.cache/ecad-default-models");
const output = join(root, "models");
const fallbackColor: Color = [0.7, 0.7, 0.7];

async function download(url: string, file: string) {
	const path = join(cache, file);
	try {
		return new Uint8Array(await readFile(path));
	} catch {}
	const response = await fetch(url, {
		headers: { "user-agent": "ecad-default-models" },
	});
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	const data = new Uint8Array(await response.arrayBuffer());
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(path, data);
	return data;
}

async function raspberryPiModels() {
	const archive = await download(raspberryPiArchive.url, "Minimal-KiCAD.zip");
	const sha256 = createHash("sha256").update(archive).digest("hex");
	if (raspberryPiArchive.sha256 && sha256 !== raspberryPiArchive.sha256)
		throw new Error(`Minimal-KiCAD.zip changed: sha256 ${sha256}`);
	const board = unzipSync(archive, {
		filter: (file) => file.name === raspberryPiArchive.board,
	})[raspberryPiArchive.board];
	if (!board)
		throw new Error(`${raspberryPiArchive.board} is not in the archive`);
	const text = new TextDecoder().decode(board);
	const files = new Map<string, Uint8Array>();
	for (const match of text.matchAll(
		/\(name "([^"]+)"\)\s*\(type model\)\s*\(data \|([^|]*)\|\s*\)/g,
	))
		files.set(
			match[1],
			new Uint8Array(
				zstdDecompressSync(Buffer.from(match[2].replace(/\s+/g, ""), "base64")),
			),
		);
	return { files, sha256 };
}

type Matrix = readonly number[];

function rotation([x, y, z]: readonly [number, number, number]): Matrix {
	const [a, b, c] = [x, y, z].map((degrees) => (-degrees * Math.PI) / 180);
	const rx = [
		1,
		0,
		0,
		0,
		Math.cos(a),
		-Math.sin(a),
		0,
		Math.sin(a),
		Math.cos(a),
	];
	const ry = [
		Math.cos(b),
		0,
		Math.sin(b),
		0,
		1,
		0,
		-Math.sin(b),
		0,
		Math.cos(b),
	];
	const rz = [
		Math.cos(c),
		-Math.sin(c),
		0,
		Math.sin(c),
		Math.cos(c),
		0,
		0,
		0,
		1,
	];
	return multiply(rz, multiply(ry, rx));
}

function multiply(a: Matrix, b: Matrix): Matrix {
	return Array.from({ length: 9 }, (_, index) => {
		const row = Math.floor(index / 3);
		const column = index % 3;
		return [0, 1, 2].reduce(
			(sum, k) => sum + a[row * 3 + k] * b[k * 3 + column],
			0,
		);
	});
}

const apply = (m: Matrix, x: number, y: number, z: number) => [
	m[0] * x + m[1] * y + m[2] * z,
	m[3] * x + m[4] * y + m[5] * z,
	m[6] * x + m[7] * y + m[8] * z,
];

interface OcctMesh {
	color?: Color;
	attributes: {
		position: { array: number[] };
		normal?: { array: number[] };
	};
	index: { array: number[] };
	brep_faces?: { first: number; last: number; color: Color | null }[];
}

type Importer = Awaited<ReturnType<typeof createImporter>>;

function convertStep(
	importer: Importer,
	step: Uint8Array,
	{ offset = [0, 0, 0], rotate = [0, 0, 0] }: Placement,
) {
	const result = importer.ReadStepFile(step, { linearUnit: "millimeter" });
	if (!result.success) throw new Error("Unable to read the STEP file");
	const matrix = rotation(rotate);
	const mesh = new ModelMesh();
	for (const source of result.meshes as unknown as OcctMesh[]) {
		const positions = source.attributes.position.array;
		const normals = source.attributes.normal?.array;
		const triangles = source.index.array.length / 3;
		const colors: Color[] = Array.from(
			{ length: triangles },
			() => source.color ?? fallbackColor,
		);
		for (const face of source.brep_faces ?? [])
			if (face.color)
				for (let triangle = face.first; triangle <= face.last; triangle++)
					colors[triangle] = face.color;
		const remap = new Map<string, Map<number, number>>();
		for (let triangle = 0; triangle < triangles; triangle++) {
			const color = colors[triangle];
			const part = mesh.part(color);
			const key = color.join(",");
			let indices = remap.get(key);
			if (!indices) {
				indices = new Map();
				remap.set(key, indices);
			}
			for (let corner = 0; corner < 3; corner++) {
				const vertex = source.index.array[triangle * 3 + corner];
				let mapped = indices.get(vertex);
				if (mapped === undefined) {
					mapped = part.positions.length / 3;
					indices.set(vertex, mapped);
					const [x, y, z] = apply(
						matrix,
						positions[vertex * 3],
						positions[vertex * 3 + 1],
						positions[vertex * 3 + 2],
					);
					part.positions.push(x + offset[0], y + offset[1], z + offset[2]);
					part.normals.push(
						...(normals
							? apply(
									matrix,
									normals[vertex * 3],
									normals[vertex * 3 + 1],
									normals[vertex * 3 + 2],
								)
							: [0, 0, 1]),
					);
				}
				part.indices.push(mapped);
			}
		}
	}
	return mesh;
}

const importer = await createImporter();
const raspberryPi = await raspberryPiModels();
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const model of sourceModels) {
	const { source } = model;
	const mesh =
		source.kind === "ecad"
			? ecadModels[model.id]?.()
			: source.kind === "kicad"
				? convertStep(
						importer,
						await download(
							`https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/${kicadCommit}/${source.path}`,
							`kicad/${kicadCommit}/${source.path}`,
						),
						source,
					)
				: convertStep(
						importer,
						raspberryPi.files.get(source.file) ??
							(() => {
								throw new Error(
									`${source.file} is not in the Raspberry Pi board`,
								);
							})(),
						source,
					);
	if (!mesh) throw new Error(`No model for ${model.id}`);
	const glb = writeGlb(mesh, model.name);
	await writeFile(join(output, `${model.id}.glb`), glb);
	console.log(`${model.id}.glb ${(glb.byteLength / 1024).toFixed(1)} KiB`);
}
const entry = ({ id, name, category }: (typeof sourceModels)[number]) =>
	`\t{\n\t\tid: ${JSON.stringify(id)},\n\t\tname: ${JSON.stringify(name)},\n\t\tcategory: ${JSON.stringify(category)},\n\t\turl: new URL(${JSON.stringify(`../models/${id}.glb`)}, import.meta.url).href,\n\t},\n`;
await writeFile(
	join(root, "src/catalog.ts"),
	`import type { DefaultModel } from "./types.ts";\n\nexport const catalog: readonly DefaultModel[] = [\n${sourceModels.map(entry).join("")}];\n`,
);
const format = spawnSync(
	"pnpm",
	["exec", "biome", "format", "--write", join(root, "src/catalog.ts")],
	{ stdio: "inherit" },
);
if (format.status !== 0) throw new Error("Unable to format src/catalog.ts");
console.log(
	`Wrote ${sourceModels.length} models. Raspberry Pi archive sha256 ${raspberryPi.sha256}`,
);
