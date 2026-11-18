export const dialogWindowPrefix = "ecad-dialog-";

let enabled = false;
let opened = 0;

export function setDialogWindows(next: boolean) {
	enabled = next;
}

export function dialogWindowsEnabled() {
	return enabled;
}

export const dialogWindowWidths = {
	sm: 384,
	md: 448,
	lg: 512,
	xl: 768,
} as const;

export function openDialogWindow(width: number) {
	opened++;
	const popup = window.open(
		"",
		`${dialogWindowPrefix}${opened}`,
		`popup,width=${width},height=240`,
	);
	if (!popup) return null;
	const { documentElement, head } = popup.document;
	documentElement.lang = document.documentElement.lang || "en";
	documentElement.classList.add("dialog-window");
	const charset = popup.document.createElement("meta");
	charset.setAttribute("charset", "utf-8");
	head.append(charset);
	return popup;
}

export function mirrorPageStyles(popup: Window) {
	const target = popup.document;
	const copies = new Map<Element, Element>();
	const syncStyles = () => {
		const current = new Set(
			document.head.querySelectorAll('style, link[rel="stylesheet"]'),
		);
		for (const [node, copy] of copies) {
			if (current.has(node)) continue;
			copy.remove();
			copies.delete(node);
		}
		for (const node of current) {
			const copy = copies.get(node);
			if (!copy) {
				const clone = target.importNode(node, true) as Element;
				if (node instanceof HTMLLinkElement)
					clone.setAttribute("href", node.href);
				target.head.append(clone);
				copies.set(node, clone);
			} else if (copy.textContent !== node.textContent) {
				copy.textContent = node.textContent;
			}
		}
	};
	const syncTheme = () => {
		const { theme } = document.documentElement.dataset;
		if (theme) target.documentElement.dataset.theme = theme;
		else delete target.documentElement.dataset.theme;
	};
	syncStyles();
	syncTheme();
	const styles = new MutationObserver(syncStyles);
	styles.observe(document.head, {
		childList: true,
		subtree: true,
		characterData: true,
	});
	const theme = new MutationObserver(syncTheme);
	theme.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme"],
	});
	return () => {
		styles.disconnect();
		theme.disconnect();
	};
}

export function fitDialogWindow(
	popup: Window,
	card: HTMLElement,
	width: number,
) {
	const view = popup as Window & typeof globalThis;
	let first = true;
	const fit = () => {
		card.style.maxHeight = "none";
		const natural = Math.ceil(card.getBoundingClientRect().height);
		card.style.maxHeight = "";
		const height = Math.min(
			natural,
			Math.floor(popup.screen.availHeight * 0.85),
		);
		if (!first && popup.innerWidth === width && popup.innerHeight === height)
			return;
		popup.resizeTo(width, height);
		first = false;
	};
	fit();
	const resized = new view.ResizeObserver(fit);
	resized.observe(card);
	const changed = new view.MutationObserver((records) => {
		if (records.some((record) => record.target !== card)) fit();
	});
	changed.observe(card, {
		childList: true,
		subtree: true,
		characterData: true,
		attributes: true,
	});
	return () => {
		resized.disconnect();
		changed.disconnect();
	};
}

const focusable =
	'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function focusDialogWindow(
	popup: Window,
	card: HTMLElement,
	focusCard: boolean,
) {
	popup.focus();
	const first = focusCard ? null : card.querySelector<HTMLElement>(focusable);
	(first ?? card).focus();
}
