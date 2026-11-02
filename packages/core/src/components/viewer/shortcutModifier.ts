const control = {
	key: "Control",
	label: "Control",
	symbol: "Ctrl",
	flag: "ctrlKey",
	otherFlag: "metaKey",
} as const;
const command = {
	key: "Meta",
	label: "Command",
	symbol: "⌘",
	flag: "metaKey",
	otherFlag: "ctrlKey",
} as const;

export function shortcutModifier() {
	return typeof navigator !== "undefined" &&
		/Mac|iPhone|iPad|iPod/i.test(navigator.platform)
		? command
		: control;
}

export function hasShortcutModifier(
	event: Pick<KeyboardEvent, "ctrlKey" | "metaKey">,
) {
	const modifier = shortcutModifier();
	return event[modifier.flag] && !event[modifier.otherFlag];
}

export function formatShortcut(shortcut: string) {
	return shortcut.replace(/Ctrl(?:\/Cmd| or Cmd)?/g, shortcutModifier().symbol);
}
