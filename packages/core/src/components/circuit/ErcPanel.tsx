import type { Circuit } from "@ecad/drawing-core/circuit/model.ts";
import {
	type ErcDiagnostic,
	type ErcOptions,
	type ErcSubject,
	runErc,
} from "@ecad/drawing-core/erc/engine.ts";
import { defaultErcRules } from "@ecad/drawing-core/erc/rules.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import {
	ChevronLeft,
	ChevronRight,
	OctagonAlert,
	TriangleAlert,
	X,
} from "#/components/ui/icons.tsx";
import {
	FloatingPanel,
	type FloatingPanelPosition,
} from "#/components/viewer/FloatingPanel.tsx";
import { panelIconButtonClassName } from "#/components/viewer/viewControlStyles.ts";
import { useErcSeverity } from "#/settings/useErcSeverity.ts";

const pageSize = 50;

const severityStyle = {
	error: { label: "Error", className: "text-danger" },
	warning: { label: "Warning", className: "text-warning" },
} as const;

const iconButton = panelIconButtonClassName;

const count = (value: number, noun: string) =>
	`${value.toLocaleString()} ${noun}${value === 1 ? "" : "s"}`;

/** Electrical rules check for the circuit editor. */
export function CircuitErcPanel(props: {
	circuit: Circuit;
	onClose(): void;
	onSelect(subject: ErcSubject): void;
}) {
	// Layout-only changes, such as moving or collapsing a component, keep the
	// results current.
	const revision = createMemo(() => JSON.stringify(props.circuit));
	return (
		<ErcPanel
			onClose={() => props.onClose()}
			source="circuit"
			revision={revision()}
			ruleCount={defaultErcRules.length}
			check={(severity) => runErc(props.circuit, defaultErcRules, { severity })}
			onSelect={(item) => {
				const target = item.target ?? item.subjects[0];
				if (target) props.onSelect(target);
			}}
		/>
	);
}

/**
 * Runs electrical rules on demand and lists the findings. Results go stale
 * when `revision` changes.
 */
export function ErcPanel(props: {
	source: "circuit" | "schematic";
	/** Where the panel floats. Both editors open it under the document bar. */
	position?: FloatingPanelPosition;
	revision: unknown;
	ruleCount: number;
	check(severity: ErcOptions["severity"]): ErcDiagnostic[];
	onClose(): void;
	onSelect(diagnostic: ErcDiagnostic): void;
}) {
	const severity = useErcSeverity();
	const [result, setResult] = createSignal<{
		revision: unknown;
		severity: ErcOptions["severity"];
		diagnostics: ErcDiagnostic[];
	} | null>(null);
	const [error, setError] = createSignal("");
	const [page, setPage] = createSignal(0);
	const [activeId, setActiveId] = createSignal<string | null>(null);
	const changedRules = () => {
		const current = result();
		return current !== null && current.severity !== severity();
	};
	const stale = () => {
		const current = result();
		return (
			current !== null &&
			(current.revision !== props.revision || changedRules())
		);
	};
	const diagnostics = () => result()?.diagnostics ?? [];
	const errors = createMemo(
		() => diagnostics().filter((item) => item.severity === "error").length,
	);
	const warnings = () => diagnostics().length - errors();
	const current = () => result() !== null && !stale() && !error();
	const first = () => page() * pageSize;
	const last = () => Math.min(first() + pageSize, diagnostics().length);
	return (
		<FloatingPanel
			label="Electrical rules check"
			as="section"
			position={props.position ?? "top-left"}
			raised
			onKeyDown={(event: KeyboardEvent) => {
				event.stopPropagation();
				if (event.key === "Escape") props.onClose();
			}}
		>
			<header class="flex shrink-0 items-center justify-between gap-3 border-b border-line-subtle py-1.5 pr-1.5 pl-3">
				<h2 class="m-0 text-sm font-semibold">Electrical rules check</h2>
				<button
					type="button"
					class={iconButton}
					aria-label="Close electrical rules check"
					title="Close"
					onClick={() => props.onClose()}
				>
					<X size={16} aria-hidden="true" />
				</button>
			</header>
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
								{`Run checks on this ${props.source}'s pin types and connections.`}
							</Match>
							<Match when={stale()}>
								{`${result()?.revision === props.revision && changedRules() ? "ERC settings" : props.source === "circuit" ? "Circuit" : "Schematic"} changed. Run ERC again to update results.`}
							</Match>
							<Match when={true}>
								<span
									class={[
										"inline-flex items-center gap-1 font-medium tabular-nums",
										{ [severityStyle.error.className]: errors() > 0 },
									]}
								>
									<OctagonAlert size={14} aria-hidden="true" />
									{count(errors(), "error")}
								</span>
								<span class="sr-only">, </span>
								<span
									class={[
										"inline-flex items-center gap-1 font-medium tabular-nums",
										{ [severityStyle.warning.className]: warnings() > 0 },
									]}
								>
									<TriangleAlert size={14} aria-hidden="true" />
									{count(warnings(), "warning")}
								</span>
							</Match>
						</Switch>
					</output>
					<button
						type="button"
						class="ui-button shrink-0"
						data-variant="primary"
						onClick={() => {
							const chosen = severity();
							try {
								setResult({
									revision: props.revision,
									severity: chosen,
									diagnostics: props.check(chosen),
								});
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
				{current() && diagnostics().length === 0 && (
					<p class="m-0 mt-2 text-xs leading-[1.125rem] text-fg">
						No electrical issues found by the {props.ruleCount} enabled rules.
					</p>
				)}
				{current() && diagnostics().length > 0 && (
					<>
						<ol
							class="-mx-1.5 mt-2 mb-0 min-h-0 list-none overflow-y-auto overscroll-contain p-0"
							aria-label="ERC results"
						>
							<For each={diagnostics().slice(first(), last())}>
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
													severityStyle[item.severity].className,
												]}
											>
												{severityStyle[item.severity].label}
											</span>
											<span class="text-fg-faint"> · {item.ruleId}</span>
											<span class="mt-0.5 block break-words text-xs text-fg">
												{item.message}
											</span>
										</button>
									</li>
								)}
							</For>
						</ol>
						<Show when={diagnostics().length > pageSize}>
							<footer class="mt-2 flex items-center justify-between gap-2 border-t border-line-subtle pt-2">
								<button
									type="button"
									class={iconButton}
									aria-label="Previous"
									title="Previous page"
									disabled={page() === 0}
									onClick={() => setPage(page() - 1)}
								>
									<ChevronLeft size={16} aria-hidden="true" />
								</button>
								<span class="text-2xs text-fg-muted tabular-nums">
									{(first() + 1).toLocaleString()}–{last().toLocaleString()} of{" "}
									{diagnostics().length.toLocaleString()}
								</span>
								<button
									type="button"
									class={iconButton}
									aria-label="Next"
									title="Next page"
									disabled={last() >= diagnostics().length}
									onClick={() => setPage(page() + 1)}
								>
									<ChevronRight size={16} aria-hidden="true" />
								</button>
							</footer>
						</Show>
					</>
				)}
			</div>
		</FloatingPanel>
	);
}
