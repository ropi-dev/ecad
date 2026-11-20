import type { JSX } from "@solidjs/web";
import { For } from "solid-js";

export function Keyed(props: { key: unknown; children: JSX.Element }) {
	return <For each={[props.key]}>{() => props.children}</For>;
}
