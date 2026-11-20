import { createSignal, For, Show, untrack } from "solid-js";
import type { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import { keepChecked } from "#/components/ui/checkbox.ts";
import {
	FolderOpen,
	FolderUp,
	RefreshCw,
	Trash2,
	Upload,
} from "#/components/ui/icons.tsx";
import { panelIconButtonClassName } from "#/components/viewer/viewControlStyles.ts";
import type {
	ConfiguredSymbolLibrary,
	LibraryScope,
} from "#/symbol-library/config.ts";
import exampleSymbolUrl from "#/symbol-library/examples/test-point.ecadsym?url";

export function SymbolLibraryControls(props: {
	library: ReturnType<typeof useSymbolLibrary>;
	feedback?: boolean;
}) {
	const [scope, setScope] = createSignal<LibraryScope>(
		untrack(() => props.library.defaultScope),
	);
	const [name, setName] = createSignal("");
	const feedback = () => props.feedback ?? true;
	let input!: HTMLInputElement;
	let directoryInput!: HTMLInputElement;
	return (
		<div class="flex flex-col gap-4 text-fg">
			<LibraryList
				title="User libraries"
				scope="user"
				libraries={props.library.userLibraries}
				library={props.library}
			/>
			{props.library.hasProject && (
				<LibraryList
					title="Project libraries"
					scope="project"
					libraries={props.library.projectLibraries}
					library={props.library}
				/>
			)}
			<section class="flex flex-col gap-3 border-t border-line-subtle pt-4">
				<h3 class="ui-section-label m-0">Add a library</h3>
				<div class="grid grid-cols-2 gap-3 max-[420px]:grid-cols-1">
					<label class="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-fg-muted">
						Add library to
						<select
							aria-label="Library scope"
							value={scope()}
							disabled={props.library.loading}
							onChange={(event) =>
								setScope(event.currentTarget.value as LibraryScope)
							}
							class="ui-select h-8 w-full"
						>
							<option value="user">User libraries</option>
							{props.library.hasProject && (
								<option value="project">Project libraries</option>
							)}
						</select>
					</label>
					<label class="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-fg-muted">
						Library name
						<input
							aria-label="Library name"
							value={name()}
							disabled={props.library.loading}
							maxlength={100}
							placeholder={
								scope() === "project" ? "Project symbols" : "Imported symbols"
							}
							onInput={(event) => setName(event.currentTarget.value)}
							class="ui-input h-8 w-full"
						/>
					</label>
				</div>
				<input
					ref={input}
					type="file"
					multiple
					accept=".ecadsym,.json"
					aria-label="Upload symbol files"
					class="hidden"
					disabled={props.library.loading}
					onChange={(event) => {
						const files = Array.from(event.currentTarget.files ?? []);
						event.currentTarget.value = "";
						if (files.length)
							void props.library.upload(files, false, scope(), name());
					}}
				/>
				<input
					ref={(element) => {
						directoryInput = element;
						element.webkitdirectory = true;
					}}
					type="file"
					multiple
					aria-label="Upload symbol directory"
					class="hidden"
					disabled={props.library.loading}
					onChange={(event) => {
						const files = Array.from(event.currentTarget.files ?? []);
						event.currentTarget.value = "";
						if (files.length)
							void props.library.upload(files, true, scope(), name());
					}}
				/>
				<div class="flex flex-wrap gap-2">
					<button
						type="button"
						disabled={props.library.loading}
						onClick={() => input.click()}
						class="ui-button"
						data-variant="secondary"
					>
						<Upload size={14} aria-hidden="true" />
						Upload symbols
					</button>
					<button
						type="button"
						disabled={props.library.loading}
						onClick={() => directoryInput.click()}
						class="ui-button"
						data-variant="secondary"
					>
						<FolderUp size={14} aria-hidden="true" />
						Upload library directory
					</button>
					{props.library.canOpenDirectory && (
						<button
							type="button"
							disabled={props.library.loading}
							onClick={() => void props.library.openDirectory(scope(), name())}
							class="ui-button"
							data-variant="secondary"
						>
							<FolderOpen size={14} aria-hidden="true" />
							Add library directory
						</button>
					)}
					<button
						type="button"
						disabled={props.library.loading}
						onClick={() => void props.library.refresh()}
						class="ui-button"
						data-variant="ghost"
					>
						<RefreshCw size={14} aria-hidden="true" />
						Reload libraries
					</button>
				</div>
				<p class="m-0 text-xs text-fg-faint">
					One symbol per .ecadsym or .json file.{" "}
					<a
						href={exampleSymbolUrl}
						download="test-point.ecadsym"
						class="rounded-sm text-fg-muted underline underline-offset-2 hover:text-fg"
					>
						Download example
					</a>
				</p>
				<Show when={feedback() && props.library.message}>
					<output class="block text-xs text-success">
						{props.library.message}
					</output>
				</Show>
				<Show when={feedback() && props.library.error}>
					<p
						role="alert"
						class="m-0 max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-danger"
					>
						{props.library.error}
					</p>
				</Show>
			</section>
		</div>
	);
}

function LibraryList(props: {
	title: string;
	scope: LibraryScope;
	libraries: readonly ConfiguredSymbolLibrary[];
	library: ReturnType<typeof useSymbolLibrary>;
}) {
	return (
		<fieldset aria-label={props.title} class="m-0 min-w-0 border-0 p-0">
			<legend class="ui-section-label mb-1.5 p-0">{props.title}</legend>
			{!props.libraries.length && (
				<p class="m-0 text-xs text-fg-faint">No libraries configured.</p>
			)}
			<For each={props.libraries} keyed={(entry) => entry.id}>
				{(entry) => (
					<div class="-mx-1.5 flex min-h-8 items-center gap-2 rounded-md px-1.5 hover:bg-hover">
						<label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-1 text-sm">
							<input
								type="checkbox"
								class="ui-checkbox"
								checked={entry().enabled}
								disabled={props.library.loading}
								onChange={keepChecked(
									() => void props.library.toggle(entry().id, props.scope),
								)}
							/>
							<span class="break-words">{entry().name}</span>
						</label>
						{entry().source.kind !== "builtin" &&
							!(
								props.scope === "project" && entry().id === "project-symbols"
							) && (
								<button
									type="button"
									aria-label={`Remove ${entry().name}`}
									disabled={props.library.loading}
									onClick={() =>
										void props.library.remove(entry().id, props.scope)
									}
									class={[panelIconButtonClassName, "hover:text-danger"]}
								>
									<Trash2 size={14} aria-hidden="true" />
								</button>
							)}
					</div>
				)}
			</For>
		</fieldset>
	);
}
