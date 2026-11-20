import { schematicErcRules } from "@ecad/drawing-core/erc/schematic-rules.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import type { JSX } from "@solidjs/web";
import {
	createMemo,
	createSignal,
	createUniqueId,
	For,
	Loading,
	lazy,
	Match,
	Show,
	Switch,
	untrack,
} from "solid-js";
import { keepChecked } from "#/components/ui/checkbox.ts";
import { AppDialog } from "#/components/ui/Dialog.tsx";
import {
	Activity,
	CircleArrowUp,
	CircuitBoard,
	Library,
	type LucideIcon,
	Monitor,
} from "#/components/ui/icons.tsx";
import { automaticAntialiasing } from "#/components/viewer/antialiasing.ts";
import { setDebugStats } from "#/performance/useDebugStats.ts";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import {
	type AntialiasingMode,
	type ErcSeverityLevel,
	type ErcSeverityOverrides,
	ercSeverityLevels,
	type ReleaseChannel,
	type ThemeMode,
	withErcSeverity,
} from "#/settings/schema.ts";
import {
	updateAppSettings,
	useAppSettings,
	useSettingsStatus,
} from "#/settings/store.ts";
import { useTheme } from "#/settings/theme.ts";
import {
	setTelemetryEnabled,
	useTelemetryEnabled,
} from "#/telemetry/consent.ts";
import { telemetryAvailable } from "#/telemetry/telemetry.ts";

const SymbolLibrarySettings = lazy(
	() => import("#/projects/SymbolLibrarySettings.tsx"),
	{ export: "SymbolLibrarySettings" },
);

export type SettingsSection =
	| "display"
	| "erc"
	| "libraries"
	| "updates"
	| "usage";

const sections: {
	id: SettingsSection;
	label: string;
	icon: LucideIcon;
}[] = [
	{ id: "display", label: "Display", icon: Monitor },
	{ id: "erc", label: "Electrical rules", icon: CircuitBoard },
	{ id: "libraries", label: "Symbol libraries", icon: Library },
	{ id: "updates", label: "Updates", icon: CircleArrowUp },
	{ id: "usage", label: "Usage data", icon: Activity },
];

const levelLabels: Record<ErcSeverityLevel, string> = {
	error: "Error",
	warning: "Warning",
	off: "Off",
};

export function SettingsDialog(props: {
	open: boolean;
	onOpenChange(open: boolean): void;
	section?: SettingsSection;
}) {
	const status = useSettingsStatus();
	const shown = createMemo(() =>
		sections.filter(
			({ id }) =>
				(id !== "updates" || status().updates) &&
				(id !== "usage" || telemetryAvailable),
		),
	);
	const requested = createMemo(() => {
		const section = props.section ?? "display";
		return shown().some(({ id }) => id === section) ? section : "display";
	});
	const opening = createMemo(
		() => ({ open: props.open, section: requested() }),
		{ equals: (previous, next) => previous.open === next.open },
	);
	const [active, setActive] = createSignal<SettingsSection>((previous) => {
		const { open, section } = opening();
		return open || previous === undefined ? section : previous;
	});
	const tabsId = createUniqueId();
	return (
		<AppDialog
			open={props.open}
			onOpenChange={(open) => props.onOpenChange(open)}
			size="xl"
			focusDialog
			title="Settings"
			footer={
				<>
					<SettingsError />
					<button
						type="button"
						class="ui-button"
						data-variant="primary"
						data-size="md"
						onClick={() => props.onOpenChange(false)}
					>
						Done
					</button>
				</>
			}
		>
			<div class="flex min-h-0 flex-[1_1_34rem] max-[640px]:flex-col">
				<div
					role="tablist"
					aria-label="Settings sections"
					aria-orientation="vertical"
					class="flex w-48 shrink-0 flex-col gap-0.5 border-r border-line-subtle p-2 max-[640px]:w-auto max-[640px]:flex-row max-[640px]:overflow-x-auto max-[640px]:border-r-0 max-[640px]:border-b"
					onKeyDown={(event) => {
						const list = shown();
						const index = list.findIndex(({ id }) => id === active());
						const step =
							event.key === "ArrowDown" || event.key === "ArrowRight"
								? 1
								: event.key === "ArrowUp" || event.key === "ArrowLeft"
									? -1
									: 0;
						const next =
							event.key === "Home"
								? 0
								: event.key === "End"
									? list.length - 1
									: step
										? (index + step + list.length) % list.length
										: -1;
						const section = list[next];
						if (!section) return;
						event.preventDefault();
						setActive(section.id);
						event.currentTarget
							.querySelectorAll<HTMLElement>('[role="tab"]')
							[next]?.focus();
					}}
				>
					<For each={shown()}>
						{(section) => {
							const Icon = section.icon;
							const selected = () => active() === section.id;
							return (
								<button
									type="button"
									role="tab"
									id={`${tabsId}-${section.id}-tab`}
									aria-selected={selected() ? "true" : "false"}
									aria-controls={`${tabsId}-${section.id}-panel`}
									tabindex={selected() ? 0 : -1}
									data-active={selected() ? "true" : "false"}
									class="ui-button ui-toggle justify-start whitespace-nowrap"
									onClick={() => setActive(section.id)}
								>
									<Icon size={15} aria-hidden="true" />
									{section.label}
								</button>
							);
						}}
					</For>
				</div>
				<div class="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4">
					<div
						role="tabpanel"
						id={`${tabsId}-${active()}-panel`}
						aria-labelledby={`${tabsId}-${active()}-tab`}
						class="outline-none"
					>
						<Switch>
							<Match when={active() === "display"}>
								<DisplaySettings />
							</Match>
							<Match when={active() === "erc"}>
								<ErcSettings />
							</Match>
							<Match when={active() === "libraries"}>
								<Loading
									fallback={
										<output class="text-sm text-fg-muted">
											Loading libraries...
										</output>
									}
								>
									<SymbolLibrarySettings />
								</Loading>
							</Match>
							<Match when={active() === "updates" && status().updates}>
								<UpdateSettings />
							</Match>
							<Match when={active() === "usage" && telemetryAvailable}>
								<UsageDataSettings />
							</Match>
						</Switch>
					</div>
				</div>
			</div>
		</AppDialog>
	);
}

function SettingsError() {
	const status = useSettingsStatus();
	return (
		<p
			role={status().error ? "alert" : undefined}
			class="m-0 mr-auto min-w-0 self-center text-xs break-words text-danger"
		>
			{status().error}
		</p>
	);
}

function SettingRow(props: {
	label: string;
	description?: JSX.Element;
	children: (id: string) => JSX.Element;
}) {
	const id = createUniqueId();
	return (
		<div class="flex items-center justify-between gap-4 py-2 max-[420px]:flex-col max-[420px]:items-stretch">
			<div class="min-w-0">
				<label for={id} class="block text-sm font-medium text-fg">
					{props.label}
				</label>
				<Show when={props.description}>
					<p class="m-0 mt-0.5 text-xs text-fg-muted">{props.description}</p>
				</Show>
			</div>
			{props.children(id)}
		</div>
	);
}

function DisplaySettings() {
	const settings = useAppSettings();
	const automatic = automaticAntialiasing();
	const theme = useTheme();
	const followsSystem = () => (settings().theme ?? "system") === "system";
	return (
		<section aria-label="Display" class="flex flex-col">
			<h3 class="ui-section-label m-0 mb-1">Display</h3>
			<SettingRow
				label="Theme"
				description="Colours of the interface and the canvases. Exported drawings keep their own."
			>
				{(id) => (
					<select
						id={id}
						class="ui-select h-8 w-40 shrink-0 max-[420px]:w-full"
						value={settings().theme ?? "system"}
						onChange={(event) => {
							const next = event.currentTarget.value as ThemeMode;
							void updateAppSettings((current) => ({
								...current,
								theme: next,
							})).catch(() => undefined);
						}}
					>
						<option value="system">
							System{followsSystem() ? ` (${theme()})` : ""}
						</option>
						<option value="light">Light</option>
						<option value="dark">Dark</option>
					</select>
				)}
			</SettingRow>
			<SettingRow
				label="Antialiasing"
				description="Smooths edges in the drawing, schematic and Gerber views. Applies to all projects."
			>
				{(id) => (
					<select
						id={id}
						class="ui-select h-8 w-40 shrink-0 max-[420px]:w-full"
						value={settings().antialiasing ?? "auto"}
						onChange={(event) => {
							const antialiasing = event.currentTarget
								.value as AntialiasingMode;
							void updateAppSettings((current) => ({
								...current,
								antialiasing,
							})).catch(() => undefined);
						}}
					>
						<option value="auto">Automatic ({automatic ? "on" : "off"})</option>
						<option value="on">On</option>
						<option value="off">Off</option>
					</select>
				)}
			</SettingRow>
			<p class="m-0 mt-1 text-xs text-fg-faint">
				Automatic turns antialiasing off on software renderers, where it slows
				down drawing.
			</p>
			<h3 class="ui-section-label m-0 mt-5 mb-1">Debugging</h3>
			<SettingRow
				label="Show debug stats"
				description="A floating window with frame rate, frame time, draw calls, long tasks and memory. Ctrl+Shift+D toggles it."
			>
				{(id) => (
					<input
						id={id}
						type="checkbox"
						class="ui-checkbox shrink-0"
						checked={settings().debugStats ?? false}
						onChange={keepChecked((next) => {
							void setDebugStats(next);
						})}
					/>
				)}
			</SettingRow>
		</section>
	);
}

const channelDescriptions: Record<ReleaseChannel, string> = {
	stable: "Installs stable releases only.",
	nightly:
		"Also installs nightly builds, which come out before each stable release and get less testing.",
};

function UpdateSettings() {
	const settings = useAppSettings();
	const channel = () => settings().releaseChannel ?? "stable";
	return (
		<section aria-label="Updates" class="flex flex-col">
			<h3 class="ui-section-label m-0 mb-1">Updates</h3>
			<SettingRow
				label="Release channel"
				description={channelDescriptions[channel()]}
			>
				{(id) => (
					<select
						id={id}
						class="ui-select h-8 w-40 shrink-0 max-[420px]:w-full"
						value={channel()}
						onChange={(event) => {
							const releaseChannel = event.currentTarget
								.value as ReleaseChannel;
							void updateAppSettings((current) => ({
								...current,
								releaseChannel,
							})).catch(() => undefined);
						}}
					>
						<option value="stable">Stable</option>
						<option value="nightly">Nightly</option>
					</select>
				)}
			</SettingRow>
			<p class="m-0 mt-1 text-xs text-fg-faint">
				ECAD checks the new channel as soon as you switch. Going back to stable
				keeps an installed nightly until a newer stable release comes out.
			</p>
		</section>
	);
}

function UsageDataSettings() {
	const enabled = useTelemetryEnabled();
	const [error, setError] = createSignal("");
	return (
		<section aria-label="Usage data" class="flex flex-col">
			<h3 class="ui-section-label m-0 mb-1">Usage data</h3>
			<SettingRow
				label="Send performance data"
				description="Operation timings and device type, sent to PostHog in the EU. Never project contents, names or paths."
			>
				{(id) => (
					<input
						id={id}
						type="checkbox"
						class="ui-checkbox shrink-0"
						checked={enabled()}
						onChange={keepChecked((next) => {
							setError("");
							setTelemetryEnabled(next).catch((cause) =>
								setError(
									`The choice could not be saved. ${errorMessage(cause, "")}`.trim(),
								),
							);
						})}
					/>
				)}
			</SettingRow>
			<Show when={error()}>
				<p role="alert" class="m-0 text-xs text-danger">
					{error()}
				</p>
			</Show>
		</section>
	);
}

type Scope = "global" | "project";

const scopes = [
	["global", "All projects"],
	["project", "This project"],
] as const;

function ErcSettings() {
	const settings = useAppSettings();
	const project = useProjectSelection(({ project, saveSettings }) => ({
		settings: project?.manifest.settings,
		name: project?.manifest.name,
		saveSettings,
	}));
	const canEditProject = createMemo(
		() => !!project()?.name && !!project()?.saveSettings,
	);
	const [scope, setScope] = createSignal<Scope>(
		untrack(canEditProject) ? "project" : "global",
	);
	const [error, setError] = createSignal("");
	const projectScope = () => scope() === "project" && canEditProject();
	const overrides = (): ErcSeverityOverrides | undefined =>
		projectScope() ? project()?.settings?.ercSeverity : settings().ercSeverity;
	const change = (rule: string, level: ErcSeverityLevel | undefined) => {
		setError("");
		const save = projectScope() ? project()?.saveSettings : undefined;
		if (save)
			void save((current) => withErcSeverity(current, rule, level)).catch(
				(cause) =>
					setError(errorMessage(cause, "Unable to save project settings.")),
			);
		else
			void updateAppSettings((current) =>
				withErcSeverity(current, rule, level),
			).catch(() => undefined);
	};
	return (
		<section aria-label="Electrical rules" class="flex flex-col gap-3">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h3 class="ui-section-label m-0">Electrical rules</h3>
				<fieldset class="m-0 flex gap-0.5 rounded-md border border-line-subtle p-0.5">
					<legend class="sr-only">Apply rule levels to</legend>
					<For each={scopes}>
						{([value, label]) => (
							<button
								type="button"
								aria-pressed={
									(value === "project") === projectScope() ? "true" : "false"
								}
								disabled={value === "project" && !canEditProject()}
								class="ui-button ui-toggle h-7"
								onClick={() => setScope(value)}
							>
								{label}
							</button>
						)}
					</For>
				</fieldset>
			</div>
			<p class="m-0 text-xs text-fg-muted">
				{projectScope()
					? `Levels set here are saved in ${project()?.name ?? "the project"} and override the levels for all projects.`
					: "These levels apply to every project unless the project sets its own."}
			</p>
			<Show when={error()}>
				<p role="alert" class="m-0 text-xs text-danger">
					{error()}
				</p>
			</Show>
			<div class="flex flex-col divide-y divide-line-subtle">
				<For each={schematicErcRules}>
					{(rule) => {
						const fallback = () =>
							projectScope()
								? (settings().ercSeverity?.[rule.id] ?? rule.severity)
								: rule.severity;
						return (
							<SettingRow label={rule.title}>
								{(id) => (
									<select
										id={id}
										class="ui-select h-8 w-44 shrink-0 max-[420px]:w-full"
										value={overrides()?.[rule.id] ?? ""}
										onChange={(event) => {
											const next = event.currentTarget.value;
											change(
												rule.id,
												next === "" ? undefined : (next as ErcSeverityLevel),
											);
										}}
									>
										<option value="">
											{projectScope() ? "All projects" : "Default"} (
											{levelLabels[fallback()]})
										</option>
										<For each={ercSeverityLevels}>
											{(level) => (
												<option value={level}>{levelLabels[level]}</option>
											)}
										</For>
									</select>
								)}
							</SettingRow>
						);
					}}
				</For>
			</div>
		</section>
	);
}
