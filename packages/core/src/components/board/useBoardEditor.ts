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
import type { LengthUnit } from "@ecad/drawing-core/drawing/units.ts";
import {
	allLayers,
	boardCopperLayers,
	type FootprintLayer,
	isCopperLayer,
} from "@ecad/drawing-core/footprint/layers.ts";
import { shapeLayers } from "@ecad/drawing-core/footprint/shapes.ts";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onSettled,
} from "solid-js";
import type { Object3D } from "three";
import {
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
import {
	buildBoardPreviewDisplay,
	buildBoardStaticDisplay,
} from "#/drawing/display.ts";
import { unfocusedLayerColor } from "#/drawing/schematic-theme.ts";
import { fromExternalStore } from "#/lib/external-store.ts";
import type { ProjectSnapshot } from "#/projects/format.ts";
import type { BoardDocument } from "#/projects/ProjectSession.ts";
import { useSchematicTheme } from "#/settings/theme.ts";

type Store = ReturnType<typeof createDrawingStore>;

const noShapes: EditorShape[] = [];

export function useBoardEditor(
	options: Accessor<{
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
	}>,
) {
	const board = createMemo(() => options().board);
	const store = createMemo(() => options().store);
	const session = createMemo(() => options().session);
	const snapshot = createMemo(() => options().snapshot);
	const committed = createMemo(() => options().committed);
	const draft = createMemo(() => options().draft);
	const hidden = createMemo(() => options().hidden);
	const active = createMemo(() => options().active);
	const focused = createMemo(() => options().focused);
	const selection = createMemo(() => options().selection);
	const ratsnestShown = createMemo(() => options().ratsnestShown);
	const enabled = createMemo(() => board() !== undefined);
	const rulesSource = createMemo(() => {
		const rulesStore = board()?.rules;
		return rulesStore
			? fromExternalStore(
					(listener) => rulesStore.subscribe(listener),
					() => rulesStore.get(),
				)
			: () => undefined;
	});
	const rules = () => rulesSource()();
	const circuitId = createMemo(() => board()?.file.circuitId);
	const context = createMemo(() => boardContext(snapshot(), circuitId()));
	const circuit = createMemo(() => context().circuit);
	const netlist = createMemo(() => boardNetlist(circuit()));
	const live = createMemo(() =>
		enabled() ? (draft() ?? committed()) : noShapes,
	);
	const analysis = createMemo(() => {
		if (!enabled()) return undefined;
		const client = createBoardAnalysisClient(startBoardAnalysisWorker);
		onCleanup(() => client.dispose());
		return client;
	});
	createEffect(
		() => ({ client: analysis(), circuit: circuit(), rules: rules() }),
		({ client, circuit, rules }) => {
			if (rules) client?.configure(circuit, rules);
		},
	);
	createEffect(
		() => ({ client: analysis(), committed: committed(), live: live() }),
		({ client, committed, live }) => {
			client?.show(committed, live);
		},
	);
	const stateSource = createMemo(() => {
		const client = analysis();
		return client
			? fromExternalStore(
					(listener) => client.subscribe(listener),
					() => client.getState(),
				)
			: () => idleState;
	});
	const state = () => stateSource()();
	const fills = createMemo(() => state().fills);
	const unrouted = createMemo(() => state().ratsnest?.length);
	const lines = createMemo(() =>
		ratsnestShown() ? state().ratsnest : undefined,
	);
	const analysisError = createMemo(() => state().error);
	const ratsnest = createMemo(() => ratsnestShapes(lines() ?? []));
	const highlight = createMemo(() => {
		const selected = selection();
		if (!enabled() || selected.size !== 1) return undefined;
		const [id] = selected;
		const shape = committed().find((item) => item.id === id);
		return shape && "net" in shape ? shape.net : undefined;
	});
	const highlighted = createMemo(() => {
		const ids = new Set<number>();
		const net = highlight();
		if (!net) return ids;
		for (const item of copperItems(committed(), netlist())) {
			if (item.net !== net) continue;
			if (item.kind === "pad" && item.pad) {
				const footprint = item.pad.footprint;
				const local = footprint.children.findIndex(
					(child) => `${footprint.id}:${child.id}` === item.pad?.key,
				);
				if (local >= 0) ids.add(footprintItemId(footprint.id, local));
			} else ids.add(item.shapeId);
		}
		return ids;
	});
	const buildDisplay = createMemo(() => {
		const hiddenLayers = hidden();
		const activeLayer = active();
		const focusedLayer = focused();
		const lines = ratsnest();
		const highlightedIds = highlighted();
		return (
			shapes: EditorShape[],
			selected: ReadonlySet<number>,
			measure: Parameters<typeof buildBoardStaticDisplay>[4],
		) => {
			const flat = boardDisplay(shapes, selected, hiddenLayers, activeLayer);
			return buildBoardStaticDisplay(
				flat.shapes,
				flat.selected,
				highlightedIds,
				lines,
				measure,
				focusedLayer,
			);
		};
	});
	const zoneScene = createZoneScene();
	onSettled(() => () => zoneScene.dispose());
	const theme = useSchematicTheme();
	const layerColors = createMemo(() => {
		const current = theme();
		const layer = focused();
		return layer
			? (Object.fromEntries(
					allLayers.map((item) => [
						item,
						item === layer
							? current.appearance[item]
							: unfocusedLayerColor(current.appearance[item], current),
					]),
				) as Record<FootprintLayer, string>)
			: current.appearance;
	});
	const layout = createMemo(() => {
		const flat = boardDisplay(
			boardLayerView(committed(), hidden(), active()),
			new Set(),
			hidden(),
			active(),
		).shapes;
		const first = new Map<FootprintLayer, number>();
		flat.forEach((shape, index) => {
			for (const layer of shapeLayers(shape))
				if (!first.has(layer)) first.set(layer, index + 1);
		});
		return {
			layerOrder: (layer: FootprintLayer) => (first.get(layer) ?? 1) - 0.5,
			displayCount: flat.length + ratsnest().length,
		};
	});
	const clearance = createMemo(() => rules()?.clearance ?? 0);
	const buildPreview = createMemo(() => {
		const { displayCount } = layout();
		const margin = clearance();
		return (
			previews: EditorShape[],
			shapeCount: number,
			measure: Parameters<typeof buildBoardPreviewDisplay>[2],
		) =>
			buildBoardPreviewDisplay(
				previews,
				Math.max(shapeCount, displayCount),
				measure,
				margin,
			);
	});
	const updateZones = createMemo(() => {
		const on = enabled();
		const zoneFills = fills();
		const colors = layerColors();
		const { layerOrder } = layout();
		const hiddenLayers = hidden();
		const dimmed = focused() !== undefined;
		return (root: Object3D) => {
			if (!on) return;
			zoneScene.update(
				root,
				zoneFills,
				colors,
				layerOrder,
				hiddenLayers,
				dimmed,
			);
		};
	});
	const copperLayers = createMemo(() =>
		boardCopperLayers(rules()?.copperLayers ?? 2),
	);
	const lastCopper = createMemo<CopperLayer>((previous) => {
		const layer = active();
		if (isCopperLayer(layer)) return layer;
		return previous && copperLayers().includes(previous) ? previous : "F.Cu";
	});
	const copperLayer = createMemo(() =>
		copperLayers().includes(lastCopper()) ? lastCopper() : "F.Cu",
	);
	const gestures = createMemo((): BoardGestures | undefined => {
		const currentRules = rules();
		if (!enabled() || !currentRules) return undefined;
		const currentSession = session();
		const currentNetlist = netlist();
		const hiddenLayers = hidden();
		const layer = copperLayer();
		const visibleItems = () =>
			copperItems(currentSession.shapes(), currentNetlist).filter((item) =>
				item.layers.some((itemLayer) => !hiddenLayers.has(itemLayer)),
			);
		return {
			items: visibleItems,
			rules: currentRules,
			copperLayer: layer,
			copperLayers: copperLayers(),
			setCopperLayer: (next) => options().setActive(next),
			netAt: (point: Point) =>
				copperAt(visibleItems(), point, layer, 0.05)?.net ??
				[...currentNetlist.nets.values()].find((net) =>
					/^(gnd|vss)$/i.test(net.name),
				)?.id,
		};
	});

	const [syncReport, setSyncReport] = createSignal<BoardSyncReport | null>(
		null,
	);
	async function synchronize() {
		if (!board()) return null;
		session().select(new Set());
		const report = await synchronizeBoardStore(store(), context());
		setSyncReport(report);
		return report;
	}

	function flipSelection() {
		const current = session();
		const selected = current.getState().selection;
		const flipped = current
			.shapes()
			.filter(isBoardFootprint)
			.filter((shape) => selected.has(shape.id) && !shape.locked)
			.map(flipBoardFootprint);
		if (flipped.length) current.replace(flipped, "Flip footprint");
		return flipped.length > 0;
	}

	async function runChecks(
		unit: LengthUnit,
		shapes: readonly EditorShape[] = store().getSnapshot().shapes,
	) {
		return (await analysis()?.check(shapes, unit)) ?? [];
	}
	async function fabricate(name: string, shapes: readonly EditorShape[]) {
		const client = analysis();
		if (!client) throw new Error("The board is not open.");
		return client.fabricate(name, shapes);
	}
	async function drawingFills(shapes: readonly EditorShape[]) {
		const client = analysis();
		if (!client) throw new Error("The board is not open.");
		return client.drawingFills(shapes);
	}

	return {
		get rules() {
			return rules();
		},
		get netlist() {
			return netlist();
		},
		get fills() {
			return fills();
		},
		fabricate,
		drawingFills,
		get buildDisplay() {
			return buildDisplay();
		},
		get buildPreview() {
			return buildPreview();
		},
		get updateZones() {
			return updateZones();
		},
		get gestures() {
			return gestures();
		},
		synchronize,
		get syncReport() {
			return syncReport();
		},
		clearSyncReport: () => setSyncReport(null),
		flipSelection,
		runChecks,
		get unrouted() {
			return unrouted();
		},
		get analysisError() {
			return analysisError();
		},
	};
}

const idleState: BoardAnalysisState = {
	fills: [],
	ratsnest: undefined,
	error: "",
};
