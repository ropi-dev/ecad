import {
	type ModelReference,
	modelKey,
} from "@ecad/drawing-core/footprint/model.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { createSignal, For, Show } from "solid-js";
import { Box } from "#/components/ui/icons.tsx";
import { toastManager } from "#/components/ui/toast.ts";
import { useBuiltinModels } from "#/footprint/models.ts";

export function FootprintModelField(props: {
	model: ModelReference | undefined;
	onChange: (model: ModelReference | undefined) => Promise<void>;
}) {
	const models = useBuiltinModels();
	const [saving, setSaving] = createSignal(false);
	const current = () => {
		const model = props.model;
		return model && models.library?.byId.get(model.id);
	};
	const chosen = () => (props.model ? modelKey(props.model) : "");
	const [shown, setShown] = createSignal(() => chosen());
	const missing = () =>
		props.model !== undefined && models.library !== undefined && !current();
	return (
		<label class="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
			<Box size={14} aria-hidden="true" class="shrink-0" />
			<select
				aria-label="3D model"
				class="ui-select w-56 max-w-full overflow-clip whitespace-nowrap [overflow-clip-margin:content-box]"
				title={
					current()?.name ??
					(models.failed ? "The 3D model library did not load" : undefined)
				}
				disabled={saving() || (!models.library && !models.failed)}
				onChange={(event) => {
					const select = event.currentTarget;
					setShown(select.value);
					const [source, id] = select.value.split(/:(.*)/s);
					const next: ModelReference | undefined =
						source === "builtin" && id ? { library: source, id } : undefined;
					setSaving(true);
					props
						.onChange(next)
						.catch((cause: unknown) => {
							select.value = chosen();
							setShown(chosen());
							toastManager.add({
								type: "error",
								title: "Unable to change the 3D model",
								description: errorMessage(
									cause,
									"Unable to change the 3D model",
								),
							});
						})
						.finally(() => setSaving(false));
				}}
			>
				<option value="" selected={shown() === ""}>
					No 3D model
				</option>
				<Show when={missing() && props.model}>
					{(model) => (
						<option value={modelKey(model())} selected>
							{model().id} (missing)
						</option>
					)}
				</Show>
				<Show when={!models.library && props.model}>
					{(model) => (
						<option value={modelKey(model())} selected>
							{model().id}
						</option>
					)}
				</Show>
				<Show when={models.library}>
					{(library) => (
						<For each={library().categories}>
							{(category) => (
								<optgroup label={category}>
									<For
										each={library().models.filter(
											(entry) => entry.category === category,
										)}
									>
										{(entry) => (
											<option
												value={`builtin:${entry.id}`}
												selected={shown() === `builtin:${entry.id}`}
											>
												{entry.name}
											</option>
										)}
									</For>
								</optgroup>
							)}
						</For>
					)}
				</Show>
			</select>
		</label>
	);
}
