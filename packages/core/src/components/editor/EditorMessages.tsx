import { TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	dismissEditorIssues,
	retainDismissedIssues,
	visibleEditorMessages,
} from "#/components/editor/editorMessages.ts";
import type { EditorSession } from "#/components/editor/editorSession.ts";

function messageButtonRef(target: { current: HTMLButtonElement | null }) {
	return (button: HTMLButtonElement) => {
		target.current = button;
		return () => {
			if (target.current === button) target.current = null;
			const owner = button.ownerDocument;
			if (owner.activeElement !== button) return;
			const canvas = button.closest("main")?.querySelector("canvas");
			queueMicrotask(() => {
				if (
					!button.isConnected &&
					(!owner.activeElement || owner.activeElement === owner.body)
				)
					canvas?.focus({ preventScroll: true });
			});
		};
	};
}

/**
 * Tracks which editor issues the user dismissed and where focus goes when the
 * message banner or the "Show issues" button appears or disappears.
 */
export function useEditorMessages({
	session,
	commandError,
	issues,
	loading,
}: {
	session: EditorSession;
	commandError: string;
	issues: string[];
	loading: boolean;
}) {
	const [dismissedIssues, setDismissedIssues] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	if (!loading) {
		const retained = retainDismissedIssues(dismissedIssues, issues);
		if (retained !== dismissedIssues) setDismissedIssues(retained);
	}
	const hiddenIssues = issues.filter((issue) => dismissedIssues.has(issue));
	const messages = visibleEditorMessages(commandError, issues, dismissedIssues);
	const dismissMessages = () => {
		session.setError("");
		setDismissedIssues((dismissed) => dismissEditorIssues(dismissed, issues));
	};
	const dismissButton = useRef<HTMLButtonElement>(null);
	const issuesButton = useRef<HTMLButtonElement>(null);
	const [dismissButtonRef] = useState(() => messageButtonRef(dismissButton));
	const [issuesButtonRef] = useState(() => messageButtonRef(issuesButton));
	const pendingFocus = useRef<"issues" | "messages" | null>(null);
	useEffect(() => {
		const target = pendingFocus.current;
		if (!target) return;
		pendingFocus.current = null;
		(target === "issues" ? issuesButton : dismissButton).current?.focus({
			preventScroll: true,
		});
	});
	return {
		messages,
		hiddenIssues,
		dismissButtonRef,
		issuesButtonRef,
		dismiss(canvas: HTMLCanvasElement | null | undefined) {
			dismissMessages();
			if (issues.length) pendingFocus.current = "issues";
			else canvas?.focus({ preventScroll: true });
		},
		showIssues() {
			pendingFocus.current = "messages";
			setDismissedIssues(new Set());
		},
	};
}

export function EditorMessages({
	messages,
	hiddenIssues,
	dismissButtonRef,
	issuesButtonRef,
	dismiss,
	showIssues,
}: ReturnType<typeof useEditorMessages>) {
	if (messages.length === 0 && hiddenIssues.length === 0) return null;
	return (
		<div className="pointer-events-none absolute top-22 left-10 z-3 flex max-w-[min(560px,calc(100%-56px))] flex-col items-start gap-2 *:pointer-events-auto">
			{messages.length > 0 && (
				<div className="flex max-w-full items-start gap-1 rounded-lg border border-[#72543a] bg-[#392e25f5] py-1.5 pr-1.5 pl-3 text-[13px] text-[#edc49a]">
					<div
						role="alert"
						className="max-h-25 min-w-0 flex-1 overflow-auto py-1 break-words"
					>
						{messages.map((message) => (
							<p key={message} className="m-0">
								{message}
							</p>
						))}
					</div>
					<button
						ref={dismissButtonRef}
						type="button"
						aria-label="Dismiss editor messages"
						title="Dismiss"
						className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-[#edc49a] hover:bg-[#edc49a1f] focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
						onClick={(event) =>
							dismiss(
								event.currentTarget.closest("main")?.querySelector("canvas"),
							)
						}
					>
						<X size={15} aria-hidden="true" />
					</button>
				</div>
			)}
			{hiddenIssues.length > 0 && (
				<button
					ref={issuesButtonRef}
					type="button"
					className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#72543a] bg-[#392e25f5] px-2.5 py-1.5 text-[12px] text-[#edc49a] hover:bg-[#4a3b2ff5] focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
					onClick={showIssues}
				>
					<TriangleAlert size={14} aria-hidden="true" />
					Show {hiddenIssues.length}{" "}
					{hiddenIssues.length === 1 ? "issue" : "issues"}
				</button>
			)}
		</div>
	);
}
