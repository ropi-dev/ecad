import assert from 'node:assert/strict'
import test from 'node:test'
import { parseGerber } from '#/formats/gerber'
import { indexGerberNets } from '#/formats/gerber/nets.ts'

const source = `%FSLAX46Y46*%%MOMM*%%ADD10C,1*%
D10*
%TO.N,SIGNAL*%
X0Y0D02*X10000000Y0D01*X10000000Y10000000D01*
X20000000Y10000000D03*
%TO.N,OTHER*%X20000000Y0D03*
%TO.N,N/C*%X0Y10000000D03*X3000000Y10000000D03*
%TO.N,*%X0Y20000000D03*X3000000Y20000000D03*
%TD.N*%X0Y30000000D03*X3000000Y30000000D03*
%TO.N,SIGNAL*%%LPC*%X5000000Y0D03*
M02*`

test('all segments and disconnected pads with the same Gerber net share one selection', () => {
  const { object: layer, diagnostics } = parseGerber(source, 'nets.gbr')
  assert.deepEqual(diagnostics, [])
  const index = indexGerberNets(layer)
  const [a, b, pad, other] = layer.objects
  assert.deepEqual([...index.get(a.id)!], [a.id, b.id, pad.id])
  assert.equal(index.get(a.id), index.get(b.id))
  assert.equal(index.get(a.id), index.get(pad.id))
  assert.deepEqual([...index.get(other.id)!], [other.id])
  assert.equal(index.has(layer.objects.at(-1)!.id), false, 'Clear exposures are never selected')
})
test('N/C, empty, whitespace-only, and absent net names are not hover targets', () => {
  const { object: layer } = parseGerber(source, 'nets.gbr')
  layer.objects[6].attributes['.N'] = ['  ', '\t']
  const index = indexGerberNets(layer)
  for (const object of layer.objects.slice(4,10))
    assert.equal(index.has(object.id), false)
})
test('objects declaring multiple nets select the members of each declared net', () => {
  const { object: layer } = parseGerber(source, 'nets.gbr')
  layer.objects[0].attributes['.N'] = ['SIGNAL', 'OTHER', 'SIGNAL', '', '  ', 'N/C']
  const index = indexGerberNets(layer)
  assert.deepEqual(new Set(index.get(layer.objects[0].id)), new Set(layer.objects.slice(0,4).map(o=>o.id)))
})
