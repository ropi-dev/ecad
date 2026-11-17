import { boardOutlineSegments } from "@ecad/drawing-core/board/drc.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import {
	type ComponentProps,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { boardInterior } from "#/board/fill.ts";
import { maskOpenings } from "#/board/mask.ts";
import { useFootprintModels } from "#/components/footprint/useFootprintModels.ts";
import { GerberViewer } from "#/components/gerber/GerberViewer.tsx";
import type { Viewer2DProps } from "#/components/viewer/Viewer2D.tsx";
import { boundsPolygon } from "#/engine/realistic-board.ts";
import {
	BOARD_SURFACE_Z,
	type BoardRegion,
	boardEdgeBounds,
	boardObjectOnLayer,
	boardObjectVisible,
	createBoardBuilder,
	placeFootprintBoard,
} from "#/footprint/board.ts";
import {
	type BoardObject,
	createBoardObjects,
} from "#/footprint/board-objects.ts";
import type { ModelPlacement } from "#/footprint/models.ts";
import { measurePerformance } from "#/performance/runtime.ts";
import { useSchematicTheme } from "#/settings/theme.ts";

const NO_MODELS: readonly ModelPlacement[] = [];

export function FootprintBoardView({
	shapes,
	regions,
	ariaLabel = "Footprint editor",
	controlsLabel = "Footprint tools",
	hiddenLayers,
	focusedLayer,
	flat,
	onFlatChange,
	onBuildError,
	realistic = false,
	models = NO_MODELS,
	onModelError,
	maskMargin,
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
		focusedLayer?: FootprintLayer;
		flat: boolean;
		onFlatChange: (flat: boolean) => void;
		onBuildError: (message: string) => void;
		realistic?: boolean;
		models?: readonly ModelPlacement[];
		onModelError?: (message: string) => void;
		maskMargin?: number;
	}) {
	const [builder] = useState(() => createBoardBuilder(createBoardObjects()));
	useEffect(() => () => builder.dispose(), [builder]);
	const [board, setBoard] = useState<BoardObject[]>();
	const [built, setBuilt] = useState(shapes);
	useEffect(() => {
		if (board) builder.release(board);
	}, [builder, board]);
	const colors = useSchematicTheme().appearance;
	useEffect(() => {
		setBuilt(shapes);
		try {
			setBoard(
				measurePerformance(
					"footprint.board-build",
					() => builder.build(shapes, { regions, colors }),
					{ shapes: shapes.length },
				),
			);
			onBuildError("");
		} catch (cause) {
			if (import.meta.env?.DEV) console.error(cause);
			setBoard([]);
			onBuildError("Unable to build the 3D view of this footprint.");
		}
	}, [builder, shapes, regions, colors, onBuildError]);
	const scene = useMemo(
		() =>
			board?.map((object) => ({
				...object,
				visible: boardObjectVisible(object.id, hiddenLayers),
			})),
		[board, hiddenLayers],
	);
	const focusedLayerIds = useMemo(
		() =>
			focusedLayer && board
				? new Set(
						board
							.filter((object) => boardObjectOnLayer(object.id, focusedLayer))
							.map((object) => object.id),
					)
				: undefined,
		[board, focusedLayer],
	);
	const segments = realistic ? boardOutlineSegments(built) : [];
	const edge = realistic && !segments.length ? boardEdgeBounds(built) : null;
	const outlineKey = edge
		? `${edge.minX},${edge.minY},${edge.maxX},${edge.maxY}`
		: JSON.stringify(segments);
	// biome-ignore lint/correctness/useExhaustiveDependencies: outlineKey names the Edge.Cuts strokes, or the drawing's bounds without them, so other edits keep the outline
	const outline = useMemo(() => {
		if (!realistic) return undefined;
		const interior = boardInterior(built);
		return interior.length ? interior : boundsPolygon(boardEdgeBounds(built));
	}, [realistic, outlineKey]);
	const boardShape = useMemo(
		() =>
			outline && {
				outline,
				openings: maskOpenings(built, maskMargin),
			},
		[outline, built, maskMargin],
	);
	const [placed, setPlaced] = useState(models);
	if (built === shapes && placed !== models) setPlaced(models);
	const modelObjects = useFootprintModels(
		placed,
		realistic && placed.length > 0,
		onModelError,
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
			focusedLayerIds={focusedLayerIds}
			flat={flat}
			onFlatChange={(next) => {
				shownFlat.current = next;
				onFlatChange(next);
			}}
			surfaceZ={BOARD_SURFACE_Z}
			realistic={realistic}
			boardShape={boardShape}
			models={modelObjects}
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
