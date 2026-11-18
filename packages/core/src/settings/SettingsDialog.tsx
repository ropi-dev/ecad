import { schematicErcRules } from "@ecad/drawing-core/erc/schematic-rules.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { CircleArrowUp, CircuitBoard, Library, Monitor } from "lucide-react";
import { lazy, type ReactNode, Suspense, useId, useState } from "react";
import { AppDialog } from "#/components/ui/Dialog.tsx";
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

const SymbolLibrarySettings = lazy(() =>
	import("#/projects/SymbolLibrarySettings.tsx").then((module) => ({
		default: module.SymbolLibrarySettings,
	})),
);

export type SettingsSection = "display" | "erc" | "libraries" | "updates";

const sections: {
	id: SettingsSection;
	label: string;
	icon: typeof Monitor;
}[] = [
	{ id: "display", label: "Display", icon: Monitor },
	{ id: "erc", label: "Electrical rules", icon: CircuitBoard },
	{ id: "libraries", label: "Symbol libraries", icon: Library },
	{ id: "updates", label: "Updates", icon: CircleArrowUp },
];

const levelLabels: Record<ErcSeverityLevel, string> = {
	error: "Error",
	warning: "Warning",
	off: "Off",
};

export function SettingsDialog({
	open,
	onOpenChange,
	section = "display",
}: {
	open: boolean;
	onOpenChange(open: boolean): void;
	section?: SettingsSection;
}) {
	const { updates } = useSettingsStatus();
	const shown = sections.filter(({ id }) => id !== "updates" || updates);
	const requested = shown.some(({ id }) => id === section)
		? section
		: "display";
	const [active, setActive] = useState(requested);
	const tabsId = useId();
	const [opened, setOpened] = useState(open);
	if (open !== opened) {
		setOpened(open);
		if (open) setActive(requested);
	}
	return (
		<AppDialog
			open={open}
			onOpenChange={onOpenChange}
			size="xl"
			focusDialog
			title="Settings"
			footer={
				<>
					<SettingsError />
					<button
						type="button"
						className="ui-button"
						data-variant="primary"
						data-size="md"
						onClick={() => onOpenChange(false)}
					>
						Done
					</button>
				</>
			}
		>
			<div className="flex min-h-0 flex-[1_1_34rem] max-[640px]:flex-col">
				<div
					role="tablist"
					aria-label="Settings sections"
					aria-orientation="vertical"
					className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-line-subtle p-2 max-[640px]:w-auto max-[640px]:flex-row max-[640px]:overflow-x-auto max-[640px]:border-r-0 max-[640px]:border-b"
					onKeyDown={(event) => {
						const index = shown.findIndex(({ id }) => id === active);
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
									? shown.length - 1
									: step
										? (index + step + shown.length) % shown.length
										: -1;
						const section = shown[next];
						if (!section) return;
						event.preventDefault();
						setActive(section.id);
						event.currentTarget
							.querySelectorAll<HTMLElement>('[role="tab"]')
							[next]?.focus();
					}}
				>
					{shown.map(({ id, label, icon: Icon }) => (
						<button
							key={id}
							type="button"
							role="tab"
							id={`${tabsId}-${id}-tab`}
							aria-selected={active === id}
							aria-controls={`${tabsId}-${id}-panel`}
							tabIndex={active === id ? 0 : -1}
							data-active={active === id}
							className="ui-button ui-toggle justify-start whitespace-nowrap"
							onClick={() => setActive(id)}
						>
							<Icon size={15} aria-hidden="true" />
							{label}
						</button>
					))}
				</div>
				<div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4">
					<div
						role="tabpanel"
						id={`${tabsId}-${active}-panel`}
						aria-labelledby={`${tabsId}-${active}-tab`}
						className="outline-none"
					>
						{active === "display" ? (
							<DisplaySettings />
						) : active === "erc" ? (
							<ErcSettings />
						) : active === "libraries" ? (
							<Suspense
								fallback={
									<output className="text-sm text-fg-muted">
										Loading libraries...
									</output>
								}
							>
								<SymbolLibrarySettings />
							</Suspense>
						) : updates ? (
							<UpdateSettings />
						) : null}
					</div>
				</div>
			</div>
		</AppDialog>
	);
}

function SettingsError() {
	const { error } = useSettingsStatus();
	return (
		<p
			role={error ? "alert" : undefined}
			className="m-0 mr-auto min-w-0 self-center text-xs break-words text-danger"
		>
			{error}
		</p>
	);
}

function SettingRow({
	label,
	description,
	children,
}: {
	label: string;
	description?: ReactNode;
	children(id: string): ReactNode;
}) {
	const id = useId();
	return (
		<div className="flex items-center justify-between gap-4 py-2 max-[420px]:flex-col max-[420px]:items-stretch">
			<div className="min-w-0">
				<label htmlFor={id} className="block text-sm font-medium text-fg">
					{label}
				</label>
				{description && (
					<p className="m-0 mt-0.5 text-xs text-fg-muted">{description}</p>
				)}
			</div>
			{children(id)}
		</div>
	);
}

function DisplaySettings() {
	const settings = useAppSettings();
	const automatic = automaticAntialiasing();
	const theme = useTheme();
	const followsSystem = (settings.theme ?? "system") === "system";
	return (
		<section aria-label="Display" className="flex flex-col">
			<h3 className="ui-section-label m-0 mb-1">Display</h3>
			<SettingRow
				label="Theme"
				description="Colours of the interface and the canvases. Exported drawings keep their own."
			>
				{(id) => (
					<select
						id={id}
						className="ui-select h-8 w-40 shrink-0 max-[420px]:w-full"
						value={settings.theme ?? "system"}
						onChange={(event) => {
							const next = event.currentTarget.value as ThemeMode;
							void updateAppSettings((current) => ({
								...current,
								theme: next,
							})).catch(() => undefined);
						}}
					>
						<option value="system">
							System{followsSystem ? ` (${theme})` : ""}
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
						className="ui-select h-8 w-40 shrink-0 max-[420px]:w-full"
						value={settings.antialiasing ?? "auto"}
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
			<p className="m-0 mt-1 text-xs text-fg-faint">
				Automatic turns antialiasing off on software renderers, where it slows
				down drawing.
			</p>
			<h3 className="ui-section-label m-0 mt-5 mb-1">Debugging</h3>
			<SettingRow
				label="Show debug stats"
				description="A floating window with frame rate, frame time, draw calls, long tasks and memory. Ctrl+Shift+D toggles it."
			>
				{(id) => (
					<input
						id={id}
						type="checkbox"
						className="ui-checkbox shrink-0"
						checked={settings.debugStats ?? false}
						onChange={(event) =>
							void setDebugStats(event.currentTarget.checked)
						}
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
	const channel = settings.releaseChannel ?? "stable";
	return (
		<section aria-label="Updates" className="flex flex-col">
			<h3 className="ui-section-label m-0 mb-1">Updates</h3>
			<SettingRow
				label="Release channel"
				description={channelDescriptions[channel]}
			>
				{(id) => (
					<select
						id={id}
						className="ui-select h-8 w-40 shrink-0 max-[420px]:w-full"
						value={channel}
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
			<p className="m-0 mt-1 text-xs text-fg-faint">
				ECAD checks the new channel as soon as you switch. Going back to stable
				keeps an installed nightly until a newer stable release comes out.
			</p>
		</section>
	);
}

type Scope = "global" | "project";

function ErcSettings() {
	const settings = useAppSettings();
	const project = useProjectSelection(({ project, saveSettings }) => ({
		settings: project?.manifest.settings,
		name: project?.manifest.name,
		saveSettings,
	}));
	const canEditProject = !!project?.name && !!project.saveSettings;
	const [scope, setScope] = useState<Scope>(
		canEditProject ? "project" : "global",
	);
	const [error, setError] = useState("");
	const projectScope = scope === "project" && canEditProject;
	const global = settings.ercSeverity;
	const projectOverrides = project?.settings?.ercSeverity;
	const change = (rule: string, level: ErcSeverityLevel | undefined) => {
		setError("");
		const save = projectScope ? project?.saveSettings : undefined;
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
	const overrides: ErcSeverityOverrides | undefined = projectScope
		? projectOverrides
		: global;
	return (
		<section aria-label="Electrical rules" className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="ui-section-label m-0">Electrical rules</h3>
				<fieldset className="m-0 flex gap-0.5 rounded-md border border-line-subtle p-0.5">
					<legend className="sr-only">Apply rule levels to</legend>
					{(
						[
							["global", "All projects"],
							["project", "This project"],
						] as const
					).map(([value, label]) => (
						<button
							key={value}
							type="button"
							aria-pressed={(value === "project") === projectScope}
							disabled={value === "project" && !canEditProject}
							className="ui-button ui-toggle h-7"
							onClick={() => setScope(value)}
						>
							{label}
						</button>
					))}
				</fieldset>
			</div>
			<p className="m-0 text-xs text-fg-muted">
				{projectScope
					? `Levels set here are saved in ${project?.name ?? "the project"} and override the levels for all projects.`
					: "These levels apply to every project unless the project sets its own."}
			</p>
			{error && (
				<p role="alert" className="m-0 text-xs text-danger">
					{error}
				</p>
			)}
			<div className="flex flex-col divide-y divide-line-subtle">
				{schematicErcRules.map((rule) => {
					const globalLevel = global?.[rule.id] ?? rule.severity;
					const fallback = projectScope ? globalLevel : rule.severity;
					const value = overrides?.[rule.id] ?? "";
					return (
						<SettingRow key={rule.id} label={rule.title}>
							{(id) => (
								<select
									id={id}
									className="ui-select h-8 w-44 shrink-0 max-[420px]:w-full"
									value={value}
									onChange={(event) => {
										const next = event.currentTarget.value;
										change(
											rule.id,
											next === "" ? undefined : (next as ErcSeverityLevel),
										);
									}}
								>
									<option value="">
										{projectScope ? "All projects" : "Default"} (
										{levelLabels[fallback]})
									</option>
									{ercSeverityLevels.map((level) => (
										<option key={level} value={level}>
											{levelLabels[level]}
										</option>
									))}
								</select>
							)}
						</SettingRow>
					);
				})}
			</div>
		</section>
	);
}
