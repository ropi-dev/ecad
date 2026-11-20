import { boardOutlineSegments } from "@ecad/drawing-core/board/drc.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import {
	type ComponentProps,
	createEffect,
	createMemo,
	omit,
	onSettled,
	Show,
} from "solid-js";
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
	footprintBoardPlacer,
} from "#/footprint/board.ts";
import {
	type BoardObject,
	createBoardObjects,
} from "#/footprint/board-objects.ts";
import type { ModelPlacement } from "#/footprint/models.ts";
import { measurePerformance } from "#/performance/runtime.ts";
import { useSchematicTheme } from "#/settings/theme.ts";

export function FootprintBoardView(
	props: Pick<
		Viewer2DProps,
		| "cameraState"
		| "pixelsPerMmAt100"
		| "fitZoom"
		| "getFitBounds"
		| "onChange"
		| "onReady"
		| "onError"
		| "interactionHint"
		| "rulerUnit"
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
			copperLayers?: number | undefined;
		},
) {
	const viewer = omit(
		props,
		"shapes",
		"regions",
		"ariaLabel",
		"controlsLabel",
		"hiddenLayers",
		"focusedLayer",
		"flat",
		"onFlatChange",
		"onBuildError",
		"realistic",
		"models",
		"onModelError",
		"maskMargin",
		"copperLayers",
	);
	const builder = createBoardBuilder(createBoardObjects());
	onSettled(() => () => builder.dispose());
	const theme = useSchematicTheme();
	const build = createMemo(() => {
		const shapes = props.shapes;
		const regions = props.regions;
		const colors = theme().appearance;
		const copperLayers = props.copperLayers;
		try {
			return {
				objects: measurePerformance(
					"footprint.board-build",
					() =>
						builder.build(shapes, {
							regions,
							colors,
							...(copperLayers ? { copperLayers } : {}),
						}),
					{ shapes: shapes.length },
				),
				error: "",
			};
		} catch (cause) {
			if (import.meta.env?.DEV) console.error(cause);
			return {
				objects: [] as BoardObject[],
				error: "Unable to build the 3D view of this footprint.",
			};
		}
	});
	const board = () => build().objects;
	createEffect(board, (shown) => {
		builder.release(shown);
	});
	createEffect(
		() => build().error,
		(error) => {
			props.onBuildError(error);
		},
	);
	const scene = createMemo(() =>
		board()?.map((object) => ({
			...object,
			visible: boardObjectVisible(
				object.id,
				props.hiddenLayers,
				props.copperLayers,
			),
		})),
	);
	const focusedLayerIds = createMemo(() => {
		const layer = props.focusedLayer;
		const objects = board();
		return layer && objects
			? new Set(
					objects
						.filter((object) => boardObjectOnLayer(object.id, layer))
						.map((object) => object.id),
				)
			: undefined;
	});
	// The key names the Edge.Cuts strokes, or the drawing's bounds without
	// them, so other edits keep the outline.
	const outlineSource = createMemo(
		() => {
			const shapes = props.shapes;
			const realistic = props.realistic ?? false;
			const segments = realistic ? boardOutlineSegments(shapes) : [];
			const edge =
				realistic && !segments.length ? boardEdgeBounds(shapes) : null;
			const key = edge
				? `${edge.minX},${edge.minY},${edge.maxX},${edge.maxY}`
				: JSON.stringify(segments);
			return { realistic, key, shapes };
		},
		{
			equals: (previous, next) =>
				previous.realistic === next.realistic && previous.key === next.key,
		},
	);
	const outline = createMemo(() => {
		const { realistic, shapes } = outlineSource();
		if (!realistic) return undefined;
		const interior = boardInterior(shapes);
		return interior.length ? interior : boundsPolygon(boardEdgeBounds(shapes));
	});
	const boardShape = createMemo(() => {
		const current = outline();
		return (
			current && {
				outline: current,
				openings: maskOpenings(props.shapes, props.maskMargin),
			}
		);
	});
	const modelObjects = useFootprintModels(
		() => props.models ?? [],
		() => (props.realistic ?? false) && (props.models?.length ?? 0) > 0,
		(message) => props.onModelError?.(message),
	);
	let shownFlat = true;
	createEffect(
		() => props.flat,
		(flat) => {
			if (flat && shownFlat) props.onFlatChange(true);
		},
	);
	return (
		<Show when={scene()}>
			{(shown) => (
				<GerberViewer
					ariaLabel={props.ariaLabel ?? "Footprint editor"}
					scene={shown()}
					focusedLayerIds={focusedLayerIds()}
					flat={props.flat}
					onFlatChange={(next) => {
						shownFlat = next;
						props.onFlatChange(next);
					}}
					surfaceZ={BOARD_SURFACE_Z}
					realistic={props.realistic ?? false}
					boardShape={boardShape()}
					models={modelObjects()}
					placeLayers={footprintBoardPlacer(props.copperLayers)}
					keepView
					projection="orthographic"
					lockProjection
					selectionEnabled={false}
					groupedControls
					controlsLabel={props.controlsLabel ?? "Footprint tools"}
					{...viewer}
				/>
			)}
		</Show>
	);
}
