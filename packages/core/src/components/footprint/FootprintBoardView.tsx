import type {
	EditorShape,
	TextShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { textCenter } from "@ecad/drawing-core/drawing/text-alignment.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
	placeFootprintBoard,
	planFootprintBoard,
} from "#/footprint/board.ts";
import { DRILL_WALL } from "#/formats/gerber/board-stack.ts";
import type { ParsedGerberObject } from "#/formats/parseGerberFile.ts";

// Text draws after the translucent board sheets, which would tint it.
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
		// The text shares its height with the layer's own graphics.
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

/**
 * Builds the board's layers and keeps the ones an edit leaves alone, so a
 * drag rebuilds only the layers its items are on.
 */
function createBoardBuilder() {
	type Built = { source: readonly unknown[]; object: ParsedGerberObject };
	let layers = new Map<string, Built>();
	const retired: ParsedGerberObject[] = [];
	return {
		build(shapes: readonly EditorShape[]): ParsedGerberObject[] {
			// The view showed the retired layers until the previous build replaced them.
			for (const object of retired.splice(0)) object.dispose();
			const next = new Map<string, Built>();
			try {
				for (const plan of planFootprintBoard(shapes)) {
					const kept = layers.get(plan.id);
					next.set(
						plan.id,
						kept &&
							kept.source.length === plan.source.length &&
							kept.source.every((item, index) => item === plan.source[index])
							? kept
							: { source: plan.source, object: buildLayer(plan) },
					);
				}
			} catch (cause) {
				for (const [id, built] of next)
					if (layers.get(id) !== built) built.object.dispose();
				throw cause;
			}
			for (const [id, built] of layers)
				if (next.get(id) !== built) retired.push(built.object);
			layers = next;
			return [...next.values()].map((built) => built.object);
		},
		dispose() {
			for (const object of retired.splice(0)) object.dispose();
			for (const built of layers.values()) built.object.dispose();
			layers = new Map();
		},
	};
}

export function FootprintBoardView({
	shapes,
	hiddenLayers,
	closing,
	onClose,
	onError,
	onReady,
	...viewer
}: Pick<
	Viewer2DProps,
	| "cameraState"
	| "pixelsPerMmAt100"
	| "fitZoom"
	| "getFitBounds"
	| "onChange"
	| "onReady"
	| "interactionHint"
> & {
	shapes: readonly EditorShape[];
	hiddenLayers: ReadonlySet<FootprintLayer>;
	controls: ReactNode;
	closing: boolean;
	onClose: () => void;
	onError: (message: string) => void;
}) {
	const [builder] = useState(createBoardBuilder);
	useEffect(() => () => builder.dispose(), [builder]);
	const [board, setBoard] = useState<ParsedGerberObject[]>();
	useEffect(() => {
		try {
			setBoard(builder.build(shapes));
		} catch (cause) {
			if (import.meta.env?.DEV) console.error(cause);
			onError("Unable to build the 3D view of this footprint.");
			onClose();
		}
	}, [builder, shapes, onError, onClose]);
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
			surfaceZ={BOARD_SURFACE_Z}
			placeLayers={placeFootprintBoard}
			keepView
			projection="orthographic"
			lockProjection
			selectionEnabled={false}
			rulerUnit="mm"
			groupedControls
			controlsLabel="Footprint tools"
			onReady={(ready) => {
				if (ready) setTilted(true);
				onReady?.(ready);
			}}
			onError={onError}
			{...viewer}
		/>
	);
}
