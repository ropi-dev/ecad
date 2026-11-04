import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { Toast } from "radix-ui";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { toastManager } from "#/components/ui/toast.ts";

const icons = {
	success: CircleCheck,
	error: CircleAlert,
	warning: TriangleAlert,
	info: Info,
};

export function Toaster() {
	const viewport = useRef<HTMLOListElement>(null);
	const previousFocus = useRef<HTMLElement | null>(null);
	const notifications = useSyncExternalStore(
		toastManager.subscribe,
		toastManager.getSnapshot,
		toastManager.getServerSnapshot,
	);
	useEffect(() => {
		const rememberFocus = (target: EventTarget | null) => {
			if (
				target instanceof HTMLElement &&
				target !== document.body &&
				!viewport.current?.parentElement?.contains(target)
			)
				previousFocus.current = target;
		};
		const handleFocus = (event: FocusEvent) => rememberFocus(event.target);
		rememberFocus(document.activeElement);
		document.addEventListener("focusin", handleFocus, true);
		return () => document.removeEventListener("focusin", handleFocus, true);
	}, []);
	useEffect(() => {
		if (
			!notifications.length &&
			document.activeElement === viewport.current &&
			previousFocus.current?.isConnected
		) {
			previousFocus.current.focus();
		}
	}, [notifications.length]);
	return (
		<Toast.Provider duration={5000} swipeDirection="right" label="Notification">
			{notifications.map((notification) => {
				const Icon = icons[notification.type];
				return (
					<Toast.Root
						key={notification.revision}
						className="app-toast"
						data-type={notification.type}
						type={notification.type === "error" ? "foreground" : "background"}
						duration={
							notification.duration ??
							(notification.type === "error" ? Infinity : 5000)
						}
						onOpenChange={(open) => {
							if (!open) toastManager.close(notification.id);
						}}
					>
						<Icon className="app-toast-icon" size={18} aria-hidden="true" />
						<div className="min-w-0 flex-1">
							<Toast.Title className="text-sm font-medium text-[#e8edf5]">
								{notification.title}
							</Toast.Title>
							{notification.description && (
								<Toast.Description className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-[#a8b3c2]">
									{notification.description}
								</Toast.Description>
							)}
						</div>
						<Toast.Close
							className="app-toast-close"
							aria-label={`Dismiss ${notification.title}`}
						>
							<X size={14} aria-hidden="true" />
						</Toast.Close>
					</Toast.Root>
				);
			})}
			<Toast.Viewport
				ref={viewport}
				className="app-toast-viewport"
				label="Notifications, press F8 to focus"
			/>
		</Toast.Provider>
	);
}
