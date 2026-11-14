import type {
	EditorShape,
	TextShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { textCenter } from "@ecad/drawing-core/drawing/text-alignment.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import {
	type ComponentProps,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { DoubleSide, Group, Mesh, PlaneGeometry } from "three";
import { GerberViewer } from "#/components/gerber/GerberViewer.tsx";
import type { Viewer2DProps } from "#/components/viewer/Viewer2D.tsx";
import { uprightTextRotation } from "#/drawing/display.ts";
import { createTextMaterial } from "#/engine/drawing/text.ts";
import { compilePlanarGeometry } from "#/engine/planar-geometry.ts";
import {
	createPlanarObject3D,
	disposePlanarObject3D,
} from "#/engine/planar-object.ts";
import { buildPlanarWalls } from "#/engine/planar-walls.ts";
import {
	BOARD_SURFACE_Z,
	type BoardLayerPlan,
	boardObjectVisible,
	createBoardBuilder,
	placeFootprintBoard,
} from "#/footprint/board.ts";
import { DRILL_WALL } from "#/formats/gerber/board-stack.ts";
import type { ParsedGerberObject } from "#/formats/parseGerberFile.ts";

const TEXT_RENDER_ORDER = 4;

function buildTexts(
	layer: ReturnType<BoardLayerPlan["build"]>,
	texts: readonly TextShape[],
): ParsedGerberObject {
	const group = new Group();
	group.name = layer.name;
	const quad = new PlaneGeometry(1, 1);
	const glyphs = texts.map((text) => {
		const drawn = createTextMaterial(
			text.text,
			text.horizontalAlign,
			text.bold,
		);
		drawn.material.color.set(layer.color);
		drawn.material.depthTest = true;
		drawn.material.side = DoubleSide;
		drawn.material.polygonOffset = true;
		drawn.material.polygonOffsetFactor = -2;
		drawn.material.polygonOffsetUnits = -2;
		const mesh = new Mesh(quad, drawn.material);
		const center = textCenter(text);
		mesh.position.set(center.x, center.y, 0);
		mesh.scale.set(text.width, text.height, 1);
		mesh.rotation.z = uprightTextRotation(text.rotation);
		mesh.renderOrder = TEXT_RENDER_ORDER;
		group.add(mesh);
		return drawn;
	});
	return {
		...layer,
		type: "spatial",
		object: group,
		diagnostics: [],
		dispose: () => {
			quad.dispose();
			for (const drawn of glyphs) drawn.dispose();
		},
	};
}

function buildLayer(plan: BoardLayerPlan): ParsedGerberObject {
	const layer = plan.build();
	if (plan.texts) return buildTexts(layer, plan.texts);
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
		hiddenLayers: ReadonlySet<FootprintLayer>;
		flat: boolean;
		onFlatChange: (flat: boolean) => void;
		onBuildError: (message: string) => void;
	}) {
	const [builder] = useState(() => createBoardBuilder(buildLayer));
	useEffect(() => () => builder.dispose(), [builder]);
	const [board, setBoard] = useState<ParsedGerberObject[]>();
	useEffect(() => {
		if (board) builder.release(board);
	}, [builder, board]);
	useEffect(() => {
		try {
			setBoard(builder.build(shapes));
			onBuildError("");
		} catch (cause) {
			if (import.meta.env?.DEV) console.error(cause);
			setBoard([]);
			onBuildError("Unable to build the 3D view of this footprint.");
		}
	}, [builder, shapes, onBuildError]);
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
			ariaLabel="Footprint editor"
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
			controlsLabel="Footprint tools"
			{...viewer}
		/>
	);
}
