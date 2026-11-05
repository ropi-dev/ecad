import type { Circuit } from "@ecad/drawing-core/circuit/model.ts";
import {
	type ErcDiagnostic,
	type ErcSubject,
	runErc,
} from "@ecad/drawing-core/erc/engine.ts";
import { defaultErcRules } from "@ecad/drawing-core/erc/rules.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { useMemo, useState } from "react";

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
	className = "top-14 right-3 max-h-[calc(100%-9rem)]",
	onClose,
	onSelect,
}: {
	source: "circuit" | "schematic";
	/** Position classes for the floating panel. */
	className?: string;
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
	const stale = result !== null && result.revision !== revision;
	const diagnostics = result?.diagnostics ?? [];
	const errors = diagnostics.filter((item) => item.severity === "error").length;
	const button =
		"rounded border border-white/20 px-2 py-1 hover:bg-white/10 disabled:opacity-40";
	return (
		<section
			aria-label="Electrical rules check"
			className={`absolute z-20 flex ${className} w-96 max-w-[calc(100%-1.5rem)] flex-col gap-3 rounded-lg border border-white/20 bg-slate-900 p-4 text-sm text-slate-100 shadow-xl`}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === "Escape") onClose();
			}}
		>
			<div className="flex items-center justify-between gap-2">
				<h2 className="font-semibold">Electrical rules check</h2>
				<button
					type="button"
					className={button}
					aria-label="Close electrical rules check"
					onClick={onClose}
				>
					Close
				</button>
			</div>
			<button
				type="button"
				className={button}
				onClick={() => {
					try {
						setResult({ revision, diagnostics: check() });
						setError("");
						setPage(0);
					} catch (cause) {
						setError(errorMessage(cause, "ERC failed."));
					}
				}}
			>
				Run ERC
			</button>
			<output>
				{error
					? `Check failed: ${error}`
					: !result
						? `Run checks on this ${source}'s pin types and connections.`
						: stale
							? `${source === "circuit" ? "Circuit" : "Schematic"} changed. Run ERC again to update results.`
							: `${errors} errors, ${diagnostics.length - errors} warnings`}
			</output>
			{result && !stale && !error && diagnostics.length === 0 && (
				<p>
					No electrical issues found by the {defaultErcRules.length} enabled
					rules.
				</p>
			)}
			{result && !stale && !error && diagnostics.length > 0 && (
				<>
					<ol
						className="min-h-0 space-y-2 overflow-y-auto"
						aria-label="ERC results"
					>
						{diagnostics.slice(page * 50, (page + 1) * 50).map((item) => (
							<li key={item.id}>
								<button
									type="button"
									className="w-full rounded border border-white/10 p-2 text-left hover:bg-white/10"
									onClick={() => {
										const target = item.target ?? item.subjects[0];
										if (target) onSelect(target);
									}}
								>
									<span
										className={
											item.severity === "error"
												? "text-red-300"
												: "text-amber-200"
										}
									>
										{item.severity === "error" ? "Error" : "Warning"}
									</span>
									<span className="ml-2 text-xs text-slate-400">
										{item.ruleId}
									</span>
									<span className="mt-1 block">{item.message}</span>
								</button>
							</li>
						))}
					</ol>
					{diagnostics.length > 50 && (
						<div className="flex items-center justify-between gap-2">
							<button
								type="button"
								className={button}
								disabled={page === 0}
								onClick={() => setPage(page - 1)}
							>
								Previous
							</button>
							<span>
								{page * 50 + 1} to{" "}
								{Math.min((page + 1) * 50, diagnostics.length)} of{" "}
								{diagnostics.length}
							</span>
							<button
								type="button"
								className={button}
								disabled={(page + 1) * 50 >= diagnostics.length}
								onClick={() => setPage(page + 1)}
							>
								Next
							</button>
						</div>
					)}
				</>
			)}
		</section>
	);
}
