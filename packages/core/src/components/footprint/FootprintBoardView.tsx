import type {
	EditorShape,
	TextShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { textCenter } from "@ecad/drawing-core/drawing/text-alignment.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import type { PadShape } from "@ecad/drawing-core/footprint/shapes.ts";
import {
	type ComponentProps,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { DoubleSide, FrontSide, Group, Mesh, PlaneGeometry } from "three";
import { GerberViewer } from "#/components/gerber/GerberViewer.tsx";
import type { Viewer2DProps } from "#/components/viewer/Viewer2D.tsx";
import { padNumberSize, uprightTextRotation } from "#/drawing/display.ts";
import { createTextMaterial, measureText } from "#/engine/drawing/text.ts";
import { compilePlanarGeometry } from "#/engine/planar-geometry.ts";
import {
	createPlanarObject3D,
	disposePlanarObject3D,
} from "#/engine/planar-object.ts";
import { buildPlanarWalls } from "#/engine/planar-walls.ts";
import {
	BOARD_SURFACE_Z,
	type BoardLayerPlan,
	type BoardRegion,
	boardObjectVisible,
	createBoardBuilder,
	placeFootprintBoard,
} from "#/footprint/board.ts";
import { DRILL_WALL } from "#/formats/gerber/board-stack.ts";
import type { ParsedGerberObject } from "#/formats/parseGerberFile.ts";

const TEXT_RENDER_ORDER = 4;

interface Label extends Pick<TextShape, "text" | "horizontalAlign" | "bold"> {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	facing?: "top" | "bottom";
}

const textLabel = (text: TextShape): Label => ({
	...textCenter(text),
	text: text.text,
	horizontalAlign: text.horizontalAlign,
	bold: text.bold,
	width: text.width,
	height: text.height,
	rotation: uprightTextRotation(text.rotation),
});

function padNumberLabel(pad: PadShape, bottom: boolean): Label {
	const size = padNumberSize(pad, pad.pad.number, measureText);
	return {
		text: pad.pad.number,
		horizontalAlign: "center",
		x: pad.x,
		y: pad.y,
		width: size.width,
		height: size.height,
		rotation: 0,
		facing: bottom ? "bottom" : "top",
	};
}

interface Glyph {
	key: string;
	drawn: ReturnType<typeof createTextMaterial>;
	users: number;
}

function buildTexts(
	layer: ReturnType<BoardLayerPlan["build"]>,
	labels: readonly Label[],
	cache: Map<string, Glyph>,
): ParsedGerberObject {
	const group = new Group();
	group.name = layer.name;
	const quad = new PlaneGeometry(1, 1);
	const glyphs = labels.map((text) => {
		const key = JSON.stringify([
			text.text,
			text.horizontalAlign,
			text.bold,
			!text.facing,
			layer.color,
		]);
		let glyph = cache.get(key);
		if (!glyph) {
			const drawn = createTextMaterial(
				text.text,
				text.horizontalAlign,
				text.bold,
			);
			drawn.material.color.set(layer.color);
			drawn.material.depthTest = true;
			drawn.material.side = text.facing ? FrontSide : DoubleSide;
			drawn.material.polygonOffset = true;
			drawn.material.polygonOffsetFactor = -2;
			drawn.material.polygonOffsetUnits = -2;
			glyph = { key, drawn, users: 0 };
			cache.set(key, glyph);
		}
		glyph.users++;
		const mesh = new Mesh(quad, glyph.drawn.material);
		mesh.position.set(text.x, text.y, 0);
		mesh.scale.set(text.width, text.height, 1);
		mesh.rotation.set(0, text.facing === "bottom" ? Math.PI : 0, text.rotation);
		mesh.renderOrder = TEXT_RENDER_ORDER;
		group.add(mesh);
		return glyph;
	});
	return {
		...layer,
		type: "spatial",
		object: group,
		diagnostics: [],
		dispose: () => {
			quad.dispose();
			for (const glyph of glyphs) {
				if (--glyph.users > 0) continue;
				cache.delete(glyph.key);
				glyph.drawn.dispose();
			}
		},
	};
}

function buildLayer(
	plan: BoardLayerPlan,
	glyphs: Map<string, Glyph>,
): ParsedGerberObject {
	const layer = plan.build();
	if (plan.texts) return buildTexts(layer, plan.texts.map(textLabel), glyphs);
	if (plan.padNumbers) {
		const { pads, bottom } = plan.padNumbers;
		return buildTexts(
			layer,
			pads.map((pad) => padNumberLabel(pad, bottom)),
			glyphs,
		);
	}
	const compiled = compilePlanarGeometry(layer.objects);
	const mesh = createPlanarObject3D(
		layer,
		compiled,
		plan.extrude && buildPlanarWalls(compiled.edges, plan.extrude, DRILL_WALL),
	);
	return {
		...layer,
		type: "spatial",
		object: mesh,
		diagnostics: [],
		dispose: () => disposePlanarObject3D(mesh),
	};
}

export function FootprintBoardView({
	shapes,
	regions,
	ariaLabel = "Footprint editor",
	controlsLabel = "Footprint tools",
	hiddenLayers,
	flat,
	onFlatChange,
	onBuildError,
	...viewer
}: Pick<
	Viewer2DProps,
	| "cameraState"
	| "pixelsPerMmAt100"
	| "fitZoom"
	| "getFitBounds"
	| "onChange"
	| "onReady"
	| "onError"
	| "interactionHint"
> &
	Pick<
		ComponentProps<typeof GerberViewer>,
		"controls" | "orbitGesture" | "updateFlatScene"
	> & {
		shapes: readonly EditorShape[];
		regions?: readonly BoardRegion[];
		ariaLabel?: string;
		controlsLabel?: string;
		hiddenLayers: ReadonlySet<FootprintLayer>;
		flat: boolean;
		onFlatChange: (flat: boolean) => void;
		onBuildError: (message: string) => void;
	}) {
	const [builder] = useState(() => {
		const glyphs = new Map<string, Glyph>();
		return createBoardBuilder((plan) => buildLayer(plan, glyphs));
	});
	useEffect(() => () => builder.dispose(), [builder]);
	const [board, setBoard] = useState<ParsedGerberObject[]>();
	useEffect(() => {
		if (board) builder.release(board);
	}, [builder, board]);
	useEffect(() => {
		try {
			setBoard(builder.build(shapes, { regions }));
			onBuildError("");
		} catch (cause) {
			if (import.meta.env?.DEV) console.error(cause);
			setBoard([]);
			onBuildError("Unable to build the 3D view of this footprint.");
		}
	}, [builder, shapes, regions, onBuildError]);
	const scene = useMemo(
		() =>
			board?.map((object) => ({
				...object,
				visible: boardObjectVisible(object.id, hiddenLayers),
			})),
		[board, hiddenLayers],
	);
	const shownFlat = useRef(true);
	useEffect(() => {
		if (flat && shownFlat.current) onFlatChange(true);
	}, [flat, onFlatChange]);
	if (!scene) return null;
	return (
		<GerberViewer
			ariaLabel={ariaLabel}
			scene={scene}
			flat={flat}
			onFlatChange={(next) => {
				shownFlat.current = next;
				onFlatChange(next);
			}}
			surfaceZ={BOARD_SURFACE_Z}
			placeLayers={placeFootprintBoard}
			keepView
			projection="orthographic"
			lockProjection
			selectionEnabled={false}
			rulerUnit="mm"
			groupedControls
			controlsLabel={controlsLabel}
			{...viewer}
		/>
	);
}
