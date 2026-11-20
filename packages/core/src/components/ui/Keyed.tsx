import type { JSX } from "@solidjs/web";
import { createMemo, For } from "solid-js";

export function Keyed(props: { key: unknown; children: JSX.Element }) {
	const key = createMemo(() => props.key);
	return <For each={[key()]}>{() => props.children}</For>;
}
