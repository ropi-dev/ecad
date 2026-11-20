import type { DrcFinding } from "@ecad/drawing-core/board/drc.ts";
import {
	type BoardRules,
	boardRulesSchema,
} from "@ecad/drawing-core/board/rules.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import {
	fromMils,
	type LengthUnit,
	toMils,
} from "@ecad/drawing-core/drawing/units.ts";
import { copperLayerCounts } from "@ecad/drawing-core/footprint/layers.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	Match,
	Switch,
	untrack,
} from "solid-js";
import { boardCopperLayersInUse } from "#/board/format.ts";
import { OctagonAlert, TriangleAlert, X } from "#/components/ui/icons.tsx";
import { FloatingPanel } from "#/components/viewer/FloatingPanel.tsx";
import { panelIconButtonClassName } from "#/components/viewer/viewControlStyles.ts";

const kindLabels: Record<DrcFinding["kind"], string> = {
	short: "Short",
	clearance: "Clearance",
	unconnected: "Unrouted",
	edge: "Board edge",
	outline: "Outline",
	footprint: "Footprint",
	net: "Net",
};

const pageSize = 100;

function PanelHeader(props: { title: string; onClose(): void }) {
	return (
		<header class="flex shrink-0 items-center justify-between gap-3 border-b border-line-subtle py-1.5 pr-1.5 pl-3">
			<h2 class="m-0 text-sm font-semibold">{props.title}</h2>
			<button
				type="button"
				class={panelIconButtonClassName}
				aria-label={`Close ${props.title.toLowerCase()}`}
				title="Close"
				onClick={() => props.onClose()}
			>
				<X size={16} aria-hidden="true" />
			</button>
		</header>
	);
}

/**
 * Runs the design rules on demand. Results go stale when `revision` changes,
 * and run again in the new unit when `unit` changes.
 */
export function BoardChecksPanel(props: {
	revision: unknown;
	unit: LengthUnit;
	run(unit: LengthUnit): Promise<DrcFinding[]>;
	onClose(): void;
	onSelect(finding: DrcFinding): void;
}) {
	const [result, setResult] = createSignal<{
		revision: unknown;
		unit: LengthUnit;
		findings: DrcFinding[];
	} | null>(null);
	const [error, setError] = createSignal("");
	const [running, setRunning] = createSignal(false);
	let latestRun = 0;
	const [activeId, setActiveId] = createSignal<string | null>(null);
	const stale = () => {
		const current = result();
		return current !== null && current.revision !== props.revision;
	};
	const findings = () => result()?.findings ?? [];
	const unrouted = createMemo(
		() => findings().filter((item) => item.kind === "unconnected").length,
	);
	const problems = () => findings().length - unrouted();
	const current = () => result() !== null && !stale() && !error();
	function start() {
		const started = ++latestRun;
		const revision = props.revision;
		const unit = props.unit;
		setRunning(true);
		props
			.run(unit)
			.then(
				(findings) => {
					if (started !== latestRun) return;
					setResult({ revision, unit, findings });
					setError("");
					setActiveId(null);
				},
				(cause: unknown) => {
					if (started === latestRun)
						setError(errorMessage(cause, "DRC failed."));
				},
			)
			.finally(() => {
				if (started === latestRun) setRunning(false);
			});
	}
	const rerun = createMemo(() => current() && result()?.unit !== props.unit);
	createEffect(rerun, (value) => {
		if (value) untrack(start);
	});
	return (
		<FloatingPanel
			label="Design rules check"
			as="section"
			position="top-right"
			raised
			onKeyDown={(event: KeyboardEvent) => {
				event.stopPropagation();
				if (event.key === "Escape") props.onClose();
			}}
		>
			<PanelHeader title="Design rules check" onClose={() => props.onClose()} />
			<div class="flex min-h-0 flex-col p-3">
				<div class="flex items-center gap-3">
					<output
						class={[
							"flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-[1.125rem]",
							error() ? "text-danger" : "text-fg-muted",
						]}
					>
						<Switch>
							<Match when={error()}>{`Check failed: ${error()}`}</Match>
							<Match when={!result()}>
								Check clearances, the board edge and unrouted connections.
							</Match>
							<Match when={stale()}>
								The board changed. Run DRC again to update results.
							</Match>
							<Match when={true}>
								<span
									class={[
										"inline-flex items-center gap-1 font-medium tabular-nums",
										{ "text-danger": problems() > 0 },
									]}
								>
									<OctagonAlert size={14} aria-hidden="true" />
									{problems() === 1
										? "1 violation"
										: `${problems()} violations`}
								</span>
								<span
									class={[
										"inline-flex items-center gap-1 font-medium tabular-nums",
										{ "text-warning": unrouted() > 0 },
									]}
								>
									<TriangleAlert size={14} aria-hidden="true" />
									{unrouted()} unrouted
								</span>
							</Match>
						</Switch>
					</output>
					<button
						type="button"
						class="ui-button shrink-0"
						data-variant="primary"
						aria-busy={running() ? "true" : "false"}
						onClick={start}
					>
						Run DRC
					</button>
				</div>
				{current() && findings().length === 0 && (
					<p class="m-0 mt-2 text-xs leading-[1.125rem] text-fg">
						No violations, and every connection is routed.
					</p>
				)}
				{current() && findings().length > 0 && (
					<ol
						class="-mx-1.5 mt-2 mb-0 min-h-0 list-none overflow-y-auto overscroll-contain p-0"
						aria-label="DRC results"
					>
						<For each={findings().slice(0, pageSize)}>
							{(item) => (
								<li class="mb-0.5 last:mb-0">
									<button
										type="button"
										class="ui-toggle w-full cursor-pointer rounded-md border px-1.5 py-1.5 text-left text-2xs leading-4 [--toggle-on-fg:var(--color-fg-muted)] [--toggle-on-line:var(--color-accent-line)] hover:[--toggle-fg:var(--color-fg-muted)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
										aria-current={activeId() === item.id ? "true" : undefined}
										onClick={() => {
											setActiveId(item.id);
											props.onSelect(item);
										}}
									>
										<span
											class={[
												"font-medium",
												item.kind === "unconnected"
													? "text-warning"
													: "text-danger",
											]}
										>
											{kindLabels[item.kind]}
										</span>
										<span class="mt-0.5 block break-words text-xs text-fg">
											{item.message}
										</span>
									</button>
								</li>
							)}
						</For>
						{findings().length > pageSize && (
							<li class="px-1.5 pt-1 text-2xs text-fg-muted">
								{findings().length - pageSize} more not shown.
							</li>
						)}
					</ol>
				)}
			</div>
		</FloatingPanel>
	);
}

const ruleFields: readonly {
	key: Exclude<keyof BoardRules, "copperLayers">;
	label: string;
}[] = [
	{ key: "clearance", label: "Clearance" },
	{ key: "trackWidth", label: "Track width" },
	{ key: "viaDiameter", label: "Via diameter" },
	{ key: "viaDrill", label: "Via drill" },
	{ key: "edgeClearance", label: "Edge clearance" },
	{ key: "solderMaskMargin", label: "Mask margin" },
	{ key: "thermalGap", label: "Thermal gap" },
	{ key: "thermalSpokeWidth", label: "Spoke width" },
];

/** The board's design rules. New tracks and vias use their sizes. */
export function BoardSetupPanel(props: {
	rules: BoardRules;
	shapes: readonly EditorShape[];
	unit: LengthUnit;
	onChange(rules: BoardRules): void;
	onClose(): void;
}) {
	const fewest = createMemo(() => boardCopperLayersInUse(props.shapes));
	return (
		<FloatingPanel
			label="Board setup"
			as="section"
			position="top-right"
			raised
			narrow
			onKeyDown={(event: KeyboardEvent) => {
				event.stopPropagation();
				if (event.key === "Escape") props.onClose();
			}}
		>
			<PanelHeader title="Board setup" onClose={() => props.onClose()} />
			<div class="grid grid-cols-[1fr_6rem] items-center gap-x-2 gap-y-1.5 p-3 text-xs">
				<label class="contents">
					<span class="text-fg-muted">Copper layers</span>
					<select
						class="ui-select w-full tabular-nums"
						value={props.rules.copperLayers}
						onChange={(event) => {
							const count = Number(event.currentTarget.value);
							if (count >= fewest())
								props.onChange({ ...props.rules, copperLayers: count });
							else event.currentTarget.value = String(props.rules.copperLayers);
						}}
					>
						<For each={copperLayerCounts}>
							{(count) => (
								<option value={count} disabled={count < fewest()}>
									{count}
								</option>
							)}
						</For>
					</select>
				</label>
				{fewest() > 2 && (
					<p class="col-span-2 m-0 text-2xs text-fg-faint">
						Fewer than {fewest()} layers would drop items on inner copper.
					</p>
				)}
				<For each={ruleFields}>
					{(field) => (
						<RuleField
							label={field.label}
							value={props.rules[field.key]}
							unit={props.unit}
							onCommit={(value) => {
								if (!boardRulesSchema.shape[field.key].safeParse(value).success)
									return false;
								const next = { ...props.rules, [field.key]: value };
								if (next.viaDrill >= next.viaDiameter) return false;
								props.onChange(next);
								return true;
							}}
						/>
					)}
				</For>
			</div>
		</FloatingPanel>
	);
}

function RuleField(props: {
	label: string;
	value: number;
	unit: LengthUnit;
	onCommit(value: number): boolean;
}) {
	const shown = createMemo(() =>
		String(props.unit === "mil" ? toMils(props.value) : props.value),
	);
	const [text, setText] = createSignal(() => shown());
	const commit = () => {
		const draft = text();
		const next = Number(draft);
		if (draft.trim() === shown()) return;
		if (
			!draft.trim() ||
			!Number.isFinite(next) ||
			!props.onCommit(props.unit === "mil" ? fromMils(next) : next)
		)
			setText(shown());
	};
	return (
		<label class="contents">
			<span class="text-fg-muted">{props.label}</span>
			<span class="flex items-center gap-1">
				<input
					class="ui-input w-full tabular-nums"
					inputmode="decimal"
					value={text()}
					onInput={(event) => setText(event.currentTarget.value)}
					onBlur={commit}
					onKeyDown={(event) => {
						if (event.key === "Enter") commit();
					}}
				/>
				<span class="text-fg-faint">{props.unit}</span>
			</span>
		</label>
	);
}

/** How many connections still need a track, above the toolbar. */
export function BoardStatus(props: {
	unrouted: number | undefined;
	failed: boolean;
	layer: string;
}) {
	return (
		<output
			class="ui-panel pointer-events-none absolute right-[var(--chrome-right)] bottom-[calc(var(--chrome-dock)+0.5rem)] z-2 bg-raised px-2.5 py-1 text-2xs text-fg-muted tabular-nums"
			aria-live="polite"
		>
			{props.failed
				? "Connections not checked"
				: props.unrouted === undefined
					? "Checking connections"
					: props.unrouted === 0
						? "All connections routed"
						: props.unrouted === 1
							? "1 unrouted connection"
							: `${props.unrouted} unrouted connections`}
			<span class="text-fg-faint"> · {props.layer}</span>
		</output>
	);
}
