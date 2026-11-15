import {
	analyzeConnectivity,
	type CopperLayer,
	copperAt,
	copperItems,
} from "@ecad/drawing-core/board/connectivity.ts";
import { checkBoard } from "@ecad/drawing-core/board/drc.ts";
import {
	flipBoardFootprint,
	isBoardFootprint,
} from "@ecad/drawing-core/board/footprints.ts";
import { boardNetlist } from "@ecad/drawing-core/board/netlist.ts";
import type { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import {
	type FootprintLayer,
	isCopperLayer,
} from "@ecad/drawing-core/footprint/layers.ts";
import { shapeLayers } from "@ecad/drawing-core/footprint/shapes.ts";
import {
	useCallback,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import type { Object3D } from "three";
import { fillReach, fillZones } from "#/board/fill.ts";
import {
	type BoardSyncReport,
	boardContext,
	synchronizeBoardStore,
} from "#/board/sync-document.ts";
import {
	boardDisplay,
	boardLayerView,
	footprintItemId,
	ratsnestShapes,
} from "#/board/view.ts";
import { createZoneScene } from "#/board/zone-scene.ts";
import type { EditorSession } from "#/components/editor/editorSession.ts";
import { fitTextShapes } from "#/components/editor/text.ts";
import type { BoardGestures } from "#/components/editor/useCanvasGestures.ts";
import { buildBoardStaticDisplay } from "#/drawing/display.ts";
import { darkSchematicTheme } from "#/drawing/schematic-theme.ts";
import type { ProjectSnapshot } from "#/projects/format.ts";
import type { BoardDocument } from "#/projects/ProjectSession.ts";

type Store = ReturnType<typeof createDrawingStore>;

const noShapes: EditorShape[] = [];

export function useBoardEditor({
	board,
	store,
	session,
	snapshot,
	committed,
	draft,
	hidden,
	active,
	setActive,
	selection,
}: {
	board: BoardDocument | undefined;
	store: Store;
	session: EditorSession;
	snapshot: ProjectSnapshot | null | undefined;
	committed: EditorShape[];
	draft: EditorShape[] | null;
	hidden: ReadonlySet<FootprintLayer>;
	active: FootprintLayer;
	setActive: (layer: FootprintLayer) => void;
	selection: ReadonlySet<number>;
}) {
	const enabled = board !== undefined;
	const rulesStore = board?.rules;
	const rules = useSyncExternalStore(
		rulesStore?.subscribe ?? noSubscribe,
		() => rulesStore?.get(),
		() => rulesStore?.get(),
	);
	const context = useMemo(
		() => boardContext(snapshot, board?.file.circuitId),
		[snapshot, board?.file.circuitId],
	);
	const netlist = useMemo(
		() => boardNetlist(context.circuit),
		[context.circuit],
	);
	const resolve = useCallback(
		(shapes: EditorShape[]) =>
			boardLayerView(fitTextShapes(shapes), hidden, active),
		[hidden, active],
	);
	const live = enabled ? (draft ?? committed) : noShapes;
	const fills = useMemo(
		() => (enabled && rules ? fillZones(committed, netlist, rules) : []),
		[enabled, committed, netlist, rules],
	);
	const connectivity = useMemo(
		() =>
			enabled
				? analyzeConnectivity(copperItems(live, netlist), fillReach(fills))
				: undefined,
		[enabled, live, netlist, fills],
	);
	const ratsnest = useMemo(
		() => ratsnestShapes(connectivity?.ratsnest ?? []),
		[connectivity],
	);
	const highlight = useMemo(() => {
		if (!enabled || selection.size !== 1) return undefined;
		const [id] = selection;
		const shape = committed.find((item) => item.id === id);
		return shape && "net" in shape ? shape.net : undefined;
	}, [enabled, selection, committed]);
	const buildDisplay = useCallback(
		(
			shapes: EditorShape[],
			selected: ReadonlySet<number>,
			measure: Parameters<typeof buildBoardStaticDisplay>[4],
		) => {
			const flat = boardDisplay(shapes, selected, hidden, active);
			const highlighted = new Set<number>();
			if (highlight && connectivity)
				for (const item of connectivity.items)
					if (item.net === highlight) {
						if (item.kind === "pad" && item.pad) {
							const footprint = item.pad.footprint;
							const local = footprint.children.findIndex(
								(child) => `${footprint.id}:${child.id}` === item.pad?.key,
							);
							if (local >= 0)
								highlighted.add(footprintItemId(footprint.id, local));
						} else highlighted.add(item.shapeId);
					}
			return buildBoardStaticDisplay(
				flat.shapes,
				flat.selected,
				highlighted,
				ratsnest,
				measure,
			);
		},
		[hidden, active, ratsnest, highlight, connectivity],
	);
	const [zoneScene] = useState(() => createZoneScene());
	useEffect(() => () => zoneScene.dispose(), [zoneScene]);
	const layerOrder = useMemo(() => {
		const flat = boardDisplay(
			boardLayerView(committed, hidden, active),
			new Set(),
			hidden,
			active,
		).shapes;
		const first = new Map<FootprintLayer, number>();
		flat.forEach((shape, index) => {
			for (const layer of shapeLayers(shape))
				if (!first.has(layer)) first.set(layer, index + 1);
		});
		return (layer: FootprintLayer) => (first.get(layer) ?? 1) - 0.5;
	}, [committed, hidden, active]);
	const updateZones = useCallback(
		(root: Object3D) => {
			if (!enabled) return;
			zoneScene.update(
				root,
				fills,
				darkSchematicTheme.appearance,
				layerOrder,
				hidden,
			);
		},
		[enabled, zoneScene, fills, layerOrder, hidden],
	);
	const copperLayer: CopperLayer = isCopperLayer(active)
		? (active as CopperLayer)
		: "F.Cu";
	const visibleItems = useCallback(
		() =>
			copperItems(session.shapes(), netlist).filter((item) =>
				item.layers.some((layer) => !hidden.has(layer)),
			),
		[session, netlist, hidden],
	);
	const gestures = useMemo((): BoardGestures | undefined => {
		if (!enabled || !rules) return undefined;
		return {
			items: visibleItems,
			rules,
			copperLayer,
			setCopperLayer: setActive,
			netAt: (point: Point) =>
				copperAt(visibleItems(), point, copperLayer, 0.05)?.net ??
				[...netlist.nets.values()].find((net) => /^(gnd|vss)$/i.test(net.name))
					?.id,
		};
	}, [enabled, rules, visibleItems, copperLayer, setActive, netlist]);

	const [syncReport, setSyncReport] = useState<BoardSyncReport | null>(null);
	const synchronize = useCallback(async () => {
		if (!board) return null;
		session.select(new Set());
		const report = await synchronizeBoardStore(store, context);
		setSyncReport(report);
		return report;
	}, [board, context, store, session]);

	const flipSelection = useCallback(() => {
		const selection = session.getState().selection;
		const flipped = session
			.shapes()
			.filter(
				(shape) =>
					selection.has(shape.id) && isBoardFootprint(shape) && !shape.locked,
			)
			.map((shape) => flipBoardFootprint(shape as never));
		if (flipped.length) session.replace(flipped, "Flip footprint");
		return flipped.length > 0;
	}, [session]);

	const runChecks = useCallback(
		() =>
			rules
				? checkBoard(store.getSnapshot().shapes, netlist, rules, {
						zoneReach: fillReach(
							fillZones(store.getSnapshot().shapes, netlist, rules),
						),
					})
				: [],
		[store, netlist, rules],
	);

	return {
		enabled,
		rules,
		netlist,
		context,
		resolve,
		connectivity,
		fills,
		buildDisplay,
		updateZones,
		gestures,
		synchronize,
		syncReport,
		clearSyncReport: () => setSyncReport(null),
		flipSelection,
		runChecks,
		highlight,
		unrouted: connectivity?.ratsnest.length ?? 0,
	};
}

const noSubscribe = () => () => {};
