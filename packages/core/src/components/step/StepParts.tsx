import { For } from "solid-js";
import type { ParsedStepFile } from "#/formats/parseStepFile.ts";

export function StepParts(props: {
	model: ParsedStepFile;
	hidden: Set<number>;
	onToggle: (index: number) => void;
	onClear: () => void;
}) {
	return (
		<aside
			aria-label="Model parts"
			class="ui-panel absolute top-[calc(var(--chrome-top)+var(--chrome-bar))] right-[var(--chrome-right)] z-10 flex max-h-[40%] w-60 flex-col overflow-hidden sm:top-[var(--chrome-top)] sm:max-h-[calc(100%-var(--chrome-top)-var(--chrome-dock))] sm:w-72"
		>
			<header class="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-line-subtle py-1.5 pr-1.5 pl-3">
				<h2 class="m-0 truncate text-sm font-semibold" title={props.model.name}>
					{props.model.name}
				</h2>
				<button
					type="button"
					class="ui-button"
					data-variant="ghost"
					onClick={() => props.onClear()}
				>
					Close
				</button>
			</header>
			<ul class="m-0 min-h-0 list-none overflow-y-auto p-1.5">
				<For each={props.model.parts}>
					{(part, index) => (
						<li>
							<label class="flex min-h-8 cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-sm hover:bg-hover pointer-coarse:min-h-11">
								<input
									type="checkbox"
									checked={!props.hidden.has(index())}
									onChange={(event) => {
										const next = event.currentTarget.checked;
										event.currentTarget.checked = !next;
										props.onToggle(index());
									}}
									class="ui-checkbox"
								/>
								<span
									class="truncate"
									title={part.name || `Part ${index() + 1}`}
								>
									{part.name || `Part ${index() + 1}`}
								</span>
							</label>
						</li>
					)}
				</For>
			</ul>
		</aside>
	);
}
