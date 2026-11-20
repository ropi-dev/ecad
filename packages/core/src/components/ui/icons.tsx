import type { JSX } from "@solidjs/web";
import {
	Activity as ActivityNode,
	ArrowLeft as ArrowLeftNode,
	Box as BoxNode,
	Cable as CableNode,
	Check as CheckNode,
	ChevronDown as ChevronDownNode,
	ChevronLeft as ChevronLeftNode,
	ChevronRight as ChevronRightNode,
	ChevronUp as ChevronUpNode,
	CircleAlert as CircleAlertNode,
	CircleArrowUp as CircleArrowUpNode,
	CircleCheck as CircleCheckNode,
	CircleDashed as CircleDashedNode,
	CircleDot as CircleDotNode,
	Circle as CircleNode,
	CirclePlus as CirclePlusNode,
	CircleSmall as CircleSmallNode,
	CircuitBoard as CircuitBoardNode,
	Component as ComponentNode,
	Cpu as CpuNode,
	Diff as DiffNode,
	Download as DownloadNode,
	Eye as EyeNode,
	EyeOff as EyeOffNode,
	FileArchive as FileArchiveNode,
	FileCog as FileCogNode,
	FileImage as FileImageNode,
	FilePlus2 as FilePlus2Node,
	Files as FilesNode,
	FileUp as FileUpNode,
	FlipHorizontal2 as FlipHorizontal2Node,
	FolderCog as FolderCogNode,
	FolderOpen as FolderOpenNode,
	FolderUp as FolderUpNode,
	Grid2x2 as Grid2x2Node,
	GripVertical as GripVerticalNode,
	Hand as HandNode,
	History as HistoryNode,
	House as HouseNode,
	type IconNode,
	ImageDown as ImageDownNode,
	Info as InfoNode,
	Layers as LayersNode,
	Library as LibraryNode,
	LoaderCircle as LoaderCircleNode,
	Lock as LockNode,
	LockOpen as LockOpenNode,
	MapPin as MapPinNode,
	Minus as MinusNode,
	Monitor as MonitorNode,
	MousePointer2 as MousePointer2Node,
	OctagonAlert as OctagonAlertNode,
	Pencil as PencilNode,
	Pentagon as PentagonNode,
	PlugZap as PlugZapNode,
	Plus as PlusNode,
	RectangleVertical as RectangleVerticalNode,
	Redo2 as Redo2Node,
	RefreshCw as RefreshCwNode,
	RotateCcw as RotateCcwNode,
	RotateCw as RotateCwNode,
	Save as SaveNode,
	Scan as ScanNode,
	Search as SearchNode,
	Settings2 as Settings2Node,
	Settings as SettingsNode,
	Shapes as ShapesNode,
	ShieldCheck as ShieldCheckNode,
	Shuffle as ShuffleNode,
	SlidersHorizontal as SlidersHorizontalNode,
	Sparkles as SparklesNode,
	Spline as SplineNode,
	SquareDashedBottom as SquareDashedBottomNode,
	SquareDashedMousePointer as SquareDashedMousePointerNode,
	SquareDashed as SquareDashedNode,
	Square as SquareNode,
	Tag as TagNode,
	Tags as TagsNode,
	Trash2 as Trash2Node,
	TriangleAlert as TriangleAlertNode,
	Triangle as TriangleNode,
	Type as TypeNode,
	Undo2 as Undo2Node,
	Upload as UploadNode,
	Workflow as WorkflowNode,
	X as XNode,
	Zap as ZapNode,
} from "lucide";
import { omit } from "solid-js";

export interface IconProps extends JSX.SvgSVGAttributes<SVGSVGElement> {
	size?: number | string;
	strokeWidth?: number | string;
}

export type LucideIcon = (props: IconProps) => JSX.Element;

const markup = (node: IconNode) =>
	node
		.map(
			([tag, attributes]) =>
				`<${tag} ${Object.entries(attributes)
					.map(([name, value]) => `${name}="${value}"`)
					.join(" ")}/>`,
		)
		.join("");

function icon(name: string, node: IconNode): LucideIcon {
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

export const Activity = icon("activity", ActivityNode);
export const ArrowLeft = icon("arrow-left", ArrowLeftNode);
export const Box = icon("box", BoxNode);
export const Cable = icon("cable", CableNode);
export const Check = icon("check", CheckNode);
export const ChevronDown = icon("chevron-down", ChevronDownNode);
export const ChevronLeft = icon("chevron-left", ChevronLeftNode);
export const ChevronRight = icon("chevron-right", ChevronRightNode);
export const ChevronUp = icon("chevron-up", ChevronUpNode);
export const Circle = icon("circle", CircleNode);
export const CircleAlert = icon("circle-alert", CircleAlertNode);
export const CircleArrowUp = icon("circle-arrow-up", CircleArrowUpNode);
export const CircleCheck = icon("circle-check", CircleCheckNode);
export const CircleDashed = icon("circle-dashed", CircleDashedNode);
export const CircleDot = icon("circle-dot", CircleDotNode);
export const CirclePlus = icon("circle-plus", CirclePlusNode);
export const CircleSmall = icon("circle-small", CircleSmallNode);
export const CircuitBoard = icon("circuit-board", CircuitBoardNode);
export const Component = icon("component", ComponentNode);
export const Cpu = icon("cpu", CpuNode);
export const Diff = icon("diff", DiffNode);
export const Download = icon("download", DownloadNode);
export const Eye = icon("eye", EyeNode);
export const EyeOff = icon("eye-off", EyeOffNode);
export const FileArchive = icon("file-archive", FileArchiveNode);
export const FileCog = icon("file-cog", FileCogNode);
export const FileImage = icon("file-image", FileImageNode);
export const FilePlus2 = icon("file-plus2", FilePlus2Node);
export const Files = icon("files", FilesNode);
export const FileUp = icon("file-up", FileUpNode);
export const FlipHorizontal2 = icon("flip-horizontal2", FlipHorizontal2Node);
export const FolderCog = icon("folder-cog", FolderCogNode);
export const FolderOpen = icon("folder-open", FolderOpenNode);
export const FolderUp = icon("folder-up", FolderUpNode);
export const Grid2x2 = icon("grid2x2", Grid2x2Node);
export const GripVertical = icon("grip-vertical", GripVerticalNode);
export const Hand = icon("hand", HandNode);
export const History = icon("history", HistoryNode);
export const House = icon("house", HouseNode);
export const ImageDown = icon("image-down", ImageDownNode);
export const Info = icon("info", InfoNode);
export const Layers = icon("layers", LayersNode);
export const Library = icon("library", LibraryNode);
export const LoaderCircle = icon("loader-circle", LoaderCircleNode);
export const Lock = icon("lock", LockNode);
export const LockOpen = icon("lock-open", LockOpenNode);
export const MapPin = icon("map-pin", MapPinNode);
export const Minus = icon("minus", MinusNode);
export const Monitor = icon("monitor", MonitorNode);
export const MousePointer2 = icon("mouse-pointer2", MousePointer2Node);
export const OctagonAlert = icon("octagon-alert", OctagonAlertNode);
export const Pencil = icon("pencil", PencilNode);
export const Pentagon = icon("pentagon", PentagonNode);
export const PlugZap = icon("plug-zap", PlugZapNode);
export const Plus = icon("plus", PlusNode);
export const RectangleVertical = icon(
	"rectangle-vertical",
	RectangleVerticalNode,
);
export const Redo2 = icon("redo2", Redo2Node);
export const RefreshCw = icon("refresh-cw", RefreshCwNode);
export const RotateCcw = icon("rotate-ccw", RotateCcwNode);
export const RotateCw = icon("rotate-cw", RotateCwNode);
export const Save = icon("save", SaveNode);
export const Scan = icon("scan", ScanNode);
export const Search = icon("search", SearchNode);
export const Settings = icon("settings", SettingsNode);
export const Settings2 = icon("settings2", Settings2Node);
export const Shapes = icon("shapes", ShapesNode);
export const ShieldCheck = icon("shield-check", ShieldCheckNode);
export const Shuffle = icon("shuffle", ShuffleNode);
export const SlidersHorizontal = icon(
	"sliders-horizontal",
	SlidersHorizontalNode,
);
export const Sparkles = icon("sparkles", SparklesNode);
export const Spline = icon("spline", SplineNode);
export const Square = icon("square", SquareNode);
export const SquareDashed = icon("square-dashed", SquareDashedNode);
export const SquareDashedBottom = icon(
	"square-dashed-bottom",
	SquareDashedBottomNode,
);
export const SquareDashedMousePointer = icon(
	"square-dashed-mouse-pointer",
	SquareDashedMousePointerNode,
);
export const Tag = icon("tag", TagNode);
export const Tags = icon("tags", TagsNode);
export const Trash2 = icon("trash2", Trash2Node);
export const Triangle = icon("triangle", TriangleNode);
export const TriangleAlert = icon("triangle-alert", TriangleAlertNode);
export const Type = icon("type", TypeNode);
export const Undo2 = icon("undo2", Undo2Node);
export const Upload = icon("upload", UploadNode);
export const Workflow = icon("workflow", WorkflowNode);
export const X = icon("x", XNode);
export const Zap = icon("zap", ZapNode);
