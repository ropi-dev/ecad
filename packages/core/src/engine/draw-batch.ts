import {
	Box3,
	BufferAttribute,
	BufferGeometry,
	CanvasTexture,
	Color,
	CustomBlending,
	DataTexture,
	DoubleSide,
	Group,
	type InterleavedBufferAttribute,
	Line,
	LinearFilter,
	LinearMipmapLinearFilter,
	LineBasicMaterial,
	LineLoop,
	LineSegments,
	type Material,
	Mesh,
	MeshBasicMaterial,
	type Object3D,
	OneFactor,
	OneMinusSrcAlphaFactor,
	Sphere,
	SRGBColorSpace,
	SrcAlphaFactor,
	type Texture,
	Vector2,
	Vector4,
	type WebGLRenderer,
} from "three";
import {
	isRoundGeometry,
	roundCoverage,
	roundFragmentDeclarations,
	roundPixelSize,
} from "#/engine/drawing/roundGeometry.ts";
import { capsuleData } from "#/engine/drawing/shapeGeometry.ts";

const FIRST_PAGE = 512;
const PAGE_LIMIT = 2048;
const ATLAS_GUTTER = 8;
const ATLAS_ALIGN = 32;
const CHUNK_STRIDE = 256;
const CHUNK_LIMIT = 1024;
const CHUNK_EXTENT = 64;
const aligned = (value: number) => Math.ceil(value / ATLAS_ALIGN) * ATLAS_ALIGN;

type AtlasCursor = Pick<Page, "size" | "x" | "y" | "rowHeight">;

export function atlasSlot(
	page: AtlasCursor | undefined,
	cellWidth: number,
	cellHeight: number,
): Omit<AtlasCursor, "size"> | null {
	if (!page || cellWidth > page.size) return null;
	let { x, y, rowHeight } = page;
	if (x + cellWidth > page.size) {
		x = 0;
		y += rowHeight;
		rowHeight = 0;
	}
	return y + cellHeight > page.size ? null : { x, y, rowHeight };
}

interface Page {
	texture: CanvasTexture;
	context: CanvasRenderingContext2D;
	size: number;
	x: number;
	y: number;
	rowHeight: number;
}

interface AtlasEntry {
	texture: Texture;
	version: number;
	uv: readonly number[];
	area: number;
}

type Kind = "solid" | "text" | "round" | "line";
type Program = "line" | "plain" | "opaque" | "blended";

interface Item {
	object: Mesh | Line;
	geometry: BufferGeometry;
	material: MeshBasicMaterial | LineBasicMaterial;
	version: number;
	alphaVersion: number;
	atlas: number;
	kind: Kind;
	program: Program;
	entry: AtlasEntry | null;
	groupOrder: number;
	renderOrder: number;
	state: number[];
	stamp: number;
	content: number;
	box: Box3 | null;
}

interface Chunk {
	mesh: Mesh | LineSegments;
	items: Item[];
	stamps: number[];
}

interface Subtree {
	version: number;
	atlas: number;
	groupOrder: number;
	items: Item[];
}

const materialId = (item: Item) =>
	(item.material as unknown as { id: number }).id;

const opaqueOrder = (a: Item, b: Item) =>
	a.groupOrder - b.groupOrder ||
	a.renderOrder - b.renderOrder ||
	materialId(a) - materialId(b) ||
	a.object.id - b.object.id;

const transparentOrder = (a: Item, b: Item) =>
	a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder;

const pageOf = (item: Item) => item.entry?.texture.id ?? 0;

const groupTextByPage = (items: Item[]) => {
	let start = 0;
	for (let end = 1; end <= items.length; end++) {
		const first = items[start];
		const next = items[end];
		if (
			next?.kind === "text" &&
			first.kind === "text" &&
			transparentOrder(first, next) === 0
		)
			continue;
		if (end - start > 1 && first.kind === "text") {
			const run = items.slice(start, end).sort((a, b) => pageOf(a) - pageOf(b));
			for (const [offset, item] of run.entries()) items[start + offset] = item;
		}
		start = end;
	}
	return items;
};

const triangleVertex = /* glsl */ `
attribute float batchMode;
attribute vec2 roundPoint;
attribute vec2 roundMargin;
attribute vec4 roundAxes;
attribute vec4 roundOutline;
uniform vec2 roundViewport;
varying float vBatchMode;
varying vec2 vRoundPoint;
varying vec4 vRoundOutline;
`;

const triangleOffset = /* glsl */ `
vBatchMode = batchMode;
vRoundPoint = roundPoint;
vRoundOutline = roundOutline;
if (batchMode > 1.5) {
	mat4 roundClip = projectionMatrix * modelViewMatrix;
	float roundW = (roundClip * vec4(transformed, 1.0)).w;
	vec2 roundPixels = 0.5 * roundViewport / roundW;
	vec2 roundAlongX = (roundClip * vec4(roundAxes.xy, 0.0, 0.0)).xy * roundPixels;
	vec2 roundAlongY = (roundClip * vec4(roundAxes.zw, 0.0, 0.0)).xy * roundPixels;
	vec2 roundOffset = roundMargin / max(vec2(length(roundAlongX), length(roundAlongY)), vec2(1e-6));
	transformed.xy += roundOffset.x * roundAxes.xy + roundOffset.y * roundAxes.zw;
	vRoundPoint = roundPoint + roundOffset;
}
`;

const triangleFragment = /* glsl */ `
if (vBatchMode > 1.5) {
${roundPixelSize}
${roundCoverage}
} else if (vBatchMode > 0.5) diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
`;

function createTriangleMaterial(texture: Texture, transparent: boolean) {
	const roundViewport = { value: new Vector2(1, 1) };
	const viewport = new Vector4();
	const material = new MeshBasicMaterial({
		vertexColors: true,
		transparent,
		depthTest: false,
		depthWrite: false,
		side: DoubleSide,
		forceSinglePass: true,
		alphaMap: texture,
		...(transparent
			? {}
			: {
					blending: CustomBlending,
					blendSrc: SrcAlphaFactor,
					blendDst: OneMinusSrcAlphaFactor,
					blendSrcAlpha: OneFactor,
					blendDstAlpha: OneMinusSrcAlphaFactor,
				}),
	});
	material.onBeforeCompile = (shader) => {
		shader.uniforms.roundViewport = roundViewport;
		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", `#include <common>\n${triangleVertex}`)
			.replace(
				"#include <begin_vertex>",
				`#include <begin_vertex>\n${triangleOffset}`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				"#include <common>",
				`#include <common>\nvarying float vBatchMode;\n${roundFragmentDeclarations}`,
			)
			.replace("#include <alphamap_fragment>", triangleFragment)
			.replace("#include <colorspace_fragment>", "");
	};
	material.customProgramCacheKey = () => "ecad-draw-batch";
	material.onBeforeRender = (renderer) => {
		renderer.getCurrentViewport(viewport);
		roundViewport.value.set(viewport.z, viewport.w);
	};
	return material;
}

const indicesOf = (item: Item): ArrayLike<number> | null => {
	const index = item.geometry.getIndex();
	const source = index ? index.array : null;
	if (item.kind !== "line" || item.object instanceof LineSegments)
		return source;
	const count = index
		? index.count
		: item.geometry.getAttribute("position").count;
	const loop = item.object instanceof LineLoop && count > 1;
	const segments = new Uint32Array(2 * Math.max(count - 1, 0) + (loop ? 2 : 0));
	let cursor = 0;
	for (let i = 0; i + 1 < count; i++) {
		segments[cursor++] = source ? source[i] : i;
		segments[cursor++] = source ? source[i + 1] : i + 1;
	}
	if (loop) {
		segments[cursor++] = source ? source[count - 1] : count - 1;
		segments[cursor] = source ? source[0] : 0;
	}
	return segments;
};

const outputColors = <T extends Material>(material: T) => {
	material.onBeforeCompile = (shader) => {
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <colorspace_fragment>",
			"",
		);
	};
	material.customProgramCacheKey = () => "ecad-draw-batch-output-colors";
	return material;
};

const converted = new Color();

const plainArray = (attribute: BufferAttribute | InterleavedBufferAttribute) =>
	attribute instanceof BufferAttribute && !attribute.normalized
		? attribute.array
		: null;

function buildGeometry(items: Item[], rich: boolean, srgb: boolean) {
	const parts = items.map((item) => {
		const capsules = rich ? (capsuleData(item.geometry)?.capsules ?? []) : [];
		const list = indicesOf(item);
		const length = list?.length ?? item.geometry.getAttribute("position").count;
		let kept: Uint8Array | null = null;
		let count = length;
		if (capsules.length) {
			kept = new Uint8Array(length).fill(1);
			for (const { start, count } of capsules)
				kept.fill(0, start, start + count);
			count = 0;
			for (let i = 0; i < length; i++) count += kept[i];
		}
		return { list, length, kept, count, capsules };
	});
	let vertices = 0;
	let indices = 0;
	for (const [n, item] of items.entries()) {
		vertices +=
			item.geometry.getAttribute("position").count +
			parts[n].capsules.length * 4;
		indices += parts[n].count + parts[n].capsules.length * 6;
	}
	const extra = rich ? vertices : 0;
	const position = new Float32Array(vertices * 3);
	const color = new Float32Array(vertices * 4);
	const uv = new Float32Array(extra * 2);
	const mode = new Float32Array(extra);
	const roundPoint = new Float32Array(extra * 2);
	const roundMargin = new Float32Array(extra * 2);
	const roundAxes = new Float32Array(extra * 4);
	const roundOutline = new Float32Array(extra * 4);
	const index = new Uint32Array(indices);
	const bounds = new Box3();
	const { min, max } = bounds;
	let vertex = 0;
	let cursor = 0;
	let m: number[] = [];
	let r = 0;
	let g = 0;
	let b = 0;
	let a = 0;
	const put = (x: number, y: number, z: number, itemMode: number) => {
		const p = vertex * 3;
		position[p] = m[0] * x + m[4] * y + m[8] * z + m[12];
		position[p + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
		position[p + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
		if (position[p] < min.x) min.x = position[p];
		if (position[p] > max.x) max.x = position[p];
		if (position[p + 1] < min.y) min.y = position[p + 1];
		if (position[p + 1] > max.y) max.y = position[p + 1];
		if (position[p + 2] < min.z) min.z = position[p + 2];
		if (position[p + 2] > max.z) max.z = position[p + 2];
		const c = vertex * 4;
		color[c] = r;
		color[c + 1] = g;
		color[c + 2] = b;
		color[c + 3] = a;
		if (rich) mode[vertex] = itemMode;
		return vertex++;
	};
	for (const [n, item] of items.entries()) {
		const { geometry, material, kind } = item;
		m = item.object.matrixWorld.elements;
		({ r, g, b } = srgb
			? converted.copy(material.color).convertLinearToSRGB()
			: material.color);
		a = material.opacity;
		const source = geometry.getAttribute("position");
		const sourceArray = plainArray(source);
		const size = source.itemSize;
		const textureUv = kind === "text" ? geometry.getAttribute("uv") : null;
		const point = kind === "round" ? geometry.getAttribute("roundPoint") : null;
		const margin =
			kind === "round" ? geometry.getAttribute("roundMargin") : null;
		const outline =
			kind === "round" ? geometry.getAttribute("roundOutline") : null;
		const [u0, v0, us, vs] = item.entry?.uv ?? [0, 0, 1, 1];
		const itemMode = kind === "text" ? 1 : kind === "round" ? 2 : 0;
		const first = vertex;
		for (let i = 0; i < source.count; i++) {
			const v = sourceArray
				? put(
						sourceArray[i * size],
						sourceArray[i * size + 1],
						size > 2 ? sourceArray[i * size + 2] : 0,
						itemMode,
					)
				: put(
						source.getX(i),
						source.getY(i),
						size > 2 ? source.getZ(i) : 0,
						itemMode,
					);
			if (textureUv) {
				uv[v * 2] = u0 + textureUv.getX(i) * us;
				uv[v * 2 + 1] = v0 + textureUv.getY(i) * vs;
			}
			if (point && margin && outline) {
				roundPoint[v * 2] = point.getX(i);
				roundPoint[v * 2 + 1] = point.getY(i);
				roundMargin[v * 2] = margin.getX(i);
				roundMargin[v * 2 + 1] = margin.getY(i);
				const along = margin.getZ(i);
				const across = margin.getW(i);
				roundAxes[v * 4] = m[0] * along;
				roundAxes[v * 4 + 1] = m[1] * along;
				roundAxes[v * 4 + 2] = m[4] * across;
				roundAxes[v * 4 + 3] = m[5] * across;
				roundOutline[v * 4] = outline.getX(i);
				roundOutline[v * 4 + 1] = outline.getY(i);
				roundOutline[v * 4 + 2] = outline.getZ(i);
				roundOutline[v * 4 + 3] = outline.getW(i);
			}
		}
		const { list, length, kept } = parts[n];
		for (let i = 0; i < length; i++)
			if (!kept || kept[i]) index[cursor++] = first + (list ? list[i] : i);
		const { scaleX = 1, scaleY = 1 } = capsuleData(geometry) ?? {};
		for (const capsule of parts[n].capsules) {
			const length = Math.hypot(
				capsule.bx - capsule.ax,
				capsule.by - capsule.ay,
			);
			const dx = length > 0 ? (capsule.bx - capsule.ax) / length : 1;
			const dy = length > 0 ? (capsule.by - capsule.ay) / length : 0;
			const { radius } = capsule;
			const axes = [
				m[0] * dx * scaleX + m[4] * dy * scaleY,
				m[1] * dx * scaleX + m[5] * dy * scaleY,
				-m[0] * dy * scaleX + m[4] * dx * scaleY,
				-m[1] * dy * scaleX + m[5] * dx * scaleY,
			];
			const corner = vertex;
			for (const [px, py, mx, my] of [
				[-radius, -radius, -1, -1],
				[length + radius, -radius, 1, -1],
				[length + radius, radius, 1, 1],
				[-radius, radius, -1, 1],
			]) {
				const v = put(
					capsule.ax * scaleX + px * dx * scaleX - py * dy * scaleX,
					capsule.ay * scaleY + px * dy * scaleY + py * dx * scaleY,
					0,
					2,
				);
				roundPoint.set([px, py], v * 2);
				roundMargin.set([mx, my], v * 2);
				roundAxes.set(axes, v * 4);
				roundOutline.set([0, 0, length, radius], v * 4);
			}
			for (const k of [0, 1, 2, 0, 2, 3]) index[cursor++] = corner + k;
		}
	}
	const result = new BufferGeometry();
	result.setAttribute("position", new BufferAttribute(position, 3));
	result.setAttribute("color", new BufferAttribute(color, 4));
	if (rich) {
		result.setAttribute("uv", new BufferAttribute(uv, 2));
		result.setAttribute("batchMode", new BufferAttribute(mode, 1));
		result.setAttribute("roundPoint", new BufferAttribute(roundPoint, 2));
		result.setAttribute("roundMargin", new BufferAttribute(roundMargin, 2));
		result.setAttribute("roundAxes", new BufferAttribute(roundAxes, 4));
		result.setAttribute("roundOutline", new BufferAttribute(roundOutline, 4));
	}
	result.setIndex(new BufferAttribute(index, 1));
	result.boundingBox = bounds;
	result.boundingSphere = bounds.getBoundingSphere(new Sphere());
	return result;
}

/**
 * Draws the meshes under a root from a few merged batches. Meshes stamped
 * with `userData.batchVersion` are read again only when the stamp changes.
 */
export function createDrawBatcher() {
	const object = new Group();
	object.name = "draw-batches";
	object.matrixAutoUpdate = false;
	let chunks: Chunk[] = [];
	const lineMaterial = outputColors(
		new LineBasicMaterial({
			vertexColors: true,
			depthTest: false,
			depthWrite: false,
		}),
	);
	const plainMaterial = outputColors(
		new MeshBasicMaterial({
			vertexColors: true,
			depthTest: false,
			depthWrite: false,
			side: DoubleSide,
		}),
	);
	let srgb = true;
	const triangleMaterials = new Map<string, MeshBasicMaterial>();
	const blank = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
	blank.needsUpdate = true;
	let pages: Page[] = [];
	let entries = new WeakMap<Texture, AtlasEntry[]>();
	const pending = new Set<Texture>();
	let allocated = 0;
	let atlas = 0;
	let pageSize = 0;

	const resetAtlas = () => {
		for (const page of pages) page.texture.dispose();
		pages = [];
		entries = new WeakMap();
		pending.clear();
		allocated = 0;
		atlas++;
	};

	const newPage = (size: number) => {
		const canvas = document.createElement("canvas");
		canvas.width = size;
		canvas.height = size;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Text drawing is unavailable.");
		const texture = new CanvasTexture(canvas);
		texture.premultiplyAlpha = true;
		texture.minFilter = LinearMipmapLinearFilter;
		texture.magFilter = LinearFilter;
		const page = { texture, context, size, x: 0, y: 0, rowHeight: 0 };
		pages.push(page);
		return page;
	};

	const atlasEntry = (texture: Texture): AtlasEntry => {
		const existing = entries.get(texture);
		const copies = existing?.[0].version === texture.version ? existing : [];
		const last = pages.at(-1);
		const current = copies.find(
			(copy) => copy.area === 0 || copy.texture === last?.texture,
		);
		if (current) return current;
		const image = texture.image as HTMLCanvasElement;
		const { width, height } = image;
		const cellWidth = aligned(width + ATLAS_GUTTER);
		const cellHeight = aligned(height + ATLAS_GUTTER);
		let entry: AtlasEntry = {
			texture,
			version: texture.version,
			uv: [0, 0, 1, 1],
			area: 0,
		};
		if (cellWidth <= pageSize && cellHeight <= pageSize) {
			let page = last;
			const slot = atlasSlot(page, cellWidth, cellHeight);
			if (page && slot) Object.assign(page, slot);
			else
				page = newPage(
					Math.min(
						pageSize,
						Math.max(
							FIRST_PAGE,
							2 * (page?.size ?? 0),
							2 ** Math.ceil(Math.log2(Math.max(cellWidth, cellHeight))),
						),
					),
				);
			const { x, y, size } = page;
			page.x += cellWidth;
			page.rowHeight = Math.max(page.rowHeight, cellHeight);
			page.context.drawImage(image, x, size - y - height);
			pending.add(page.texture);
			allocated += cellWidth * cellHeight;
			entry = {
				texture: page.texture,
				version: texture.version,
				uv: [x / size, y / size, width / size, height / size],
				area: cellWidth * cellHeight,
			};
		}
		entries.set(texture, [...copies, entry]);
		return entry;
	};

	const items = new WeakMap<Object3D, Item>();
	let stamps = 0;
	const itemOf = (node: Object3D, groupOrder: number): Item | "skip" | null => {
		if (node.userData.planarObject) return null;
		if (!(node instanceof Mesh || node instanceof Line))
			return node.type === "Group" || node.type === "Object3D" ? "skip" : null;
		const { geometry, material } = node;
		const alphaMap =
			material instanceof MeshBasicMaterial ? material.alphaMap : null;
		let item = items.get(node);
		if (
			!item ||
			item.geometry !== geometry ||
			item.material !== material ||
			item.version !== material.version ||
			item.alphaVersion !== (alphaMap?.version ?? 0) ||
			item.atlas !== atlas
		) {
			const kind: Kind | null =
				node instanceof Line
					? material instanceof LineBasicMaterial && !material.transparent
						? "line"
						: null
					: !(material instanceof MeshBasicMaterial) || geometry.groups.length
						? null
						: isRoundGeometry(geometry)
							? "round"
							: alphaMap
								? "text"
								: "solid";
			if (!kind) return null;
			if (!material.visible || !geometry.getAttribute("position")?.count)
				return "skip";
			item = {
				object: node,
				geometry,
				material,
				version: material.version,
				alphaVersion: alphaMap?.version ?? 0,
				atlas,
				kind,
				program:
					kind === "line"
						? "line"
						: material.transparent
							? "blended"
							: kind === "solid" && !capsuleData(geometry)
								? "plain"
								: "opaque",
				entry: kind === "text" && alphaMap ? atlasEntry(alphaMap) : null,
				groupOrder,
				renderOrder: node.renderOrder,
				state: [],
				stamp: 0,
				content: 0,
				box: null,
			};
			items.set(node, item);
		}
		const { color, opacity } = item.material;
		const state = [
			color.r,
			color.g,
			color.b,
			opacity,
			...node.matrixWorld.elements,
		];
		if (state.some((value, index) => value !== item.state[index])) {
			item.state = state;
			item.content = ++stamps;
			item.stamp = stamps;
			item.box = null;
		}
		if (
			item.groupOrder !== groupOrder ||
			item.renderOrder !== node.renderOrder
		) {
			item.stamp = ++stamps;
			item.groupOrder = groupOrder;
			item.renderOrder = node.renderOrder;
		}
		return item;
	};

	let subtrees = new Map<Object3D, Subtree>();
	const collect = (root: Object3D) => {
		const all: Item[] = [];
		const next = new Map<Object3D, Subtree>();
		const add = (node: Object3D, groupOrder: number, into: Item[]) => {
			const item = itemOf(node, groupOrder);
			if (item && item !== "skip") into.push(item);
			return item !== null && visit(node, groupOrder, into);
		};
		const visit = (node: Object3D, groupOrder: number, into: Item[]) => {
			if (node.type === "Group") groupOrder = node.renderOrder;
			for (const child of node.children) {
				if (!child.visible) continue;
				const version = child.userData.batchVersion as number | undefined;
				if (into !== all) {
					if (!add(child, groupOrder, into)) return false;
					continue;
				}
				if (version === undefined) {
					child.updateWorldMatrix(false, false);
					if (!add(child, groupOrder, all)) return false;
					continue;
				}
				let subtree = subtrees.get(child);
				if (
					subtree?.version !== version ||
					subtree.atlas !== atlas ||
					subtree.groupOrder !== groupOrder
				) {
					child.updateMatrixWorld(true);
					subtree = { version, atlas, groupOrder, items: [] };
					if (!add(child, groupOrder, subtree.items)) return false;
				}
				next.set(child, subtree);
				for (const item of subtree.items) all.push(item);
			}
			return true;
		};
		root.updateWorldMatrix(false, false);
		if (!visit(root, root.type === "Group" ? root.renderOrder : 0, all))
			return null;
		subtrees = next;
		const opaque = all.filter((item) => !item.material.transparent);
		const transparent = all.filter((item) => item.material.transparent);
		return [
			...opaque.sort(opaqueOrder),
			...groupTextByPage(transparent.sort(transparentOrder)),
		];
	};

	const boxOf = (item: Item) => {
		if (!item.box) {
			if (!item.geometry.boundingBox) item.geometry.computeBoundingBox();
			item.box = (item.geometry.boundingBox ?? new Box3())
				.clone()
				.applyMatrix4(item.object.matrixWorld);
		}
		return item.box;
	};

	const split = (items: Item[]) => {
		const runs: Item[][] = [];
		let run: Item[] = [];
		let page: Texture | undefined;
		const bounds = new Box3();
		for (const item of items) {
			const box = boxOf(item);
			bounds.union(box);
			const itemPage = item.entry?.texture;
			if (
				!run.length ||
				run[0].program !== item.program ||
				(itemPage && page && itemPage !== page) ||
				run.length >= CHUNK_LIMIT ||
				item.object.id % CHUNK_STRIDE === 0 ||
				bounds.max.x - bounds.min.x > CHUNK_EXTENT ||
				bounds.max.y - bounds.min.y > CHUNK_EXTENT
			) {
				if (run.length) runs.push(run);
				run = [];
				page = undefined;
				bounds.copy(box);
			}
			page ??= itemPage;
			run.push(item);
		}
		if (run.length) runs.push(run);
		return runs;
	};

	const triangleMaterial = (program: Program, texture: Texture) => {
		const key = `${program}:${texture.id}`;
		let material = triangleMaterials.get(key);
		if (!material) {
			material = createTriangleMaterial(texture, program === "blended");
			triangleMaterials.set(key, material);
		}
		return material;
	};

	const buildChunk = (run: Item[]): Chunk => {
		const { program } = run[0];
		const geometry = buildGeometry(
			run,
			program === "opaque" || program === "blended",
			srgb,
		);
		const texture = run.find((item) => item.entry)?.entry?.texture ?? blank;
		const mesh =
			program === "line"
				? new LineSegments(geometry, lineMaterial)
				: new Mesh(
						geometry,
						program === "plain"
							? plainMaterial
							: triangleMaterial(program, texture),
					);
		mesh.matrixAutoUpdate = false;
		return { mesh, items: run, stamps: run.map((item) => item.content) };
	};

	const drawn = new Map<Object3D, { stamp: number; box: Box3 }>();
	const damageOf = (items: Item[]) => {
		const damage: Box3[] = [];
		const seen = new Set<Object3D>();
		for (const item of items) {
			seen.add(item.object);
			const before = drawn.get(item.object);
			if (before?.stamp === item.stamp) continue;
			const box = boxOf(item);
			damage.push(box);
			if (before) damage.push(before.box);
			drawn.set(item.object, { stamp: item.stamp, box });
		}
		for (const [shown, before] of drawn)
			if (!seen.has(shown)) {
				damage.push(before.box);
				drawn.delete(shown);
			}
		return damage;
	};

	const clear = () => {
		for (const chunk of chunks.splice(0)) chunk.mesh.geometry.dispose();
		object.clear();
		drawn.clear();
		subtrees.clear();
	};

	return {
		object,
		sync(
			root: Object3D,
			renderer: WebGLRenderer,
		): { batched: boolean; damage: Box3[] | null } {
			srgb = renderer.outputColorSpace === SRGBColorSpace;
			const limit = Math.min(PAGE_LIMIT, renderer.capabilities.maxTextureSize);
			if (pageSize !== limit) {
				resetAtlas();
				pageSize = limit;
			}
			let items = collect(root);
			if (items) {
				const live = new Set(items.map((item) => item.entry));
				let used = 0;
				for (const entry of live) used += entry?.area ?? 0;
				if (allocated - used > pageSize * pageSize || pages.length > 32) {
					resetAtlas();
					items = collect(root);
				}
			}
			if (!items) {
				clear();
				object.visible = false;
				return { batched: false, damage: null };
			}
			for (const texture of pending) texture.needsUpdate = true;
			pending.clear();
			const damage = damageOf(items);
			const previous = new Map(chunks.map((chunk) => [chunk.items[0], chunk]));
			chunks = split(items).map((run) => {
				const old = previous.get(run[0]);
				if (
					old?.items.length === run.length &&
					run.every(
						(item, index) =>
							old.items[index] === item && old.stamps[index] === item.content,
					)
				) {
					previous.delete(run[0]);
					return old;
				}
				return buildChunk(run);
			});
			for (const chunk of previous.values()) chunk.mesh.geometry.dispose();
			const used = new Set(chunks.map((chunk) => chunk.mesh.material));
			for (const [key, material] of triangleMaterials)
				if (!used.has(material)) {
					material.dispose();
					triangleMaterials.delete(key);
				}
			object.clear();
			for (const [index, chunk] of chunks.entries()) {
				chunk.mesh.renderOrder = index;
				object.add(chunk.mesh);
			}
			object.visible = true;
			return { batched: true, damage };
		},
		prepare(pixel: number) {
			for (const { mesh } of chunks) {
				const { boundingBox, boundingSphere } = mesh.geometry;
				if (!boundingBox || !boundingSphere) continue;
				boundingBox.getBoundingSphere(boundingSphere);
				boundingSphere.radius += 4 * pixel;
			}
		},
		dispose() {
			clear();
			for (const material of triangleMaterials.values()) material.dispose();
			triangleMaterials.clear();
			lineMaterial.dispose();
			plainMaterial.dispose();
			blank.dispose();
			resetAtlas();
		},
	};
}
