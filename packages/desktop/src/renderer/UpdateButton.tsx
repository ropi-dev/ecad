import {
	CircleArrowUp,
	LoaderCircle,
	RefreshCw,
} from "@ecad/core/components/ui/icons.tsx";
import { TooltipButton } from "@ecad/core/components/viewer/TooltipButton.tsx";
import {
	createMemo,
	createSignal,
	For,
	Match,
	onSettled,
	Show,
	Switch,
} from "solid-js";
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

function DownloadProgress(props: { progress: number }) {
	const done = () => Math.min(Math.max(props.progress, 0), 1);
	return (
		<svg
			width={18}
			height={18}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width={2}
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			data-testid="update-download-progress"
		>
			<circle cx={12} cy={12} r={10} class="opacity-25" />
			<circle
				cx={12}
				cy={12}
				r={10}
				stroke="currentColor"
				pathLength={100}
				stroke-dasharray="100"
				stroke-dashoffset={String(100 * (1 - done()))}
				transform="rotate(-90 12 12)"
				class={[
					"text-accent transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none",
					{ "opacity-0": done() === 0 },
				]}
			/>
			<path d="M12 8v8" />
			<path d="m8 12 4 4 4-4" />
		</svg>
	);
}

function Changelog(props: { state: DesktopUpdateState }) {
	const changes = () => props.state.latest?.changes ?? [];
	const hidden = () => changes().length - shownChanges;
	return (
		<Show when={changes().length}>
			<span class="mt-2 block border-t border-line-subtle pt-2 font-normal">
				<span class="block text-fg-muted">Changes since your version</span>
				<ul class="m-0 mt-1 list-disc pl-4">
					{/* Two changes can share a title. */}
					<For each={changes().slice(0, shownChanges)} keyed={false}>
						{(change) => <li>{change()}</li>}
					</For>
				</ul>
				{hidden() > 0 && (
					<span class="mt-1 block text-fg-muted">and {hidden()} more</span>
				)}
			</span>
		</Show>
	);
}

export function UpdateButton(props: { updates: DesktopUpdatesBridge }) {
	const [state, setState] = createSignal<DesktopUpdateState | null>(null);
	onSettled(() => {
		const updates = props.updates;
		let current = true;
		const unsubscribe = updates.onChanged((next) => setState(next));
		void updates.getState().then((initial) => {
			if (current) setState((state) => state ?? initial);
		});
		return () => {
			current = false;
			unsubscribe();
		};
	});
	return (
		<Show when={state()}>
			{(state) => {
				const described = createMemo(() => summary(state()));
				const busy = () =>
					state().status === "checking" ||
					state().status === "downloading" ||
					state().status === "installing";
				const tone = () => tones[state().status];
				const downloading = () => {
					const current = state();
					return current.status === "downloading" ? current : undefined;
				};
				return (
					<TooltipButton
						aria-label={described().label}
						aria-busy={busy() ? "true" : "false"}
						tooltip={
							<span class="block">
								<span class="block">
									{described().title ?? described().label}
								</span>
								<Show when={described().detail}>
									<span class="mt-1 block font-normal text-fg-muted">
										{described().detail}
									</span>
								</Show>
								<Changelog state={state()} />
							</span>
						}
						side="right"
						data-shortcut-scope="none"
						class="ui-button relative size-9"
						data-variant="ghost"
						data-icon
						onClick={() => {
							if (busy()) return;
							const status = state().status;
							if (status === "idle") void props.updates.check();
							else if (status === "installed") void props.updates.restart();
							else void props.updates.install();
						}}
					>
						<Switch
							fallback={
								<CircleArrowUp
									size={18}
									aria-hidden="true"
									class={tone()?.icon}
								/>
							}
						>
							<Match when={state().status === "checking"}>
								<RefreshCw
									size={18}
									aria-hidden="true"
									class="animate-spin motion-reduce:animate-none"
								/>
							</Match>
							<Match when={downloading()}>
								{(downloading) => (
									<DownloadProgress progress={downloading().progress} />
								)}
							</Match>
							<Match when={busy()}>
								<LoaderCircle
									size={18}
									aria-hidden="true"
									class="animate-spin motion-reduce:animate-none"
								/>
							</Match>
						</Switch>
						<Show when={tone()}>
							{(tone) => (
								<span
									aria-hidden="true"
									class={[
										"absolute top-1 right-1 size-1.5 rounded-full",
										tone().dot,
									]}
								/>
							)}
						</Show>
					</TooltipButton>
				);
			}}
		</Show>
	);
}
