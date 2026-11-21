import type { CircuitFile } from "@ecad/drawing-core/circuit/model.ts";
import { type Accessor, createEffect, createMemo, untrack } from "solid-js";
import type { ViewSelection } from "#/circuit/selection-sync.ts";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";

type View = ViewSelection["view"];
type Of<V extends View> = Extract<ViewSelection, { view: V }>;
type Selection<V extends View> = Of<V>["selection"];

interface ViewSelectionSyncOptions<V extends View> {
	enabled?: boolean;
	visible: boolean;
	active: boolean;
	circuitId: string | undefined;
	view: V;
	store: Of<V>["store"];
	storeVersion?: unknown;
	equal(a: Selection<V>, b: Selection<V>): boolean;
	receive(
		source: ViewSelection,
		circuitFile: CircuitFile | undefined,
	): Selection<V>;
	apply(selection: Selection<V>): Selection<V>;
}

export function useViewSelectionSync<V extends View>(
	options: Accessor<ViewSelectionSyncOptions<V>>,
	selection: Accessor<Selection<V>>,
) {
	const project = useProjectSelection(
		({ selectionSync, publishViewSelection, circuitForSelection }) => ({
			selectionSync,
			publishViewSelection,
			circuitForSelection,
		}),
	);
	let lastReceivedRevision = 0;
	let lastStoreVersion: unknown;
	let applied: {
		revision: number;
		selection: Selection<V>;
		source: ViewSelection;
	} | null = null;
	let lastSeen: { store: unknown; selection: Selection<V> } | null = null;
	let expecting: Selection<V> | null = null;

	const receiving = createMemo(
		() => {
			const current = options();
			return {
				enabled: current.enabled ?? true,
				visible: current.visible,
				circuitId: current.circuitId,
				storeVersion: current.storeVersion,
				sync: project()?.selectionSync ?? null,
				project: project(),
			};
		},
		{
			equals: (a, b) =>
				a.enabled === b.enabled &&
				a.visible === b.visible &&
				a.circuitId === b.circuitId &&
				a.storeVersion === b.storeVersion &&
				a.sync === b.sync &&
				a.project?.circuitForSelection === b.project?.circuitForSelection,
		},
	);
	createEffect(receiving, (current) => {
		const { enabled, visible, circuitId, sync, storeVersion } = current;
		const versionChanged = storeVersion !== lastStoreVersion;
		lastStoreVersion = storeVersion;
		const circuitForSelection = current.project?.circuitForSelection;
		if (
			!enabled ||
			!visible ||
			!circuitId ||
			!sync ||
			!circuitForSelection ||
			sync.circuitId !== circuitId
		)
			return;
		const { view, store, equal, receive } = untrack(options);
		const apply = (next: Selection<V>) => {
			const before = untrack(selection);
			const result = untrack(options).apply(next);
			expecting = equal(before, result) ? null : result;
			return result;
		};
		if (sync.revision !== lastReceivedRevision) {
			lastReceivedRevision = sync.revision;
			const { source } = sync;
			if (source.view === view && source.store === store) {
				const own = source.selection as Selection<V>;
				const result = equal(untrack(selection), own)
					? untrack(selection)
					: apply(own);
				applied = null;
				lastSeen = { store, selection: result };
				return;
			}
			const result = apply(receive(source, circuitForSelection(circuitId)));
			applied = { revision: sync.revision, selection: result, source };
			lastSeen = { store, selection: result };
			return;
		}
		if (
			!versionChanged ||
			!applied ||
			applied.revision !== sync.revision ||
			!equal(applied.selection, untrack(selection))
		)
			return;
		const next = receive(applied.source, circuitForSelection(circuitId));
		if (equal(next, applied.selection)) return;
		const result = apply(next);
		applied = { ...applied, selection: result };
		lastSeen = { store, selection: result };
	});

	const publishing = createMemo(
		() => {
			const current = options();
			return {
				enabled: current.enabled ?? true,
				active: current.active,
				circuitId: current.circuitId,
				view: current.view,
				store: current.store,
				equal: current.equal,
				selection: selection(),
				publish: project()?.publishViewSelection,
			};
		},
		{
			equals: (a, b) =>
				a.enabled === b.enabled &&
				a.active === b.active &&
				a.circuitId === b.circuitId &&
				a.view === b.view &&
				a.store === b.store &&
				a.equal === b.equal &&
				a.selection === b.selection &&
				a.publish === b.publish,
		},
	);
	createEffect(publishing, (current) => {
		const { enabled, active, circuitId, view, store, equal, publish } = current;
		if (!enabled || !circuitId || !publish) return;
		const now = current.selection;
		if (expecting) {
			const caughtUp = equal(expecting, now);
			expecting = null;
			if (!caughtUp) return;
		}
		const seen = lastSeen;
		lastSeen = { store, selection: now };
		if (!active) return;
		if (applied) {
			if (equal(applied.selection, now)) return;
			applied = null;
		} else if (seen && seen.store === store && equal(seen.selection, now))
			return;
		publish(circuitId, { view, store, selection: now } as ViewSelection);
	});
}
