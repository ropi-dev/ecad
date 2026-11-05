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

const pageSize = 50;

const severityStyle = {
	error: { label: "Error", className: "text-red-300" },
	warning: { label: "Warning", className: "text-amber-200" },
} as const;

const iconButton =
	"grid size-7 shrink-0 cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent p-0 text-[#98a4b6] hover:bg-[#ffffff10] hover:text-[#f0f3f8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b77e] disabled:pointer-events-none disabled:opacity-35";

const count = (value: number, noun: string) =>
	`${value.toLocaleString()} ${noun}${value === 1 ? "" : "s"}`;

/** Electrical rules check for the circuit editor. */
export function CircuitErcPanel({
	circuit,
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
			check={() => runErc(circuit, defaultErcRules)}
		/>
	);
}

/**
 * Runs the default electrical rules on demand and lists the findings. Results
 * go stale when `revision` changes.
 */
export function ErcPanel({
	source,
	revision,
	check,
	position = "top-right",
	onClose,
	onSelect,
}: {
	source: "circuit" | "schematic";
	/** Where the panel floats, clear of the editor's other panels. */
	position?: FloatingPanelPosition;
	revision: unknown;
	check(): ErcDiagnostic[];
	onClose(): void;
	onSelect(subject: ErcSubject): void;
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
			<div className="flex min-h-0 flex-col p-2.5">
				<header className="flex items-center justify-between gap-3">
					<h2 className="m-0 text-[11px] font-semibold text-[#98a4b6]">
						Electrical rules check
					</h2>
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
				<button
					type="button"
					className="mt-2 w-full cursor-pointer rounded border border-[#e8b77e60] bg-[#e8b77e15] px-3 py-2 text-[12px] text-[#e8b77e] hover:bg-[#e8b77e25] focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
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
				<output
					className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-[1.5] ${error ? "text-red-300" : "text-[#9ba7b8]"}`}
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
				{current && diagnostics.length === 0 && (
					<p className="mt-2 text-[12px] leading-[1.5] text-[#c7d0dc]">
						No electrical issues found by the {defaultErcRules.length} enabled
						rules.
					</p>
				)}
				{current && diagnostics.length > 0 && (
					<>
						<ol
							className="m-0 mt-2 min-h-0 list-none overflow-y-auto overscroll-contain p-0"
							aria-label="ERC results"
						>
							{diagnostics.slice(first, last).map((item) => {
								const severity = severityStyle[item.severity];
								return (
									<li key={item.id} className="mb-[3px] last:mb-0">
										<button
											type="button"
											className="w-full cursor-pointer rounded-md border border-transparent bg-transparent px-2 py-1.5 text-left text-[11px] leading-[1.4] text-[#c7d0dc] transition-[background,border-color] duration-150 hover:bg-[#ffffff08] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#e8b77e] aria-[current=true]:border-[#b88f6170] aria-[current=true]:bg-[#e8b77e0c]"
											aria-current={activeId === item.id ? "true" : undefined}
											onClick={() => {
												const target = item.target ?? item.subjects[0];
												setActiveId(item.id);
												if (target) onSelect(target);
											}}
										>
											<span className={`font-medium ${severity.className}`}>
												{severity.label}
											</span>
											<span className="text-[#8892a2]"> · {item.ruleId}</span>
											<span className="mt-0.5 block break-words text-[12px] text-[#e1e6ee]">
												{item.message}
											</span>
										</button>
									</li>
								);
							})}
						</ol>
						{diagnostics.length > pageSize && (
							<footer className="mt-2 flex items-center justify-between gap-2 border-t border-[#ffffff0a] pt-2">
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
								<span className="text-[11px] text-[#98a4b6] tabular-nums">
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
