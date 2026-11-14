import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { GerberViewer } from "#/components/gerber/GerberViewer.tsx";
import type { Viewer2DProps } from "#/components/viewer/Viewer2D.tsx";
import { compilePlanarGeometry } from "#/engine/planar-geometry.ts";
import {
	createPlanarObject3D,
	disposePlanarObject3D,
} from "#/engine/planar-object.ts";
import { buildPlanarWalls } from "#/engine/planar-walls.ts";
import {
	boardEdgeBounds,
	boardObjectVisible,
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

export function FootprintBoardView({
	shapes,
	hiddenLayers,
	closing,
	onClose,
	onError,
	...viewer
}: Pick<Viewer2DProps, "cameraState" | "pixelsPerMmAt100" | "fitZoom"> & {
	shapes: readonly EditorShape[];
	hiddenLayers: ReadonlySet<FootprintLayer>;
	controls: ReactNode;
	closing: boolean;
	onClose: () => void;
	onError: (message: string) => void;
}) {
	const [board, setBoard] = useState<ParsedGerberObject[]>();
	useEffect(() => {
		if (!shapes.length) {
			onClose();
			return;
		}
		const built = buildBoard(shapes);
		if (!built) {
			onError("Unable to build the 3D view of this footprint.");
			onClose();
			return;
		}
		setBoard(built);
		return () => {
			for (const object of built) object.dispose();
		};
	}, [shapes, onError, onClose]);
	const scene = useMemo(
		() =>
			board?.map((object) => ({
				...object,
				visible: boardObjectVisible(object.id, hiddenLayers),
			})),
		[board, hiddenLayers],
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
			scene={scene}
			flat={!tilted || closing}
			onFlatChange={(flat) => {
				if (!flat) turned.current = true;
				else if (turned.current) onClose();
			}}
			centered={false}
			projection="orthographic"
			lockProjection
			selectionEnabled={false}
			getFitBounds={() => boardEdgeBounds(shapes)}
			rulerUnit="mm"
			groupedControls
			controlsLabel="Footprint tools"
			onReady={(ready) => {
				if (ready) setTilted(true);
			}}
			onError={onError}
			{...viewer}
		/>
	);
}
