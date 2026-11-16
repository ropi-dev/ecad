import {
	type CopperLayer,
	copperAt,
	copperItems,
} from "@ecad/drawing-core/board/connectivity.ts";
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
	footprintLayers,
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
import {
	type BoardAnalysisClient,
	type BoardAnalysisState,
	createBoardAnalysisClient,
	startBoardAnalysisWorker,
} from "#/board/analysis-client.ts";
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
import type { BoardGestures } from "#/components/editor/useCanvasGestures.ts";
import { buildBoardStaticDisplay } from "#/drawing/display.ts";
import { unfocusedLayerColor } from "#/drawing/schematic-theme.ts";
import type { ProjectSnapshot } from "#/projects/format.ts";
import type { BoardDocument } from "#/projects/ProjectSession.ts";
import { useSchematicTheme } from "#/settings/theme.ts";

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
	focused,
	setActive,
	selection,
	ratsnestShown,
}: {
	board: BoardDocument | undefined;
	store: Store;
	session: EditorSession;
	snapshot: ProjectSnapshot | null | undefined;
	committed: EditorShape[];
	draft: EditorShape[] | null;
	hidden: ReadonlySet<FootprintLayer>;
	active: FootprintLayer;
	focused: FootprintLayer | undefined;
	setActive: (layer: FootprintLayer) => void;
	selection: ReadonlySet<number>;
	ratsnestShown: boolean;
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
	const live = enabled ? (draft ?? committed) : noShapes;
	const [analysis, setAnalysis] = useState<BoardAnalysisClient>();
	useEffect(() => {
		if (!enabled) return;
		const client = createBoardAnalysisClient(startBoardAnalysisWorker);
		setAnalysis(client);
		return () => {
			setAnalysis(undefined);
			client.dispose();
		};
	}, [enabled]);
	useEffect(() => {
		if (rules) analysis?.configure(context.circuit, rules);
	}, [analysis, context.circuit, rules]);
	useEffect(() => {
		analysis?.show(committed, live);
	}, [analysis, committed, live]);
	const subscribe = analysis?.subscribe ?? noSubscribe;
	const state = analysis?.getState ?? idleAnalysis;
	const fills = useSyncExternalStore(
		subscribe,
		() => state().fills,
		() => state().fills,
	);
	const unrouted = useSyncExternalStore(
		subscribe,
		() => state().ratsnest?.length,
		() => state().ratsnest?.length,
	);
	const lines = useSyncExternalStore(
		subscribe,
		() => (ratsnestShown ? state().ratsnest : undefined),
		() => undefined,
	);
	const analysisError = useSyncExternalStore(
		subscribe,
		() => state().error,
		() => state().error,
	);
	const ratsnest = useMemo(() => ratsnestShapes(lines ?? []), [lines]);
	const highlight = useMemo(() => {
		if (!enabled || selection.size !== 1) return undefined;
		const [id] = selection;
		const shape = committed.find((item) => item.id === id);
		return shape && "net" in shape ? shape.net : undefined;
	}, [enabled, selection, committed]);
	const highlighted = useMemo(() => {
		const ids = new Set<number>();
		if (!highlight) return ids;
		for (const item of copperItems(committed, netlist)) {
			if (item.net !== highlight) continue;
			if (item.kind === "pad" && item.pad) {
				const footprint = item.pad.footprint;
				const local = footprint.children.findIndex(
					(child) => `${footprint.id}:${child.id}` === item.pad?.key,
				);
				if (local >= 0) ids.add(footprintItemId(footprint.id, local));
			} else ids.add(item.shapeId);
		}
		return ids;
	}, [highlight, committed, netlist]);
	const buildDisplay = useCallback(
		(
			shapes: EditorShape[],
			selected: ReadonlySet<number>,
			measure: Parameters<typeof buildBoardStaticDisplay>[4],
		) => {
			const flat = boardDisplay(shapes, selected, hidden, active);
			return buildBoardStaticDisplay(
				flat.shapes,
				flat.selected,
				highlighted,
				ratsnest,
				measure,
				focused,
			);
		},
		[hidden, active, focused, ratsnest, highlighted],
	);
	const [zoneScene] = useState(() => createZoneScene());
	const theme = useSchematicTheme();
	const layerColors = useMemo(
		() =>
			focused
				? (Object.fromEntries(
						footprintLayers.map((layer) => [
							layer,
							layer === focused
								? theme.appearance[layer]
								: unfocusedLayerColor(theme.appearance[layer], theme),
						]),
					) as Record<FootprintLayer, string>)
				: theme.appearance,
		[theme, focused],
	);
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
			zoneScene.update(root, fills, layerColors, layerOrder, hidden);
		},
		[enabled, zoneScene, fills, layerColors, layerOrder, hidden],
	);
	const copperLayer: CopperLayer = isCopperLayer(active) ? active : "F.Cu";
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
			.filter(isBoardFootprint)
			.filter((shape) => selection.has(shape.id) && !shape.locked)
			.map(flipBoardFootprint);
		if (flipped.length) session.replace(flipped, "Flip footprint");
		return flipped.length > 0;
	}, [session]);

	const runChecks = useCallback(
		async (shapes: readonly EditorShape[] = store.getSnapshot().shapes) =>
			(await analysis?.check(shapes)) ?? [],
		[analysis, store],
	);
	const fabricate = useCallback(
		async (name: string, shapes: readonly EditorShape[]) => {
			if (!analysis) throw new Error("The board is not open.");
			return analysis.fabricate(name, shapes);
		},
		[analysis],
	);

	return {
		rules,
		netlist,
		fills,
		fabricate,
		buildDisplay,
		updateZones,
		gestures,
		synchronize,
		syncReport,
		clearSyncReport: () => setSyncReport(null),
		flipSelection,
		runChecks,
		unrouted,
		analysisError,
	};
}

const idleState: BoardAnalysisState = {
	fills: [],
	ratsnest: undefined,
	error: "",
};
const idleAnalysis = () => idleState;
const noSubscribe = () => () => {};
