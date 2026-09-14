import assert from 'node:assert/strict'
import test from 'node:test'
import { GeometryCompiler } from '../src/engine/geometry'
import { compileMesh, type MeshObject } from '../src/engine/mesh'

test('worker mesh preserves exposure order and transforms all vertices', () => {
  const geometry = { type: 'rect' as const, x: 0, y: 0, width: 2, height: 4 }
  const objects: MeshObject[] = [
    { geometry, polarity: 'dark', transform: [2, 0, 0, 3, 10, 20] },
    { geometry, polarity: 'clear' },
    { geometry, polarity: 'dark' },
  ]
  const compiler = new GeometryCompiler()
  const source = compiler.compile(geometry, 0.01 / 3).vertices
  const mesh = compileMesh(objects, compiler, 0.01)
  const chunkSize = source.length / 2 * 4
  assert.equal(mesh.length, chunkSize * 3)
  for (let i = 0; i < source.length / 2; i++) {
    assert.equal(mesh[i * 4], source[i * 2] * 2 + 10)
    assert.equal(mesh[i * 4 + 1], source[i * 2 + 1] * 3 + 20)
    assert.equal(mesh[i * 4 + 2], 1)
    assert.equal(mesh[i * 4 + 3], 0)
    assert.equal(mesh[chunkSize + i * 4 + 2], 0)
    assert.equal(mesh[chunkSize + i * 4 + 3], 1)
    assert.equal(mesh[chunkSize * 2 + i * 4 + 2], 1)
    assert.equal(mesh[chunkSize * 2 + i * 4 + 3], 2)
  }
  assert.deepEqual(compileMesh(objects, compiler, 0.01), mesh)
  assert.equal(compileMesh([], compiler, 0.01).length, 0)
})
