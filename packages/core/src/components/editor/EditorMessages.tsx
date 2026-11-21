import {
	type Accessor,
	createMemo,
	createSignal,
	For,
	flush,
	onCleanup,
	Show,
} from "solid-js";
import {
	dismissEditorIssues,
	retainDismissedIssues,
	visibleEditorMessages,
} from "#/components/editor/editorMessages.ts";
import type { EditorSession } from "#/components/editor/editorSession.ts";
import { TriangleAlert, X } from "#/components/ui/icons.tsx";
import { panelIconButtonClassName } from "#/components/viewer/viewControlStyles.ts";

type ButtonSlot = { button: HTMLButtonElement | null };

function messageButtonRef(slot: ButtonSlot) {
	return () => {
		let button: HTMLButtonElement | undefined;
		let canvas: HTMLCanvasElement | null | undefined;
		let focused = false;
		const track = (event: FocusEvent) => {
			if (event.type === "focusin") {
				focused = true;
				canvas = button
					?.closest("[data-editor-pane], main")
					?.querySelector("canvas");
			} else if (button?.isConnected && event.relatedTarget) focused = false;
		};
		onCleanup(() => {
			if (!button) return;
			const released = button;
			if (slot.button === released) slot.button = null;
			released.removeEventListener("focusin", track);
			released.removeEventListener("focusout", track);
			if (released.isConnected) {
				focused = document.activeElement === released;
				canvas = released
					.closest("[data-editor-pane], main")
					?.querySelector("canvas");
			}
			if (!focused) return;
			queueMicrotask(() => {
				if (
					!released.isConnected &&
					(!document.activeElement || document.activeElement === document.body)
				)
					canvas?.focus({ preventScroll: true });
			});
		});
		return (element: HTMLButtonElement) => {
			button = element;
			slot.button = element;
			element.addEventListener("focusin", track);
			element.addEventListener("focusout", track);
		};
	};
}

/**
 * Tracks which editor issues the user dismissed and where focus goes when the
 * message banner or the "Show issues" button appears or disappears.
 */
export function useEditorMessages(
	options: Accessor<{
		session: EditorSession;
		commandError: string;
		issues: string[];
		loading: boolean;
	}>,
) {
	const issues = createMemo(() => options().issues);
	const loading = createMemo(() => options().loading);
	const [dismissedIssues, setDismissedIssues] = createSignal<
		ReadonlySet<string>
	>((previous) => {
		const dismissed = previous ?? new Set<string>();
		return loading() ? dismissed : retainDismissedIssues(dismissed, issues());
	});
	const hiddenIssues = createMemo(() =>
		issues().filter((issue) => dismissedIssues().has(issue)),
	);
	const messages = createMemo(() =>
		visibleEditorMessages(options().commandError, issues(), dismissedIssues()),
	);
	const dismissButton: ButtonSlot = { button: null };
	const issuesButton: ButtonSlot = { button: null };
	return {
		get messages() {
			return messages();
		},
		get hiddenIssues() {
			return hiddenIssues();
		},
		dismissButtonRef: messageButtonRef(dismissButton),
		issuesButtonRef: messageButtonRef(issuesButton),
		dismiss(canvas: HTMLCanvasElement | null | undefined) {
			const current = options();
			current.session.setError("");
			setDismissedIssues((dismissed) =>
				dismissEditorIssues(dismissed, current.issues),
			);
			if (!current.issues.length) {
				canvas?.focus({ preventScroll: true });
				return;
			}
			flush();
			issuesButton.button?.focus({ preventScroll: true });
		},
		showIssues() {
			setDismissedIssues(new Set<string>());
			flush();
			dismissButton.button?.focus({ preventScroll: true });
		},
	};
}

export function EditorMessages(
	props: ReturnType<typeof useEditorMessages> & {
		/** A panel is open in the top-left corner; show the messages beside it. */
		besidePanel?: boolean;
		/** A status pill sits at bottom-right; stack narrow-pane bottom messages above it. */
		aboveStatus?: boolean;
	},
) {
	return (
		<Show when={props.messages.length > 0 || props.hiddenIssues.length > 0}>
			<div
				data-beside-panel={props.besidePanel ? "true" : "false"}
				data-above-status={props.aboveStatus ? "true" : undefined}
				class="pointer-events-none absolute top-[calc(var(--chrome-top)+var(--chrome-bar))] left-[var(--chrome-gap)] z-4 flex max-w-[min(560px,calc(100%-2*var(--chrome-gap)))] flex-col items-start gap-2 *:pointer-events-auto min-[760px]:@max-[761px]:data-[beside-panel=true]:top-auto min-[760px]:@max-[761px]:data-[beside-panel=true]:bottom-[calc(var(--chrome-dock)+env(safe-area-inset-bottom))] min-[760px]:@max-[761px]:data-[beside-panel=true]:z-6 min-[760px]:@max-[761px]:data-[beside-panel=true]:max-w-[min(560px,calc(100%-var(--chrome-gap)-var(--chrome-right)))] min-[760px]:@max-[761px]:data-[beside-panel=true]:data-[above-status=true]:bottom-[calc(var(--chrome-dock)+2.75rem+env(safe-area-inset-bottom))] @[761px]:data-[beside-panel=true]:left-[calc(var(--chrome-gap)+18.5rem)] @[761px]:data-[beside-panel=true]:max-w-[min(560px,calc(100%-2*var(--chrome-gap)-18.5rem))]"
			>
				{props.messages.length > 0 && (
					<div class="ui-notice flex max-w-full items-start gap-2 py-1.5 pr-1.5 pl-2.5">
						<TriangleAlert
							size={15}
							aria-hidden="true"
							class="mt-1.5 shrink-0 text-warning"
						/>
						<div
							role="alert"
							class="max-h-25 min-w-0 flex-1 overflow-auto py-1 break-words"
						>
							<For each={props.messages}>
								{(message) => <p class="m-0">{message}</p>}
							</For>
						</div>
						<button
							ref={props.dismissButtonRef()}
							type="button"
							aria-label="Dismiss editor messages"
							title="Dismiss"
							class={panelIconButtonClassName}
							onClick={(event) =>
								props.dismiss(
									event.currentTarget
										.closest("[data-editor-pane], main")
										?.querySelector("canvas"),
								)
							}
						>
							<X size={15} aria-hidden="true" />
						</button>
					</div>
				)}
				{props.hiddenIssues.length > 0 && (
					<button
						ref={props.issuesButtonRef()}
						type="button"
						class="ui-notice inline-flex h-8 cursor-pointer items-center gap-1.5 px-2.5 font-medium hover:border-warning"
						onClick={() => props.showIssues()}
					>
						<TriangleAlert size={14} aria-hidden="true" class="text-warning" />
						Show {props.hiddenIssues.length}{" "}
						{props.hiddenIssues.length === 1 ? "issue" : "issues"}
					</button>
				)}
			</div>
		</Show>
	);
}
