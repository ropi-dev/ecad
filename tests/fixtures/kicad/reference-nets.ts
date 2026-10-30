import { electricalNets } from '#/drawing/named-nets.ts';
import type { EditorShape } from '#/drawing/shapes.ts';
export interface ReferenceNetGroup { names: string[]; pins: string[] }
export const sortNetGroups = (groups: ReferenceNetGroup[]) => groups.map(group=>({names:[...group.names].sort(),pins:[...group.pins].sort()})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
export function referenceNetGroups(shapes: EditorShape[]): ReferenceNetGroup[] {
 const symbols = new Map(shapes.filter(shape=>shape.kind==='symbol').map(shape=>[shape.id,shape]));
 return sortNetGroups(electricalNets(shapes).map(net=>({names:net.names,pins:net.pins.flatMap(terminal=>{
  const symbol=symbols.get(terminal.shapeId);
  if(!symbol || symbol.netSymbol || symbol.attributes.reference.startsWith('#PWR')) return [];
  const pin=symbol.children.find(child=>child.id===terminal.pinId&&child.kind==='pin');
  return pin?.kind==='pin'?[`${symbol.attributes.reference}.${pin.number}`]:[];
 })})).filter(group=>group.pins.length>0));
}
