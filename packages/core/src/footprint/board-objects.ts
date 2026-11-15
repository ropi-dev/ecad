import type { TextShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { textCenter } from "@ecad/drawing-core/drawing/text-alignment.ts";
import type { PadShape } from "@ecad/drawing-core/footprint/shapes.ts";
import {
	BufferAttribute,
	BufferGeometry,
	DoubleSide,
	FrontSide,
	Group,
	type Material,
	Mesh,
} from "three";
import { padNumberSize, uprightTextRotation } from "#/drawing/display.ts";
import { createTextMaterial, measureText } from "#/engine/drawing/text.ts";
import {
	createPlanarObject3D,
	disposePlanarObject3D,
	reuploadPlanarObject3D,
} from "#/engine/planar-object.ts";
import {
	createPartCache,
	layoutParts,
	type PartLayout,
	type PlacedPart,
	partPlacement,
} from "#/engine/planar-parts.ts";
import type { PlanarObject, SceneObject } from "#/engine/types.ts";
import type { BoardLayerPlan } from "#/footprint/board.ts";
import { DRILL_WALL } from "#/formats/gerber/board-stack.ts";
import type { ParsedGerberObject } from "#/formats/parseGerberFile.ts";

const TEXT_RENDER_ORDER = 4;
const QUAD_CORNERS = [
	[-0.5, 0.5, 0, 1],
	[0.5, 0.5, 1, 1],
	[-0.5, -0.5, 0, 0],
	[0.5, -0.5, 1, 0],
] as const;
const QUAD_INDICES = [0, 2, 1, 2, 3, 1] as const;
const QUAD_POSITIONS = QUAD_CORNERS.length * 3;

export type BoardObject = ParsedGerberObject;

interface Label extends Pick<TextShape, "text" | "horizontalAlign" | "bold"> {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	facing?: "top" | "bottom";
}

interface Glyph {
	key: string;
	drawn: ReturnType<typeof createTextMaterial>;
	users: number;
}

type State =
	| {
			kind: "planar";
			parts: PlacedPart[];
			layout: PartLayout;
	  }
	| {
			kind: "text";
			labels: readonly Label[];
			glyphs: readonly Glyph[];
			geometry: BufferGeometry;
	  };

const textLabels = new WeakMap<TextShape, Label>();
const padLabels = new WeakMap<PadShape, { top?: Label; bottom?: Label }>();

function textLabel(text: TextShape): Label {
	let label = textLabels.get(text);
	if (!label) {
		label = {
			...textCenter(text),
			text: text.text,
			horizontalAlign: text.horizontalAlign,
			bold: text.bold,
			width: text.width,
			height: text.height,
			rotation: uprightTextRotation(text.rotation),
		};
		textLabels.set(text, label);
	}
	return label;
}

function padNumberLabel(
	pad: PadShape,
	bottom: boolean,
	measure: typeof measureText,
): Label {
	let sides = padLabels.get(pad);
	if (!sides) {
		sides = {};
		padLabels.set(pad, sides);
	}
	const facing = bottom ? "bottom" : "top";
	let label = sides[facing];
	if (!label) {
		const size = padNumberSize(pad, pad.pad.number, measure);
		label = {
			text: pad.pad.number,
			horizontalAlign: "center",
			x: pad.x,
			y: pad.y,
			width: size.width,
			height: size.height,
			rotation: 0,
			facing,
		};
		sides[facing] = label;
	}
	return label;
}

const glyphKey = (label: Label, color: string) =>
	JSON.stringify([
		label.text,
		label.horizontalAlign,
		label.bold,
		!label.facing,
		color,
	]);

function placeLabel(positions: Float32Array, index: number, label: Label) {
	const cos = Math.cos(label.rotation);
	const sin = Math.sin(label.rotation);
	const mirror = label.facing === "bottom" ? -1 : 1;
	let out = index * QUAD_POSITIONS;
	for (const [cornerX, cornerY] of QUAD_CORNERS) {
		const x = cornerX * label.width;
		const y = cornerY * label.height;
		positions[out] = label.x + mirror * (x * cos - y * sin);
		positions[out + 1] = label.y + x * sin + y * cos;
		out += 3;
	}
}

export function createBoardObjects({
	textMaterial = createTextMaterial,
	measure = measureText,
}: {
	textMaterial?: typeof createTextMaterial;
	measure?: typeof measureText;
} = {}) {
	const glyphCache = new Map<string, Glyph>();
	const states = new WeakMap<BoardObject, State>();
	const compiled = createPartCache();

	const resolvePart = (object: SceneObject): PlacedPart => {
		const { geometry, transform } = partPlacement(object);
		return { mesh: compiled(geometry), transform };
	};

	const buildPlanar = (
		plan: BoardLayerPlan,
		layer: PlanarObject,
		previous?: BoardObject,
	): BoardObject => {
		const { objects } = layer;
		const state = previous && states.get(previous);
		const before = state?.kind === "planar" ? state : undefined;
		if (previous && before && previous.objects.length === objects.length) {
			const changed: [number, PlacedPart][] = [];
			let fits = true;
			for (let index = 0; index < objects.length && fits; index++) {
				if (objects[index] === previous.objects[index]) continue;
				const part = resolvePart(objects[index]);
				if (before.layout.fits(index, part.mesh)) changed.push([index, part]);
				else fits = false;
			}
			if (fits) {
				for (const [index, part] of changed) {
					before.layout.replace(index, part);
					before.parts[index] = part;
				}
				previous.objects = objects;
				previous.bounds = layer.bounds;
				previous.revision = (previous.revision ?? 0) + 1;
				reuploadPlanarObject3D(
					previous.object,
					before.layout.takeChanges(),
					layer.bounds,
				);
				return previous;
			}
		}
		const known =
			previous && before
				? new Map(
						previous.objects.map((object, index) => [
							object,
							before.parts[index],
						]),
					)
				: undefined;
		const parts = objects.map(
			(object) => known?.get(object) ?? resolvePart(object),
		);
		const layout = layoutParts(parts, plan.extrude, DRILL_WALL);
		const mesh = createPlanarObject3D(
			layer,
			{ positions: layout.positions, edges: layout.edges, regions: [] },
			layout.walls,
			{ outlines: false, rewritten: true },
		);
		const built: BoardObject = {
			...layer,
			type: "spatial",
			object: mesh,
			diagnostics: [],
			dispose: () => disposePlanarObject3D(mesh),
		};
		states.set(built, { kind: "planar", parts, layout });
		return built;
	};

	const buildTexts = (
		layer: PlanarObject,
		labels: readonly Label[],
		previous?: BoardObject,
	): BoardObject => {
		const state = previous && states.get(previous);
		if (
			previous &&
			state?.kind === "text" &&
			state.labels.length === labels.length &&
			labels.every(
				(label, index) =>
					label === state.labels[index] ||
					glyphKey(label, layer.color) === state.glyphs[index].key,
			)
		) {
			const position = state.geometry.getAttribute("position");
			if (position instanceof BufferAttribute) {
				labels.forEach((label, index) => {
					if (label !== state.labels[index])
						placeLabel(position.array as Float32Array, index, label);
				});
				position.needsUpdate = true;
				state.geometry.computeBoundingBox();
				state.geometry.computeBoundingSphere();
				state.labels = labels;
				previous.bounds = layer.bounds;
				return previous;
			}
		}
		const group = new Group();
		group.name = layer.name;
		const geometry = new BufferGeometry();
		const positions = new Float32Array(labels.length * QUAD_POSITIONS);
		const uvs = new Float32Array(labels.length * QUAD_CORNERS.length * 2);
		const indices = new Uint32Array(labels.length * QUAD_INDICES.length);
		const materials: Material[] = [];
		const materialIndex = new Map<Glyph, number>();
		const glyphs = labels.map((label, index) => {
			const key = glyphKey(label, layer.color);
			let glyph = glyphCache.get(key);
			if (!glyph) {
				const drawn = textMaterial(
					label.text,
					label.horizontalAlign,
					label.bold,
				);
				drawn.material.color.set(layer.color);
				drawn.material.depthTest = true;
				drawn.material.side = label.facing ? FrontSide : DoubleSide;
				drawn.material.forceSinglePass = true;
				drawn.material.polygonOffset = true;
				drawn.material.polygonOffsetFactor = -2;
				drawn.material.polygonOffsetUnits = -2;
				glyph = { key, drawn, users: 0 };
				glyphCache.set(key, glyph);
			}
			glyph.users++;
			let material = materialIndex.get(glyph);
			if (material === undefined) {
				material = materials.push(glyph.drawn.material) - 1;
				materialIndex.set(glyph, material);
			}
			placeLabel(positions, index, label);
			QUAD_CORNERS.forEach(([, , u, v], corner) => {
				uvs[(index * QUAD_CORNERS.length + corner) * 2] = u;
				uvs[(index * QUAD_CORNERS.length + corner) * 2 + 1] = v;
			});
			QUAD_INDICES.forEach((corner, at) => {
				indices[index * QUAD_INDICES.length + at] =
					index * QUAD_CORNERS.length + corner;
			});
			geometry.addGroup(
				index * QUAD_INDICES.length,
				QUAD_INDICES.length,
				material,
			);
			return glyph;
		});
		geometry.setIndex(new BufferAttribute(indices, 1));
		geometry.setAttribute("position", new BufferAttribute(positions, 3));
		geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
		const mesh = new Mesh(geometry, materials);
		mesh.renderOrder = TEXT_RENDER_ORDER;
		group.add(mesh);
		const built: BoardObject = {
			...layer,
			type: "spatial",
			object: group,
			diagnostics: [],
			dispose: () => {
				geometry.dispose();
				for (const glyph of glyphs) {
					if (--glyph.users > 0) continue;
					glyphCache.delete(glyph.key);
					glyph.drawn.dispose();
				}
			},
		};
		states.set(built, { kind: "text", labels, glyphs, geometry });
		return built;
	};

	return (plan: BoardLayerPlan, previous?: BoardObject): BoardObject => {
		const layer = plan.build();
		if (plan.texts)
			return buildTexts(layer, plan.texts.map(textLabel), previous);
		if (plan.padNumbers) {
			const { pads, bottom } = plan.padNumbers;
			return buildTexts(
				layer,
				pads.map((pad) => padNumberLabel(pad, bottom, measure)),
				previous,
			);
		}
		return buildPlanar(plan, layer, previous);
	};
}
