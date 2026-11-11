import type { Circuit } from "@ecad/drawing-core/circuit/model.ts";
import {
	type ErcDiagnostic,
	type ErcSubject,
	runErc,
} from "@ecad/drawing-core/erc/engine.ts";
import { defaultErcRules } from "@ecad/drawing-core/erc/rules.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import {
	ChevronLeft,
	ChevronRight,
	OctagonAlert,
	TriangleAlert,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
	FloatingPanel,
	type FloatingPanelPosition,
} from "#/components/viewer/FloatingPanel.tsx";
import { panelIconButtonClassName } from "#/components/viewer/viewControlStyles.ts";

const pageSize = 50;

const severityStyle = {
	error: { label: "Error", className: "text-danger" },
	warning: { label: "Warning", className: "text-warning" },
} as const;

const iconButton = panelIconButtonClassName;

const count = (value: number, noun: string) =>
	`${value.toLocaleString()} ${noun}${value === 1 ? "" : "s"}`;

/** Electrical rules check for the circuit editor. */
export function CircuitErcPanel({
	circuit,
	onSelect,
	...props
}: {
	circuit: Circuit;
	onClose(): void;
	onSelect(subject: ErcSubject): void;
}) {
	// Layout-only changes, such as moving or collapsing a component, keep the
	// results current.
	const revision = useMemo(() => JSON.stringify(circuit), [circuit]);
	return (
		<ErcPanel
			{...props}
			source="circuit"
			revision={revision}
			ruleCount={defaultErcRules.length}
			check={() => runErc(circuit, defaultErcRules)}
			onSelect={(item) => {
				const target = item.target ?? item.subjects[0];
				if (target) onSelect(target);
			}}
		/>
	);
}

/**
 * Runs electrical rules on demand and lists the findings. Results go stale
 * when `revision` changes.
 */
export function ErcPanel({
	source,
	revision,
	ruleCount,
	check,
	position = "top-left",
	onClose,
	onSelect,
}: {
	source: "circuit" | "schematic";
	/** Where the panel floats. Both editors open it under the document bar. */
	position?: FloatingPanelPosition;
	revision: unknown;
	ruleCount: number;
	check(): ErcDiagnostic[];
	onClose(): void;
	onSelect(diagnostic: ErcDiagnostic): void;
}) {
	const [result, setResult] = useState<{
		revision: unknown;
		diagnostics: ErcDiagnostic[];
	} | null>(null);
	const [error, setError] = useState("");
	const [page, setPage] = useState(0);
	const [activeId, setActiveId] = useState<string | null>(null);
	const stale = result !== null && result.revision !== revision;
	const diagnostics = result?.diagnostics ?? [];
	const errors = diagnostics.filter((item) => item.severity === "error").length;
	const warnings = diagnostics.length - errors;
	const current = result !== null && !stale && !error;
	const first = page * pageSize;
	const last = Math.min(first + pageSize, diagnostics.length);
	return (
		<FloatingPanel
			label="Electrical rules check"
			as="section"
			position={position}
			raised
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === "Escape") onClose();
			}}
		>
			<header className="flex shrink-0 items-center justify-between gap-3 border-b border-line-subtle py-1.5 pr-1.5 pl-3">
				<h2 className="m-0 text-sm font-semibold">Electrical rules check</h2>
				<button
					type="button"
					className={iconButton}
					aria-label="Close electrical rules check"
					title="Close"
					onClick={onClose}
				>
					<X size={16} aria-hidden="true" />
				</button>
			</header>
			<div className="flex min-h-0 flex-col p-3">
				<div className="flex items-center gap-3">
					<output
						className={`flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-[1.125rem] ${error ? "text-danger" : "text-fg-muted"}`}
					>
						{error ? (
							`Check failed: ${error}`
						) : !result ? (
							`Run checks on this ${source}'s pin types and connections.`
						) : stale ? (
							`${source === "circuit" ? "Circuit" : "Schematic"} changed. Run ERC again to update results.`
						) : (
							<>
								<span
									className={`inline-flex items-center gap-1 font-medium tabular-nums ${errors ? severityStyle.error.className : ""}`}
								>
									<OctagonAlert size={14} aria-hidden="true" />
									{count(errors, "error")}
								</span>
								<span className="sr-only">, </span>
								<span
									className={`inline-flex items-center gap-1 font-medium tabular-nums ${warnings ? severityStyle.warning.className : ""}`}
								>
									<TriangleAlert size={14} aria-hidden="true" />
									{count(warnings, "warning")}
								</span>
							</>
						)}
					</output>
					<button
						type="button"
						className="ui-button shrink-0"
						data-variant="primary"
						onClick={() => {
							try {
								setResult({ revision, diagnostics: check() });
								setError("");
								setPage(0);
								setActiveId(null);
							} catch (cause) {
								setError(errorMessage(cause, "ERC failed."));
							}
						}}
					>
						Run ERC
					</button>
				</div>
				{current && diagnostics.length === 0 && (
					<p className="m-0 mt-2 text-xs leading-[1.125rem] text-fg">
						No electrical issues found by the {ruleCount} enabled rules.
					</p>
				)}
				{current && diagnostics.length > 0 && (
					<>
						<ol
							className="-mx-1.5 mt-2 mb-0 min-h-0 list-none overflow-y-auto overscroll-contain p-0"
							aria-label="ERC results"
						>
							{diagnostics.slice(first, last).map((item) => {
								const severity = severityStyle[item.severity];
								return (
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
											<span className={`font-medium ${severity.className}`}>
												{severity.label}
											</span>
											<span className="text-fg-faint"> · {item.ruleId}</span>
											<span className="mt-0.5 block break-words text-xs text-fg">
												{item.message}
											</span>
										</button>
									</li>
								);
							})}
						</ol>
						{diagnostics.length > pageSize && (
							<footer className="mt-2 flex items-center justify-between gap-2 border-t border-line-subtle pt-2">
								<button
									type="button"
									className={iconButton}
									aria-label="Previous"
									title="Previous page"
									disabled={page === 0}
									onClick={() => setPage(page - 1)}
								>
									<ChevronLeft size={16} aria-hidden="true" />
								</button>
								<span className="text-2xs text-fg-muted tabular-nums">
									{(first + 1).toLocaleString()}–{last.toLocaleString()} of{" "}
									{diagnostics.length.toLocaleString()}
								</span>
								<button
									type="button"
									className={iconButton}
									aria-label="Next"
									title="Next page"
									disabled={last >= diagnostics.length}
									onClick={() => setPage(page + 1)}
								>
									<ChevronRight size={16} aria-hidden="true" />
								</button>
							</footer>
						)}
					</>
				)}
			</div>
		</FloatingPanel>
	);
}
