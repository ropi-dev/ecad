import type { ComponentProps } from "react";
import { CreateFileDialog } from "#/components/editor/CreateFileDialog.tsx";

export function CreateSymbolDialog(
	props: Omit<ComponentProps<typeof CreateFileDialog>, "kind">,
) {
	return <CreateFileDialog {...props} kind="symbol" />;
}
