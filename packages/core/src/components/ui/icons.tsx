import type { JSX } from "@solidjs/web";
import * as lucide from "lucide";
import { omit } from "solid-js";

export interface IconProps extends JSX.SvgSVGAttributes<SVGSVGElement> {
	size?: number | string;
	strokeWidth?: number | string;
}

export type LucideIcon = (props: IconProps) => JSX.Element;

const markup = (node: lucide.IconNode) =>
	node
		.map(
			([tag, attributes]) =>
				`<${tag} ${Object.entries(attributes)
					.map(([name, value]) => `${name}="${value}"`)
					.join(" ")}/>`,
		)
		.join("");

function icon(name: string, node: lucide.IconNode): LucideIcon {
	const content = markup(node);
	return (props) => {
		const rest = omit(props, "size", "strokeWidth", "class");
		return (
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width={props.size ?? 24}
				height={props.size ?? 24}
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width={props.strokeWidth ?? 2}
				stroke-linecap="round"
				stroke-linejoin="round"
				class={["lucide", `lucide-${name}`, props.class]}
				{...rest}
				innerHTML={content}
			/>
		);
	};
}

export const Activity = icon("activity", lucide.Activity);
export const ArrowLeft = icon("arrow-left", lucide.ArrowLeft);
export const Box = icon("box", lucide.Box);
export const Cable = icon("cable", lucide.Cable);
export const Check = icon("check", lucide.Check);
export const ChevronDown = icon("chevron-down", lucide.ChevronDown);
export const ChevronLeft = icon("chevron-left", lucide.ChevronLeft);
export const ChevronRight = icon("chevron-right", lucide.ChevronRight);
export const ChevronUp = icon("chevron-up", lucide.ChevronUp);
export const Circle = icon("circle", lucide.Circle);
export const CircleAlert = icon("circle-alert", lucide.CircleAlert);
export const CircleArrowUp = icon("circle-arrow-up", lucide.CircleArrowUp);
export const CircleCheck = icon("circle-check", lucide.CircleCheck);
export const CircleDashed = icon("circle-dashed", lucide.CircleDashed);
export const CircleDot = icon("circle-dot", lucide.CircleDot);
export const CirclePlus = icon("circle-plus", lucide.CirclePlus);
export const CircleSmall = icon("circle-small", lucide.CircleSmall);
export const CircuitBoard = icon("circuit-board", lucide.CircuitBoard);
export const Component = icon("component", lucide.Component);
export const Cpu = icon("cpu", lucide.Cpu);
export const Diff = icon("diff", lucide.Diff);
export const Download = icon("download", lucide.Download);
export const Eye = icon("eye", lucide.Eye);
export const EyeOff = icon("eye-off", lucide.EyeOff);
export const FileArchive = icon("file-archive", lucide.FileArchive);
export const FileCog = icon("file-cog", lucide.FileCog);
export const FileImage = icon("file-image", lucide.FileImage);
export const FilePlus2 = icon("file-plus2", lucide.FilePlus2);
export const Files = icon("files", lucide.Files);
export const FileUp = icon("file-up", lucide.FileUp);
export const FlipHorizontal2 = icon("flip-horizontal2", lucide.FlipHorizontal2);
export const FolderCog = icon("folder-cog", lucide.FolderCog);
export const FolderOpen = icon("folder-open", lucide.FolderOpen);
export const FolderUp = icon("folder-up", lucide.FolderUp);
export const Grid2x2 = icon("grid2x2", lucide.Grid2x2);
export const GripVertical = icon("grip-vertical", lucide.GripVertical);
export const Hand = icon("hand", lucide.Hand);
export const History = icon("history", lucide.History);
export const House = icon("house", lucide.House);
export const ImageDown = icon("image-down", lucide.ImageDown);
export const Info = icon("info", lucide.Info);
export const Layers = icon("layers", lucide.Layers);
export const Library = icon("library", lucide.Library);
export const LoaderCircle = icon("loader-circle", lucide.LoaderCircle);
export const Lock = icon("lock", lucide.Lock);
export const LockOpen = icon("lock-open", lucide.LockOpen);
export const MapPin = icon("map-pin", lucide.MapPin);
export const Minus = icon("minus", lucide.Minus);
export const Monitor = icon("monitor", lucide.Monitor);
export const MousePointer2 = icon("mouse-pointer2", lucide.MousePointer2);
export const OctagonAlert = icon("octagon-alert", lucide.OctagonAlert);
export const Pencil = icon("pencil", lucide.Pencil);
export const Pentagon = icon("pentagon", lucide.Pentagon);
export const PlugZap = icon("plug-zap", lucide.PlugZap);
export const Plus = icon("plus", lucide.Plus);
export const RectangleVertical = icon(
	"rectangle-vertical",
	lucide.RectangleVertical,
);
export const Redo2 = icon("redo2", lucide.Redo2);
export const RefreshCw = icon("refresh-cw", lucide.RefreshCw);
export const RotateCcw = icon("rotate-ccw", lucide.RotateCcw);
export const RotateCw = icon("rotate-cw", lucide.RotateCw);
export const Save = icon("save", lucide.Save);
export const Scan = icon("scan", lucide.Scan);
export const Search = icon("search", lucide.Search);
export const Settings = icon("settings", lucide.Settings);
export const Settings2 = icon("settings2", lucide.Settings2);
export const Shapes = icon("shapes", lucide.Shapes);
export const ShieldCheck = icon("shield-check", lucide.ShieldCheck);
export const Shuffle = icon("shuffle", lucide.Shuffle);
export const SlidersHorizontal = icon(
	"sliders-horizontal",
	lucide.SlidersHorizontal,
);
export const Sparkles = icon("sparkles", lucide.Sparkles);
export const Spline = icon("spline", lucide.Spline);
export const Square = icon("square", lucide.Square);
export const SquareDashed = icon("square-dashed", lucide.SquareDashed);
export const SquareDashedBottom = icon(
	"square-dashed-bottom",
	lucide.SquareDashedBottom,
);
export const SquareDashedMousePointer = icon(
	"square-dashed-mouse-pointer",
	lucide.SquareDashedMousePointer,
);
export const Tag = icon("tag", lucide.Tag);
export const Tags = icon("tags", lucide.Tags);
export const Trash2 = icon("trash2", lucide.Trash2);
export const Triangle = icon("triangle", lucide.Triangle);
export const TriangleAlert = icon("triangle-alert", lucide.TriangleAlert);
export const Type = icon("type", lucide.Type);
export const Undo2 = icon("undo2", lucide.Undo2);
export const Upload = icon("upload", lucide.Upload);
export const Workflow = icon("workflow", lucide.Workflow);
export const X = icon("x", lucide.X);
export const Zap = icon("zap", lucide.Zap);
