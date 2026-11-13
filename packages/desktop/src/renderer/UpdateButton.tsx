import { TooltipButton } from "@ecad/core/components/viewer/TooltipButton.tsx";
import { CircleArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import type { DesktopUpdateState, DesktopUpdatesBridge } from "#/bridge.ts";

const buildVersion =
	/^\d+\.\d+\.\d+\+git(\d{4})(\d{2})(\d{2})\d{6}\.([0-9a-f]+)$/;
const shownChanges = 8;

export function describeVersion(version: string) {
	const match = buildVersion.exec(version);
	if (!match) return `version ${version}`;
	const [, year, month, day, commit] = match;
	const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
	const label = date.toLocaleDateString(undefined, {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});
	return `the ${label} build (${commit})`;
}

function summary(state: DesktopUpdateState): {
	label: string;
	title?: string;
	detail?: string;
} {
	switch (state.status) {
		case "idle":
			if (state.checkError)
				return {
					label: "Check for updates",
					detail: `The last check failed: ${state.checkError}`,
				};
			return state.latest
				? {
						label: "Check for updates",
						title: "ECAD is up to date",
						detail: "Click to check again.",
					}
				: { label: "Check for updates" };
		case "checking":
			return { label: "Checking for updates" };
		case "available":
			return {
				label: "Install update",
				detail: `Installs ${describeVersion(state.latest.version)}. Installing asks for your administrator password.`,
			};
		case "downloading":
			return {
				label: "Downloading update",
				title: `Downloading update ${Math.floor(state.progress * 100)}%`,
			};
		case "installing":
			return {
				label: "Installing update",
				detail: "Enter your password in the system prompt to continue.",
			};
		case "installed":
			return {
				label: "Restart to update",
				detail: `Restarts ECAD into ${describeVersion(state.latest.version)}. Some views may fail to open until then.`,
			};
		case "failed":
			return {
				label: "Retry update",
				title: "Update failed. Click to try again.",
				detail: state.message,
			};
	}
}

const tones: Partial<
	Record<DesktopUpdateState["status"], { icon: string; dot: string }>
> = {
	failed: { icon: "text-danger", dot: "bg-danger" },
	available: { icon: "text-accent", dot: "bg-accent" },
	installed: { icon: "text-accent", dot: "bg-accent" },
};

function Changelog({ state }: { state: DesktopUpdateState }) {
	const latest = state.latest;
	if (!latest?.changes.length) return null;
	const hidden = latest.changes.length - shownChanges;
	return (
		<span className="mt-2 block border-t border-line-subtle pt-2 font-normal">
			<span className="block text-fg-muted">Changes since your version</span>
			<ul className="m-0 mt-1 list-disc pl-4">
				{latest.changes.slice(0, shownChanges).map((change, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: two changes can share a title
					<li key={index}>{change}</li>
				))}
			</ul>
			{hidden > 0 && (
				<span className="mt-1 block text-fg-muted">and {hidden} more</span>
			)}
		</span>
	);
}

export function UpdateButton({ updates }: { updates: DesktopUpdatesBridge }) {
	const [state, setState] = useState<DesktopUpdateState | null>(null);
	useEffect(() => {
		let current = true;
		const unsubscribe = updates.onChanged(setState);
		void updates.getState().then((initial) => {
			if (current) setState((state) => state ?? initial);
		});
		return () => {
			current = false;
			unsubscribe();
		};
	}, [updates]);
	if (!state) return null;
	const { label, title = label, detail } = summary(state);
	const busy =
		state.status === "checking" ||
		state.status === "downloading" ||
		state.status === "installing";
	const tone = tones[state.status];
	return (
		<TooltipButton
			aria-label={label}
			aria-busy={busy}
			tooltip={
				<span className="block">
					<span className="block">{title}</span>
					{detail && (
						<span className="mt-1 block font-normal text-fg-muted">
							{detail}
						</span>
					)}
					<Changelog state={state} />
				</span>
			}
			side="right"
			data-shortcut-scope="none"
			className="ui-button relative size-9"
			data-variant="ghost"
			data-icon
			onClick={() => {
				if (busy) return;
				if (state.status === "idle") void updates.check();
				else if (state.status === "installed") void updates.restart();
				else void updates.install();
			}}
		>
			<CircleArrowUp
				size={18}
				aria-hidden="true"
				className={`${busy ? "animate-pulse" : ""} ${tone?.icon ?? ""}`}
			/>
			{tone && (
				<span
					aria-hidden="true"
					className={`absolute top-1 right-1 size-1.5 rounded-full ${tone.dot}`}
				/>
			)}
		</TooltipButton>
	);
}
