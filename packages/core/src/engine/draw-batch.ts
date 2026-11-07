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
	Line,
	LinearFilter,
	LinearMipmapLinearFilter,
	LineBasicMaterial,
	LineLoop,
	LineSegments,
	type Material,
	Mesh,
	MeshBasicMaterial,
	NormalBlending,
	type Object3D,
	OneFactor,
	OneMinusSrcAlphaFactor,
	type Side,
	SRGBColorSpace,
	SrcAlphaFactor,
	type Texture,
	Vector2,
	Vector4,
	type WebGLRenderer,
} from "three";
import {
	isRoundMaterial,
	roundCoverage,
	roundFragmentDeclarations,
	roundPixelSize,
} from "#/engine/drawing/roundGeometry.ts";
import {
	type CapsuleData,
	capsuleData,
} from "#/engine/drawing/shapeGeometry.ts";

const ATLAS_SOURCE_LIMIT = 1024;
const FIRST_PAGE = 512;
const LATE_PAGE = 1024;
const SEALED_PAGE = 2048;
const ATLAS_GUTTER = 8;
const ATLAS_ALIGN = 32;
const aligned = (value: number) => Math.ceil(value / ATLAS_ALIGN) * ATLAS_ALIGN;
const CHUNK_STRIDE = 256;
const CHUNK_LIMIT = 1024;
const CHUNK_EXTENT = 64;

interface Page {
	texture: Texture;
	context: CanvasRenderingContext2D | null;
	owned: boolean;
	sealed: boolean;
	cropped: boolean;
	width: number;
	height: number;
	x: number;
	y: number;
	rowHeight: number;
}

interface AtlasEntry {
	page: Page;
	version: number;
	rect: [number, number, number, number];
	area: number;
}

const uvOf = ({ page, rect: [x, y, width, height] }: AtlasEntry) => [
	x / page.width,
	y / page.height,
	width / page.width,
	height / page.height,
];

type Kind = "solid" | "text" | "round" | "line";

interface MeshRecord {
	geometry: BufferGeometry;
	material: Material;
	materialVersion: number;
	visible: boolean;
	alphaMap: Texture | null;
	alphaMapVersion: number;
	atlas: number;
	item: Item | "hidden" | null;
	matrix: Float64Array;
	matrixVersion: number;
	box: Box3 | null;
}

type Program = "line" | "blended-line" | "plain" | "opaque-rich" | "rich";

interface Item {
	record: MeshRecord;
	program: Program;
	object: Mesh | Line;
	geometry: BufferGeometry;
	material: MeshBasicMaterial | LineBasicMaterial;
	kind: Kind;
	side: Side;
	entry: AtlasEntry | null;
	groupOrder: number;
	renderOrder: number;
	transparent: boolean;
}

interface Snapshot {
	record: MeshRecord;
	object: Object3D;
	geometry: BufferGeometry;
	material: Material;
	r: number;
	g: number;
	b: number;
	a: number;
	entry: AtlasEntry | null;
	entryVersion: number;
	matrixVersion: number;
}

interface Chunk {
	mesh: Mesh | LineSegments;
	snapshots: Snapshot[];
	atlas: number;
}

const supportedTriangleMaterial = (material: MeshBasicMaterial) =>
	!material.map &&
	!material.vertexColors &&
	!material.wireframe &&
	!material.depthTest &&
	material.blending === NormalBlending &&
	!material.premultipliedAlpha &&
	material.alphaTest === 0 &&
	material.colorWrite &&
	!material.stencilWrite &&
	!material.polygonOffset &&
	!material.clippingPlanes?.length &&
	!material.envMap &&
	!material.lightMap &&
	!material.aoMap &&
	!material.specularMap;

const imageSize = (texture: Texture) =>
	texture.image as { width?: unknown; height?: unknown } | null | undefined;

const materialId = (material: Material) =>
	(material as unknown as { id: number }).id;

const plainTexture = (texture: Texture) =>
	texture.channel === 0 &&
	texture.offset.x === 0 &&
	texture.offset.y === 0 &&
	texture.repeat.x === 1 &&
	texture.repeat.y === 1 &&
	texture.rotation === 0 &&
	texture.flipY &&
	texture.premultiplyAlpha &&
	typeof imageSize(texture)?.width === "number" &&
	typeof imageSize(texture)?.height === "number";

const defaultCompile = new MeshBasicMaterial().onBeforeCompile;

const withOutputColors = <T extends Material>(material: T) => {
	material.onBeforeCompile = (shader) => {
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <colorspace_fragment>",
			"",
		);
	};
	material.customProgramCacheKey = () => "ecad-draw-batch-output-colors";
	return material;
};

const isPlainGroup = (object: Object3D) =>
	object.type === "Group" || object.type === "Object3D";

const opaqueOrder = (a: Item, b: Item) =>
	a.groupOrder - b.groupOrder ||
	a.renderOrder - b.renderOrder ||
	materialId(a.material) - materialId(b.material) ||
	a.object.id - b.object.id;

const transparentOrder = (a: Item, b: Item) =>
	a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder;

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

export function createDrawBatcher() {
	const object = new Group();
	object.name = "draw-batches";
	object.matrixAutoUpdate = false;
	let chunks: Chunk[] = [];
	const triangleMaterials = new Map<string, MeshBasicMaterial>();
	let srgb = true;
	const converted = new Color();
	const outputColor = (color: Color) =>
		srgb ? converted.copy(color).convertLinearToSRGB() : color;
	const lineMaterial = withOutputColors(
		new LineBasicMaterial({
			vertexColors: true,
			depthTest: false,
			depthWrite: false,
		}),
	);
	const blendedLineMaterial = withOutputColors(
		new LineBasicMaterial({
			vertexColors: true,
			transparent: true,
			depthTest: false,
			depthWrite: false,
		}),
	);
	const plainMaterials = new Map<Side, MeshBasicMaterial>();
	const plainMaterial = (side: Side) => {
		let material = plainMaterials.get(side);
		if (!material) {
			material = withOutputColors(
				new MeshBasicMaterial({
					vertexColors: true,
					depthTest: false,
					depthWrite: false,
					side,
				}),
			);
			plainMaterials.set(side, material);
		}
		return material;
	};
	const blank = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
	blank.needsUpdate = true;
	const pages: Page[] = [];
	const direct = new Map<Texture, Page>();
	let entries = new WeakMap<Texture, AtlasEntry>();
	let allocated = 0;
	let atlas = 0;
	let pageSize = 0;
	const viewport = new Vector4();

	const createTriangleMaterial = (
		texture: Texture,
		side: Side,
		transparent: boolean,
	) => {
		const roundViewport = { value: new Vector2(1, 1) };
		const material = new MeshBasicMaterial({
			vertexColors: true,
			transparent,
			depthTest: false,
			depthWrite: false,
			side,
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
	};

	const triangleMaterial = (
		page: Page | null,
		side: Side,
		transparent: boolean,
	) => {
		const texture = page?.texture ?? blank;
		const key = `${texture.id}:${side}:${transparent}`;
		let material = triangleMaterials.get(key);
		if (!material) {
			material = createTriangleMaterial(texture, side, transparent);
			triangleMaterials.set(key, material);
		}
		return material;
	};

	const pending = new Set<Page>();
	const resetAtlas = () => {
		pending.clear();
		for (const page of pages) if (page.owned) page.texture.dispose();
		pages.length = 0;
		direct.clear();
		entries = new WeakMap();
		allocated = 0;
		atlas++;
	};

	const newPage = (size: number): Page => {
		const canvas = document.createElement("canvas");
		canvas.width = size;
		canvas.height = size;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Text drawing is unavailable.");
		const texture = new CanvasTexture(canvas);
		texture.premultiplyAlpha = true;
		texture.minFilter = LinearMipmapLinearFilter;
		texture.magFilter = LinearFilter;
		texture.onUpdate = () => {
			if (size < SEALED_PAGE) return;
			page.sealed = true;
			page.context = null;
			const image = texture.image as HTMLCanvasElement;
			image.width = 0;
			image.height = 0;
		};
		const page: Page = {
			texture,
			context,
			owned: true,
			sealed: false,
			cropped: false,
			width: size,
			height: size,
			x: 0,
			y: 0,
			rowHeight: 0,
		};
		pages.push(page);
		return page;
	};

	const crop = (page: Page) => {
		page.cropped = true;
		const width = Math.min(page.width, aligned(page.y ? page.width : page.x));
		const height = Math.min(page.height, aligned(page.y + page.rowHeight));
		if (!page.context || (width === page.width && height === page.height))
			return;
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d");
		if (!context) return;
		context.drawImage(
			page.context.canvas,
			0,
			page.height - height,
			width,
			height,
			0,
			0,
			width,
			height,
		);
		page.context = context;
		page.texture.image = canvas;
		page.width = width;
		page.height = height;
	};

	const atlasEntry = (texture: Texture): AtlasEntry => {
		const width = imageSize(texture)?.width as number;
		const height = imageSize(texture)?.height as number;
		const existing = entries.get(texture);
		if (existing && existing.version === texture.version) return existing;
		const image = texture.image;
		if (
			!(
				image instanceof HTMLCanvasElement ||
				image instanceof ImageBitmap ||
				image instanceof HTMLImageElement ||
				(typeof OffscreenCanvas !== "undefined" &&
					image instanceof OffscreenCanvas)
			) ||
			width > ATLAS_SOURCE_LIMIT ||
			height > ATLAS_SOURCE_LIMIT ||
			width + ATLAS_GUTTER > pageSize ||
			height + ATLAS_GUTTER > pageSize
		) {
			let page = direct.get(texture);
			if (!page) {
				page = {
					texture,
					context: null,
					owned: false,
					sealed: true,
					cropped: true,
					width,
					height,
					x: 0,
					y: 0,
					rowHeight: 0,
				};
				direct.set(texture, page);
			}
			const entry: AtlasEntry = {
				page,
				version: texture.version,
				rect: [0, 0, width, height],
				area: 0,
			};
			entries.set(texture, entry);
			return entry;
		}
		const cellWidth = aligned(width + ATLAS_GUTTER);
		const cellHeight = aligned(height + ATLAS_GUTTER);
		let page = pages.at(-1);
		if (page?.sealed) page = undefined;
		if (page) {
			const wraps = page.x + cellWidth > page.width;
			const row = wraps ? page.y + page.rowHeight : page.y;
			if (row + cellHeight > page.height) page = undefined;
			else if (wraps) {
				page.x = 0;
				page.y = row;
				page.rowHeight = 0;
			}
		}
		if (!page)
			page = newPage(
				Math.min(
					pageSize,
					Math.max(
						FIRST_PAGE,
						2 ** Math.ceil(Math.log2(Math.max(cellWidth, cellHeight))),
						pages.some((page) => page.owned && page.sealed)
							? LATE_PAGE
							: 2 * (pages.filter((page) => page.owned).at(-1)?.width ?? 0),
					),
				),
			);
		const x = page.x;
		const y = page.y;
		page.x += cellWidth;
		page.rowHeight = Math.max(page.rowHeight, cellHeight);
		const top = page.height - y - height;
		page.context?.clearRect(x, top, width, height);
		page.context?.drawImage(image, x, top);
		pending.add(page);
		const area = cellWidth * cellHeight;
		allocated += area;
		const entry: AtlasEntry = {
			page,
			version: texture.version,
			rect: [x, y, width, height],
			area,
		};
		entries.set(texture, entry);
		return entry;
	};

	interface Subtree {
		version: number;
		atlas: number;
		groupOrder: number;
		items: Item[];
	}
	let subtrees = new Map<Object3D, Subtree>();
	let loose = new Set<Object3D>();

	const collect = (root: Object3D) => {
		const opaque: Item[] = [];
		const transparent: Item[] = [];
		const changed: Item[] = [];
		const removed: Item[] = [];
		const next = new Map<Object3D, Subtree>();
		const nextLoose = new Set<Object3D>();
		let supported = true;
		const place = (item: Item) =>
			(item.transparent ? transparent : opaque).push(item);
		const add = (node: Object3D, groupOrder: number, into: Item[]) => {
			if (!(node instanceof Mesh || node instanceof Line)) {
				if (!isPlainGroup(node)) supported = false;
				return;
			}
			const item = cachedItem(node, groupOrder);
			if (!item) supported = false;
			else if (item !== "hidden") into.push(item);
		};
		const visit = (node: Object3D, groupOrder: number, into: Item[] | null) => {
			if (!supported) return;
			if (node.layers.mask !== 1) {
				supported = false;
				return;
			}
			if (node.type === "Group") groupOrder = node.renderOrder;
			for (const child of node.children) {
				if (!supported) return;
				if (!child.visible) continue;
				const version = child.userData.batchVersion as number | undefined;
				if (into) {
					add(child, groupOrder, into);
					visit(child, groupOrder, into);
					continue;
				}
				if (version === undefined) {
					child.updateWorldMatrix(false, false);
					const items: Item[] = [];
					add(child, groupOrder, items);
					for (const item of items) {
						nextLoose.add(item.object);
						changed.push(item);
						place(item);
					}
					visit(child, groupOrder, null);
					continue;
				}
				const cached = subtrees.get(child);
				if (
					cached &&
					cached.version === version &&
					cached.atlas === atlas &&
					cached.groupOrder === groupOrder
				) {
					next.set(child, cached);
					for (const item of cached.items) place(item);
					continue;
				}
				child.updateMatrixWorld(true);
				const items: Item[] = [];
				add(child, groupOrder, items);
				visit(child, groupOrder, items);
				next.set(child, { version, atlas, groupOrder, items });
				for (const item of items) {
					changed.push(item);
					place(item);
				}
			}
		};
		root.updateWorldMatrix(false, false);
		visit(root, root.type === "Group" ? root.renderOrder : 0, null);
		if (!supported) return null;
		for (const [head, before] of subtrees) {
			const now = next.get(head);
			if (now === before) continue;
			const kept = new Set(now?.items.map((item) => item.object));
			for (const item of before.items)
				if (!kept.has(item.object)) removed.push(item);
		}
		const gone = [...loose].filter((object) => !nextLoose.has(object));
		subtrees = next;
		loose = nextLoose;
		opaque.sort(opaqueOrder);
		transparent.sort(transparentOrder);
		return { items: [...opaque, ...transparent], changed, removed, gone };
	};

	const records = new WeakMap<Object3D, MeshRecord>();
	let matrixVersions = 0;
	const cachedItem = (
		node: Mesh | Line,
		groupOrder: number,
	): Item | "hidden" | null => {
		const { geometry } = node;
		const material = node.material as Material;
		const alphaMap =
			material instanceof MeshBasicMaterial ? material.alphaMap : null;
		let record = records.get(node);
		if (
			!record ||
			record.geometry !== geometry ||
			record.material !== material ||
			record.materialVersion !== material.version ||
			record.visible !== material.visible ||
			record.alphaMap !== alphaMap ||
			record.alphaMapVersion !== (alphaMap?.version ?? 0) ||
			record.atlas !== atlas
		) {
			const previous = record;
			record = {
				geometry,
				material,
				materialVersion: material.version,
				visible: material.visible,
				alphaMap,
				alphaMapVersion: alphaMap?.version ?? 0,
				atlas,
				item: null,
				matrix: previous?.matrix ?? new Float64Array(16).fill(Number.NaN),
				matrixVersion: previous?.matrixVersion ?? ++matrixVersions,
				box: null,
			};
			records.set(node, record);
			const item = itemOf(node, record);
			if (item && item !== "hidden") item.program = programOf(item);
			record.item = item;
		}
		const elements = node.matrixWorld.elements;
		const matrix = record.matrix;
		for (let index = 0; index < 16; index++)
			if (matrix[index] !== elements[index]) {
				matrix.set(elements);
				record.matrixVersion = ++matrixVersions;
				record.box = null;
				break;
			}
		const item = record.item;
		if (item && item !== "hidden") {
			item.groupOrder = groupOrder;
			item.renderOrder = node.renderOrder;
		}
		return item;
	};

	const boxOf = (item: Item) => {
		const record = item.record;
		if (!record.box) {
			if (!item.geometry.boundingBox) item.geometry.computeBoundingBox();
			record.box = (item.geometry.boundingBox ?? new Box3())
				.clone()
				.applyMatrix4(item.object.matrixWorld);
		}
		return record.box;
	};

	const itemOf = (
		node: Mesh | Line,
		record: MeshRecord,
	): Item | "hidden" | null => {
		const { geometry, material } = node;
		if (Array.isArray(material) || geometry.groups.length) return null;
		if (!material.visible) return "hidden";
		if (
			geometry.drawRange.start !== 0 ||
			geometry.drawRange.count !== Number.POSITIVE_INFINITY ||
			node.layers.mask !== 1
		)
			return null;
		const position = geometry.getAttribute("position");
		if (!position || position.count === 0) return "hidden";
		const base = {
			record,
			program: "plain" as Program,
			object: node,
			geometry,
			groupOrder: 0,
			renderOrder: node.renderOrder,
			transparent: material.transparent,
		};
		if (node instanceof Line) {
			if (
				!(material instanceof LineBasicMaterial) ||
				material.type !== "LineBasicMaterial" ||
				material.vertexColors ||
				material.map ||
				material.depthTest ||
				material.blending !== NormalBlending ||
				material.premultipliedAlpha ||
				material.onBeforeCompile !== defaultCompile ||
				(node.constructor !== Line &&
					node.constructor !== LineSegments &&
					node.constructor !== LineLoop)
			)
				return null;
			return { ...base, material, kind: "line", side: DoubleSide, entry: null };
		}
		if (
			node.constructor !== Mesh ||
			!(material instanceof MeshBasicMaterial) ||
			material.type !== "MeshBasicMaterial" ||
			!supportedTriangleMaterial(material)
		)
			return null;
		if (isRoundMaterial(material)) {
			if (material.alphaMap) return null;
			return {
				...base,
				material,
				kind: "round",
				side: material.side,
				entry: null,
			};
		}
		if (material.onBeforeCompile !== defaultCompile) return null;
		if (!material.alphaMap)
			return {
				...base,
				material,
				kind: "solid",
				side: material.side,
				entry: null,
			};
		if (
			!material.transparent ||
			!plainTexture(material.alphaMap) ||
			!geometry.getAttribute("uv")
		)
			return null;
		return {
			...base,
			material,
			kind: "text",
			side: material.side,
			entry: atlasEntry(material.alphaMap),
		};
	};

	const snapshotOf = (item: Item): Snapshot => {
		const { color, opacity } = item.material;
		return {
			record: item.record,
			object: item.object,
			geometry: item.geometry,
			material: item.material,
			r: color.r,
			g: color.g,
			b: color.b,
			a: opacity,
			entry: item.entry,
			entryVersion: item.entry?.version ?? 0,
			matrixVersion: item.record.matrixVersion,
		};
	};

	const sameSnapshot = (snapshot: Snapshot, item: Item) => {
		if (
			snapshot.record !== item.record ||
			snapshot.object !== item.object ||
			snapshot.geometry !== item.geometry ||
			snapshot.material !== item.material ||
			snapshot.entry !== item.entry ||
			snapshot.entryVersion !== (item.entry?.version ?? 0)
		)
			return false;
		const { color, opacity } = item.material;
		if (
			snapshot.r !== color.r ||
			snapshot.g !== color.g ||
			snapshot.b !== color.b ||
			snapshot.a !== opacity
		)
			return false;
		return snapshot.matrixVersion === item.record.matrixVersion;
	};

	const indicesOf = (item: Item) => {
		const index = item.geometry.getIndex();
		const count = item.geometry.getAttribute("position").count;
		const source = index
			? Array.from({ length: index.count }, (_, i) => index.getX(i))
			: Array.from({ length: count }, (_, i) => i);
		if (item.kind !== "line") return source;
		if (
			item.object instanceof LineSegments &&
			!(item.object instanceof LineLoop)
		)
			return source;
		const segments: number[] = [];
		for (let i = 0; i + 1 < source.length; i++)
			segments.push(source[i], source[i + 1]);
		if (item.object instanceof LineLoop && source.length > 1)
			segments.push(source[source.length - 1], source[0]);
		return segments;
	};

	const buildLines = (items: Item[]) => {
		let vertices = 0;
		let indices = 0;
		const lists = items.map((item) => {
			const list = indicesOf(item);
			vertices += item.geometry.getAttribute("position").count;
			indices += list.length;
			return list;
		});
		const position = new Float32Array(vertices * 3);
		const color = new Float32Array(vertices * 4);
		const index = new Uint32Array(indices);
		let vertex = 0;
		let cursor = 0;
		for (const [n, item] of items.entries()) {
			const source = item.geometry.getAttribute("position");
			const m = item.object.matrixWorld.elements;
			const { r, g, b } = outputColor(item.material.color);
			const a = item.material.opacity;
			for (let i = 0; i < source.count; i++) {
				const x = source.getX(i);
				const y = source.getY(i);
				const z = source.itemSize > 2 ? source.getZ(i) : 0;
				const p = (vertex + i) * 3;
				position[p] = m[0] * x + m[4] * y + m[8] * z + m[12];
				position[p + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
				position[p + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
				color.set([r, g, b, a], (vertex + i) * 4);
			}
			for (const i of lists[n]) index[cursor++] = vertex + i;
			vertex += source.count;
		}
		const geometry = new BufferGeometry();
		geometry.setAttribute("position", new BufferAttribute(position, 3));
		geometry.setAttribute("color", new BufferAttribute(color, 4));
		geometry.setIndex(new BufferAttribute(index, 1));
		return geometry;
	};

	const buildTriangles = (items: Item[], rich: boolean) => {
		let vertices = 0;
		let indices = 0;
		const lists = items.map((item) => {
			const list = indicesOf(item);
			const capsules = rich ? capsuleData(item.geometry) : undefined;
			if (!capsules) {
				const count = item.geometry.getAttribute("position").count;
				vertices += count;
				indices += list.length;
				return { list, capsules, used: null, count };
			}
			const kept = new Uint8Array(list.length).fill(1);
			for (const { start, count } of capsules.capsules)
				kept.fill(0, start, start + count);
			const remap = new Map<number, number>();
			const used: number[] = [];
			const residual = list
				.filter((_, index) => kept[index])
				.map((source) => {
					let target = remap.get(source);
					if (target === undefined) {
						target = used.length;
						remap.set(source, target);
						used.push(source);
					}
					return target;
				});
			vertices += used.length + capsules.capsules.length * 4;
			indices += residual.length + capsules.capsules.length * 6;
			return { list: residual, capsules, used, count: used.length };
		});
		const position = new Float32Array(vertices * 3);
		const color = new Float32Array(vertices * 4);
		const extra = rich ? vertices : 0;
		const uv = new Float32Array(extra * 2);
		const mode = new Float32Array(extra);
		const roundPoint = new Float32Array(extra * 2);
		const roundMargin = new Float32Array(extra * 2);
		const roundAxes = new Float32Array(extra * 4);
		const roundOutline = new Float32Array(extra * 4);
		const index = new Uint32Array(indices);
		let vertex = 0;
		let cursor = 0;
		for (const [n, item] of items.entries()) {
			const { geometry } = item;
			const source = geometry.getAttribute("position");
			const m = item.object.matrixWorld.elements;
			const { r, g, b } = outputColor(item.material.color);
			const a = item.material.opacity;
			const itemMode = item.kind === "text" ? 1 : item.kind === "round" ? 2 : 0;
			const textureUv =
				item.kind === "text" ? geometry.getAttribute("uv") : null;
			const point =
				item.kind === "round" ? geometry.getAttribute("roundPoint") : null;
			const margin =
				item.kind === "round" ? geometry.getAttribute("roundMargin") : null;
			const outline =
				item.kind === "round" ? geometry.getAttribute("roundOutline") : null;
			const [u0, v0, us, vs] = item.entry ? uvOf(item.entry) : [0, 0, 1, 1];
			const { list, capsules, used, count } = lists[n];
			for (let k = 0; k < count; k++) {
				const v = vertex + k;
				const i = used ? used[k] : k;
				const x = source.getX(i);
				const y = source.getY(i);
				const z = source.itemSize > 2 ? source.getZ(i) : 0;
				position[v * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
				position[v * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
				position[v * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
				color[v * 4] = r;
				color[v * 4 + 1] = g;
				color[v * 4 + 2] = b;
				color[v * 4 + 3] = a;
				if (!rich) continue;
				mode[v] = itemMode;
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
			const mirrored = item.object.matrixWorld.determinant() < 0;
			for (let i = 0; i < list.length; i += 3) {
				index[cursor++] = vertex + list[i];
				index[cursor++] = vertex + list[mirrored ? i + 2 : i + 1];
				index[cursor++] = vertex + list[mirrored ? i + 1 : i + 2];
			}
			vertex += count;
			for (const capsule of capsules?.capsules ?? []) {
				const { scaleX, scaleY } = capsules as CapsuleData;
				const length = Math.hypot(
					capsule.bx - capsule.ax,
					capsule.by - capsule.ay,
				);
				const dx = length > 0 ? (capsule.bx - capsule.ax) / length : 1;
				const dy = length > 0 ? (capsule.by - capsule.ay) / length : 0;
				const radius = capsule.radius;
				const alongX = dx * scaleX;
				const alongY = dy * scaleY;
				const acrossX = -dy * scaleX;
				const acrossY = dx * scaleY;
				const axisX = m[0] * alongX + m[4] * alongY;
				const axisY = m[1] * alongX + m[5] * alongY;
				const crossX = m[0] * acrossX + m[4] * acrossY;
				const crossY = m[1] * acrossX + m[5] * acrossY;
				const corners = [
					[-radius, -radius, -1, -1],
					[length + radius, -radius, 1, -1],
					[length + radius, radius, 1, 1],
					[-radius, radius, -1, 1],
				];
				for (const [k, [px, py, mx, my]] of corners.entries()) {
					const v = vertex + k;
					const x = capsule.ax * scaleX + px * alongX + py * acrossX;
					const y = capsule.ay * scaleY + px * alongY + py * acrossY;
					position[v * 3] = m[0] * x + m[4] * y + m[12];
					position[v * 3 + 1] = m[1] * x + m[5] * y + m[13];
					position[v * 3 + 2] = m[2] * x + m[6] * y + m[14];
					color[v * 4] = r;
					color[v * 4 + 1] = g;
					color[v * 4 + 2] = b;
					color[v * 4 + 3] = a;
					mode[v] = 2;
					roundPoint[v * 2] = px;
					roundPoint[v * 2 + 1] = py;
					roundMargin[v * 2] = mx;
					roundMargin[v * 2 + 1] = my;
					roundAxes[v * 4] = axisX;
					roundAxes[v * 4 + 1] = axisY;
					roundAxes[v * 4 + 2] = crossX;
					roundAxes[v * 4 + 3] = crossY;
					roundOutline[v * 4 + 2] = length;
					roundOutline[v * 4 + 3] = radius;
				}
				const flipped = axisX * crossY - axisY * crossX < 0;
				for (const corner of flipped ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3])
					index[cursor++] = vertex + corner;
				vertex += 4;
			}
		}
		const geometry = new BufferGeometry();
		geometry.setAttribute("position", new BufferAttribute(position, 3));
		geometry.setAttribute("color", new BufferAttribute(color, 4));
		if (rich) {
			geometry.setAttribute("uv", new BufferAttribute(uv, 2));
			geometry.setAttribute("batchMode", new BufferAttribute(mode, 1));
			geometry.setAttribute("roundPoint", new BufferAttribute(roundPoint, 2));
			geometry.setAttribute("roundMargin", new BufferAttribute(roundMargin, 2));
			geometry.setAttribute("roundAxes", new BufferAttribute(roundAxes, 4));
			geometry.setAttribute(
				"roundOutline",
				new BufferAttribute(roundOutline, 4),
			);
		}
		geometry.setIndex(new BufferAttribute(index, 1));
		return geometry;
	};

	const buildChunk = (items: Item[]): Chunk => {
		const program = items[0].program;
		const page = items.find((item) => item.entry)?.entry?.page ?? null;
		const geometry =
			program === "line" || program === "blended-line"
				? buildLines(items)
				: buildTriangles(items, program !== "plain");
		geometry.computeBoundingBox();
		geometry.computeBoundingSphere();
		const mesh =
			program === "line"
				? new LineSegments(geometry, lineMaterial)
				: program === "blended-line"
					? new LineSegments(geometry, blendedLineMaterial)
					: program === "plain"
						? new Mesh(geometry, plainMaterial(items[0].side))
						: new Mesh(
								geometry,
								triangleMaterial(page, items[0].side, program === "rich"),
							);
		mesh.matrixAutoUpdate = false;
		return { mesh, snapshots: items.map(snapshotOf), atlas };
	};

	const programOf = (item: Item): Program =>
		item.kind === "line"
			? item.transparent
				? "blended-line"
				: "line"
			: item.kind === "solid" && !item.transparent
				? capsuleData(item.geometry)
					? "opaque-rich"
					: "plain"
				: "rich";

	const split = (items: Item[]) => {
		const runs: Item[][] = [];
		let run: Item[] = [];
		let page: Page | null = null;
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		let program: Program | null = null;
		let side: Side | null = null;
		for (const item of items) {
			const { min, max } = boxOf(item);
			minX = Math.min(minX, min.x);
			minY = Math.min(minY, min.y);
			maxX = Math.max(maxX, max.x);
			maxY = Math.max(maxY, max.y);
			const itemPage = item.entry?.page ?? null;
			if (
				item.program !== program ||
				item.side !== side ||
				(itemPage && page && itemPage !== page) ||
				run.length >= CHUNK_LIMIT ||
				item.object.id % CHUNK_STRIDE === 0 ||
				maxX - minX > CHUNK_EXTENT ||
				maxY - minY > CHUNK_EXTENT
			) {
				if (run.length) runs.push(run);
				run = [];
				page = null;
				program = item.program;
				side = item.side;
				minX = min.x;
				minY = min.y;
				maxX = max.x;
				maxY = max.y;
			}
			run.push(item);
			page ??= itemPage;
		}
		if (run.length) runs.push(run);
		return runs;
	};

	const drawn = new Map<
		Object3D,
		{
			record: MeshRecord;
			matrixVersion: number;
			r: number;
			g: number;
			b: number;
			a: number;
			entry: AtlasEntry | null;
			entryVersion: number;
			groupOrder: number;
			renderOrder: number;
			box: Box3;
		}
	>();
	const damageOf = (
		changed: readonly Item[],
		removed: readonly Item[],
		gone: readonly Object3D[],
		everything: boolean,
	): Box3[] | null => {
		const damage: Box3[] = [];
		for (const object of [...removed.map((item) => item.object), ...gone]) {
			const before = drawn.get(object);
			if (!before) continue;
			damage.push(before.box);
			drawn.delete(object);
		}
		for (const item of changed) {
			const before = drawn.get(item.object);
			const { color, opacity } = item.material;
			if (
				before &&
				before.record === item.record &&
				before.matrixVersion === item.record.matrixVersion &&
				before.r === color.r &&
				before.g === color.g &&
				before.b === color.b &&
				before.a === opacity &&
				before.entry === item.entry &&
				before.entryVersion === (item.entry?.version ?? 0) &&
				before.groupOrder === item.groupOrder &&
				before.renderOrder === item.renderOrder
			)
				continue;
			const box = boxOf(item);
			damage.push(box);
			if (before) damage.push(before.box);
			drawn.set(item.object, {
				record: item.record,
				matrixVersion: item.record.matrixVersion,
				r: color.r,
				g: color.g,
				b: color.b,
				a: opacity,
				entry: item.entry,
				entryVersion: item.entry?.version ?? 0,
				groupOrder: item.groupOrder,
				renderOrder: item.renderOrder,
				box,
			});
		}
		return everything ? null : damage;
	};

	const disposeChunk = (chunk: Chunk) => {
		chunk.mesh.geometry.dispose();
		chunk.mesh.removeFromParent();
	};

	return {
		object,
		sync(root: Object3D, renderer: WebGLRenderer): SyncResult {
			srgb = renderer.outputColorSpace === SRGBColorSpace;
			const generation = atlas;
			const limit = Math.min(4096, renderer.capabilities.maxTextureSize);
			if (pageSize !== limit) {
				resetAtlas();
				pageSize = limit;
			}
			let collected = collect(root);
			if (collected) {
				const { items } = collected;
				let live = 0;
				const seen = new Set<AtlasEntry>();
				for (const item of items)
					if (item.entry && !seen.has(item.entry)) {
						seen.add(item.entry);
						live += item.entry.area;
					}
				if (
					allocated - live > pageSize * pageSize ||
					pages.filter((page) => page.owned).length > 32
				) {
					resetAtlas();
					collected = collect(root);
				}
			}
			if (!collected) {
				for (const chunk of chunks.splice(0)) disposeChunk(chunk);
				drawn.clear();
				subtrees.clear();
				loose.clear();
				object.visible = false;
				return { batched: false, damage: null };
			}
			for (const page of pending) {
				if (!page.cropped && page.width >= SEALED_PAGE) crop(page);
				page.texture.needsUpdate = true;
			}
			pending.clear();
			const { items } = collected;
			const damage = damageOf(
				collected.changed,
				collected.removed,
				collected.gone,
				generation !== atlas,
			);
			object.visible = true;
			const previous = new Map<Object3D, Chunk>();
			for (const chunk of chunks)
				previous.set(chunk.snapshots[0].object, chunk);
			const next: Chunk[] = [];
			for (const run of split(items)) {
				const old = previous.get(run[0].object);
				if (
					old &&
					old.atlas === atlas &&
					old.snapshots.length === run.length &&
					run.every((item, index) => sameSnapshot(old.snapshots[index], item))
				) {
					previous.delete(run[0].object);
					next.push(old);
				} else next.push(buildChunk(run));
			}
			for (const chunk of previous.values()) disposeChunk(chunk);
			chunks = next;
			const used = new Set(chunks.map((chunk) => chunk.mesh.material));
			for (const [key, material] of triangleMaterials)
				if (!used.has(material)) {
					material.dispose();
					triangleMaterials.delete(key);
				}
			const shown = new Set(items.map((item) => item.entry?.page));
			for (const [texture, page] of direct)
				if (!shown.has(page)) direct.delete(texture);
			object.children.length = 0;
			for (const [index, chunk] of chunks.entries()) {
				chunk.mesh.renderOrder = index;
				chunk.mesh.parent = object;
				object.children.push(chunk.mesh);
			}
			return { batched: true, damage };
		},
		prepare(pixel: number) {
			for (const chunk of chunks) {
				const sphere = chunk.mesh.geometry.boundingSphere;
				const box = chunk.mesh.geometry.boundingBox;
				if (!sphere || !box) continue;
				box.getBoundingSphere(sphere);
				sphere.radius += 4 * pixel;
			}
		},
		dispose() {
			for (const chunk of chunks.splice(0)) disposeChunk(chunk);
			drawn.clear();
			subtrees.clear();
			loose.clear();
			for (const material of triangleMaterials.values()) material.dispose();
			triangleMaterials.clear();
			lineMaterial.dispose();
			blendedLineMaterial.dispose();
			for (const material of plainMaterials.values()) material.dispose();
			blank.dispose();
			resetAtlas();
		},
	};
}

export interface SyncResult {
	batched: boolean;
	damage: Box3[] | null;
}
