import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import { footprintFitBounds } from "@ecad/drawing-core/footprint/shapes.ts";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { Object3D } from "three";
import type { CanvasProjection } from "#/components/editor/canvasView.ts";
import { footprintBoardInteractionHint } from "#/components/editor/editorInteractionHint.ts";
import { GerberViewer } from "#/components/gerber/GerberViewer.tsx";
import type { Viewer2DProps } from "#/components/viewer/Viewer2D.tsx";
import { compilePlanarGeometry } from "#/engine/planar-geometry.ts";
import {
	createPlanarObject3D,
	disposePlanarObject3D,
} from "#/engine/planar-object.ts";
import { buildPlanarWalls } from "#/engine/planar-walls.ts";
import type { ViewProjection } from "#/engine/scene-viewport.ts";
import {
	boardEdgeBounds,
	boardLayerHeight,
	boardObjectVisible,
	boardShapeLayers,
	DRILL_LAYER_ID,
	footprintBoard,
} from "#/footprint/board.ts";
import { DRILL_WALL } from "#/formats/gerber/board-stack.ts";
import type { ParsedGerberObject } from "#/formats/parseGerberFile.ts";

function buildBoard(
	shapes: readonly EditorShape[],
): ParsedGerberObject[] | null {
	const built: ParsedGerberObject[] = [];
	try {
		for (const layer of footprintBoard(shapes)) {
			const compiled = compilePlanarGeometry(layer.objects);
			const mesh = createPlanarObject3D(
				layer,
				compiled,
				buildPlanarWalls(
					compiled.edges,
					layer.id === DRILL_LAYER_ID ? "barrel" : "slab",
					DRILL_WALL,
				),
			);
			built.push({
				...layer,
				type: "spatial",
				object: mesh,
				diagnostics: [],
				dispose: () => disposePlanarObject3D(mesh),
			});
		}
		return built;
	} catch (cause) {
		if (import.meta.env?.DEV) console.error(cause);
		for (const object of built) object.dispose();
		return null;
	}
}

function boardProjection(
	view: ViewProjection,
	offset: number,
	hidden: ReadonlySet<FootprintLayer>,
	active: FootprintLayer,
): CanvasProjection {
	const layerPlane = (layer = active) => boardLayerHeight(layer) + offset;
	const nearer = (a: number, b: number) => (view.fromAbove ? b - a : a - b);
	return {
		width: view.width,
		height: view.height,
		scale: view.scale,
		tilted: true,
		toWorld: (screen, plane = layerPlane()) => view.toPlane(screen, plane),
		toScreen: (point, plane = layerPlane()) =>
			view.toScreen({ x: point.x, y: point.y, z: plane }),
		planeOf: (shape) =>
			boardShapeLayers(shape)
				.filter((layer) => !hidden.has(layer))
				.map(layerPlane)
				.sort(nearer)[0],
		layerPlane,
		nearestFirst: (planes) => [...planes].sort(nearer),
	};
}

export function FootprintBoardView({
	shapes,
	hiddenLayers,
	activeLayer,
	closing,
	onClose,
	onError,
	onProjection,
	...viewer
}: Pick<Viewer2DProps, "cameraState" | "pixelsPerMmAt100" | "fitZoom"> & {
	shapes: readonly EditorShape[];
	hiddenLayers: ReadonlySet<FootprintLayer>;
	activeLayer: FootprintLayer;
	controls: ReactNode;
	closing: boolean;
	onClose: () => void;
	onError: (message: string) => void;
	onProjection: (projection: CanvasProjection | null) => void;
}) {
	const board = useMemo(() => buildBoard(shapes), [shapes]);
	useEffect(() => {
		if (!board) return;
		return () => {
			for (const object of board) object.dispose();
		};
	}, [board]);
	useEffect(() => {
		if (board) return;
		onError("Unable to build the 3D view of this footprint.");
		onClose();
	}, [board, onError, onClose]);
	const scene = useMemo(
		() =>
			board?.map((object) => ({
				...object,
				visible: boardObjectVisible(object.id, hiddenLayers),
			})),
		[board, hiddenLayers],
	);
	const camera = useRef<{
		view: ViewProjection | null;
		offset: number | null;
	}>({ view: null, offset: null });
	const layers = useRef({ hiddenLayers, activeLayer, onProjection });
	const publish = useCallback(() => {
		const { view, offset } = camera.current;
		const { hiddenLayers, activeLayer, onProjection } = layers.current;
		onProjection(
			view &&
				boardProjection(
					view,
					offset ?? -boardLayerHeight(activeLayer),
					hiddenLayers,
					activeLayer,
				),
		);
	}, []);
	useLayoutEffect(() => {
		layers.current = { hiddenLayers, activeLayer, onProjection };
		publish();
	}, [hiddenLayers, activeLayer, onProjection, publish]);
	useEffect(() => () => layers.current.onProjection(null), []);
	const place = useCallback(
		(group: Object3D) => {
			const offset = group.children.length ? group.position.z : null;
			if (camera.current.offset === offset) return;
			camera.current.offset = offset;
			publish();
		},
		[publish],
	);
	const project = useCallback(
		(view: ViewProjection) => {
			camera.current.view = view;
			publish();
		},
		[publish],
	);
	const [tilted, setTilted] = useState(false);
	const turned = useRef(false);
	useEffect(() => {
		if (closing && !turned.current) onClose();
	}, [closing, onClose]);
	if (!scene) return null;
	return (
		<GerberViewer
			ariaLabel="Footprint board"
			interactionHint={footprintBoardInteractionHint}
			scene={scene}
			flat={!tilted || closing}
			onFlatChange={(flat) => {
				if (!flat) turned.current = true;
				else if (turned.current) onClose();
			}}
			centered={false}
			projection="orthographic"
			lockProjection
			liveScene
			selectionEnabled={false}
			getFitBounds={() =>
				shapes.length ? boardEdgeBounds(shapes) : footprintFitBounds(shapes)
			}
			rulerUnit="mm"
			groupedControls
			controlsLabel="Footprint tools"
			onPlace={place}
			onProjection={project}
			onReady={(ready) => {
				if (ready) setTilted(true);
			}}
			onError={onError}
			{...viewer}
		/>
	);
}
