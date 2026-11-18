import type { DrcFinding } from "@ecad/drawing-core/board/drc.ts";
import {
	type BoardRules,
	boardRulesSchema,
} from "@ecad/drawing-core/board/rules.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { copperLayerCounts } from "@ecad/drawing-core/footprint/layers.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { OctagonAlert, TriangleAlert, X } from "lucide-react";
import { useRef, useState } from "react";
import { boardCopperLayersInUse } from "#/board/format.ts";
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

function PanelHeader({ title, onClose }: { title: string; onClose(): void }) {
	return (
		<header className="flex shrink-0 items-center justify-between gap-3 border-b border-line-subtle py-1.5 pr-1.5 pl-3">
			<h2 className="m-0 text-sm font-semibold">{title}</h2>
			<button
				type="button"
				className={panelIconButtonClassName}
				aria-label={`Close ${title.toLowerCase()}`}
				title="Close"
				onClick={onClose}
			>
				<X size={16} aria-hidden="true" />
			</button>
		</header>
	);
}

/** Runs the design rules on demand. Results go stale when `revision` changes. */
export function BoardChecksPanel({
	revision,
	run,
	onClose,
	onSelect,
}: {
	revision: unknown;
	run(): Promise<DrcFinding[]>;
	onClose(): void;
	onSelect(finding: DrcFinding): void;
}) {
	const [result, setResult] = useState<{
		revision: unknown;
		findings: DrcFinding[];
	} | null>(null);
	const [error, setError] = useState("");
	const [running, setRunning] = useState(false);
	const latestRun = useRef(0);
	const [activeId, setActiveId] = useState<string | null>(null);
	const stale = result !== null && result.revision !== revision;
	const findings = result?.findings ?? [];
	const unrouted = findings.filter(
		(item) => item.kind === "unconnected",
	).length;
	const problems = findings.length - unrouted;
	const current = result !== null && !stale && !error;
	return (
		<FloatingPanel
			label="Design rules check"
			as="section"
			position="top-right"
			raised
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === "Escape") onClose();
			}}
		>
			<PanelHeader title="Design rules check" onClose={onClose} />
			<div className="flex min-h-0 flex-col p-3">
				<div className="flex items-center gap-3">
					<output
						className={`flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-[1.125rem] ${error ? "text-danger" : "text-fg-muted"}`}
					>
						{error ? (
							`Check failed: ${error}`
						) : !result ? (
							"Check clearances, the board edge and unrouted connections."
						) : stale ? (
							"The board changed. Run DRC again to update results."
						) : (
							<>
								<span
									className={`inline-flex items-center gap-1 font-medium tabular-nums ${problems ? "text-danger" : ""}`}
								>
									<OctagonAlert size={14} aria-hidden="true" />
									{problems === 1 ? "1 violation" : `${problems} violations`}
								</span>
								<span
									className={`inline-flex items-center gap-1 font-medium tabular-nums ${unrouted ? "text-warning" : ""}`}
								>
									<TriangleAlert size={14} aria-hidden="true" />
									{unrouted} unrouted
								</span>
							</>
						)}
					</output>
					<button
						type="button"
						className="ui-button shrink-0"
						data-variant="primary"
						aria-busy={running}
						onClick={() => {
							const started = ++latestRun.current;
							setRunning(true);
							run()
								.then(
									(findings) => {
										if (started !== latestRun.current) return;
										setResult({ revision, findings });
										setError("");
										setActiveId(null);
									},
									(cause: unknown) => {
										if (started === latestRun.current)
											setError(errorMessage(cause, "DRC failed."));
									},
								)
								.finally(() => {
									if (started === latestRun.current) setRunning(false);
								});
						}}
					>
						Run DRC
					</button>
				</div>
				{current && findings.length === 0 && (
					<p className="m-0 mt-2 text-xs leading-[1.125rem] text-fg">
						No violations, and every connection is routed.
					</p>
				)}
				{current && findings.length > 0 && (
					<ol
						className="-mx-1.5 mt-2 mb-0 min-h-0 list-none overflow-y-auto overscroll-contain p-0"
						aria-label="DRC results"
					>
						{findings.slice(0, pageSize).map((item) => (
							<li key={item.id} className="mb-0.5 last:mb-0">
								<button
									type="button"
									className="ui-toggle w-full cursor-pointer rounded-md border px-1.5 py-1.5 text-left text-2xs leading-4 [--toggle-on-fg:var(--color-fg-muted)] [--toggle-on-line:var(--color-accent-line)] hover:[--toggle-fg:var(--color-fg-muted)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
									aria-current={activeId === item.id ? "true" : undefined}
									onClick={() => {
										setActiveId(item.id);
										onSelect(item);
									}}
								>
									<span
										className={`font-medium ${item.kind === "unconnected" ? "text-warning" : "text-danger"}`}
									>
										{kindLabels[item.kind]}
									</span>
									<span className="mt-0.5 block break-words text-xs text-fg">
										{item.message}
									</span>
								</button>
							</li>
						))}
						{findings.length > pageSize && (
							<li className="px-1.5 pt-1 text-2xs text-fg-muted">
								{findings.length - pageSize} more not shown.
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
export function BoardSetupPanel({
	rules,
	shapes,
	onChange,
	onClose,
}: {
	rules: BoardRules;
	shapes: readonly EditorShape[];
	onChange(rules: BoardRules): void;
	onClose(): void;
}) {
	const fewest = boardCopperLayersInUse(shapes);
	return (
		<FloatingPanel
			label="Board setup"
			as="section"
			position="top-right"
			raised
			narrow
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === "Escape") onClose();
			}}
		>
			<PanelHeader title="Board setup" onClose={onClose} />
			<div className="grid grid-cols-[1fr_6rem] items-center gap-x-2 gap-y-1.5 p-3 text-xs">
				<label className="contents">
					<span className="text-fg-muted">Copper layers</span>
					<select
						className="ui-select w-full tabular-nums"
						value={rules.copperLayers}
						onChange={(event) => {
							const count = Number(event.currentTarget.value);
							if (count >= fewest) onChange({ ...rules, copperLayers: count });
						}}
					>
						{copperLayerCounts.map((count) => (
							<option key={count} value={count} disabled={count < fewest}>
								{count}
							</option>
						))}
					</select>
				</label>
				{fewest > 2 && (
					<p className="col-span-2 m-0 text-2xs text-fg-faint">
						Fewer than {fewest} layers would drop items on inner copper.
					</p>
				)}
				{ruleFields.map(({ key, label }) => (
					<RuleField
						key={`${key}:${rules[key]}`}
						label={label}
						value={rules[key]}
						onCommit={(value) => {
							if (!boardRulesSchema.shape[key].safeParse(value).success)
								return false;
							const next = { ...rules, [key]: value };
							if (next.viaDrill >= next.viaDiameter) return false;
							onChange(next);
							return true;
						}}
					/>
				))}
			</div>
		</FloatingPanel>
	);
}

function RuleField({
	label,
	value,
	onCommit,
}: {
	label: string;
	value: number;
	onCommit(value: number): boolean;
}) {
	const [text, setText] = useState(String(value));
	const commit = () => {
		const next = Number(text);
		if (!text.trim() || !Number.isFinite(next) || !onCommit(next))
			setText(String(value));
	};
	return (
		<label className="contents">
			<span className="text-fg-muted">{label}</span>
			<span className="flex items-center gap-1">
				<input
					className="ui-input w-full tabular-nums"
					inputMode="decimal"
					value={text}
					onChange={(event) => setText(event.target.value)}
					onBlur={commit}
					onKeyDown={(event) => {
						if (event.key === "Enter") commit();
					}}
				/>
				<span className="text-fg-faint">mm</span>
			</span>
		</label>
	);
}

/** How many connections still need a track, above the toolbar. */
export function BoardStatus({
	unrouted,
	failed,
	layer,
}: {
	unrouted: number | undefined;
	failed: boolean;
	layer: string;
}) {
	return (
		<output
			className="ui-panel pointer-events-none absolute right-[var(--chrome-right)] bottom-[calc(var(--chrome-dock)+0.5rem)] z-2 bg-raised px-2.5 py-1 text-2xs text-fg-muted tabular-nums"
			aria-live="polite"
		>
			{failed
				? "Connections not checked"
				: unrouted === undefined
					? "Checking connections"
					: unrouted === 0
						? "All connections routed"
						: unrouted === 1
							? "1 unrouted connection"
							: `${unrouted} unrouted connections`}
			<span className="text-fg-faint"> · {layer}</span>
		</output>
	);
}
