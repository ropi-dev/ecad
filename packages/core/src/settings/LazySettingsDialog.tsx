import { type ComponentProps, createMemo, Loading, lazy, Show } from "solid-js";

const SettingsDialog = lazy(() => import("#/settings/SettingsDialog.tsx"), {
	export: "SettingsDialog",
});

export function LazySettingsDialog(
	props: ComponentProps<typeof SettingsDialog>,
) {
	const loaded = createMemo<boolean>((shown) => !!shown || props.open);
	return (
		<Show when={loaded()}>
			<Loading fallback={null}>
				<SettingsDialog {...props} />
			</Loading>
		</Show>
	);
}
