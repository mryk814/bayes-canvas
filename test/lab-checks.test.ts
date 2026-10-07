import test from 'node:test'
import assert from 'node:assert/strict'
import { bindCheck, runCheck, checkFixtures } from '../lab/checks.ts'
import type { CheckDefinition } from '../lab/checks.ts'

const definition: CheckDefinition = { id: 'late', label: '後半の平均', xMin: 2, xMax: 3, group: 'A', statistic: 'mean' }

test('saved definition applies identical inclusive interval and group to observations and every replication', () => {
  const saved = JSON.parse(JSON.stringify(definition))
  const evidence = { context: { modelVersionId: 'v1', datasetId: 'd1', runId: 'r1' }, observed: [{ x: 1, y: 999, group: 'A' }, { x: 2, y: 4, group: 'A' }, { x: 3, y: 6, group: 'A' }, { x: 3, y: 999, group: 'B' }], replicated: [[{ x: 2, y: 1, group: 'A' }, { x: 3, y: 3, group: 'A' }], [{ x: 2, y: 5, group: 'A' }, { x: 3, y: 7, group: 'A' }]] }
  const result = runCheck(bindCheck(saved, evidence.context), evidence)
  assert.equal(result.observedValue, 5)
  assert.deepEqual(result.replicatedValues, [2, 6])
  assert.ok(Math.abs(result.predictiveRange[0] - 2.2) < 1e-12)
  assert.ok(Math.abs(result.predictiveRange[1] - 5.8) < 1e-12)
  assert.equal(result.tailFraction, 0.5)
  assert.equal(result.observedCount, 2)
})

test('max statistic and ungrouped definition include all selected observations', () => {
  const evidence = checkFixtures[0]
  const result = runCheck(bindCheck({ ...definition, group: undefined, statistic: 'max' }, evidence.context), evidence)
  assert.equal(result.observedValue, Math.max(...evidence.observed.filter(point => point.x >= 2 && point.x <= 3).map(point => point.y)))
})

test('each context reference must match; rerun requires explicit binding and preserves history', () => {
  const first = checkFixtures[0]
  const second = checkFixtures[1]
  const bound = bindCheck(definition, first.context)
  const past = runCheck(bound, first)
  const snapshot = JSON.stringify(past)
  for (const key of ['modelVersionId', 'datasetId', 'runId'] as const) {
    assert.throws(() => runCheck(bound, { ...first, context: { ...first.context, [key]: 'other' } }), /context/i)
  }
  const next = runCheck(bindCheck(definition, second.context), second)
  assert.equal(JSON.stringify(past), snapshot)
  assert.notEqual(next.context.modelVersionId, past.context.modelVersionId)
  assert.notEqual(next.tailFraction, past.tailFraction)
})

test('invalid definitions, empty selections, absent replications and non-finite evidence fail explicitly', () => {
  const evidence = checkFixtures[0]
  assert.throws(() => bindCheck({ ...definition, xMin: 4 }, evidence.context), /interval/i)
  assert.throws(() => bindCheck({ ...definition, xMax: Infinity }, evidence.context), /interval/i)
  assert.throws(() => bindCheck({ ...definition, statistic: 'sum' } as unknown as CheckDefinition, evidence.context), /statistic/i)
  assert.throws(() => bindCheck(definition, { ...evidence.context, runId: '' }), /context/i)
  const bound = bindCheck(definition, evidence.context)
  assert.throws(() => runCheck(bound, { ...evidence, observed: [] }), /empty/i)
  assert.throws(() => runCheck(bound, { ...evidence, replicated: [] }), /replication/i)
  assert.throws(() => runCheck(bound, { ...evidence, replicated: [[]] }), /empty/i)
  assert.throws(() => runCheck(bound, { ...evidence, observed: [{ x: 2, y: NaN, group: 'A' }] }), /finite/i)
  assert.throws(() => runCheck(bound, { ...evidence, observed: [{ x: NaN, y: 2, group: 'A' }] }), /finite/i)
})

test('binding and results own snapshots rather than retaining mutable inputs', () => {
  const mutable = { ...definition }
  const context = { ...checkFixtures[0].context }
  const bound = bindCheck(mutable, context)
  mutable.xMin = 99
  context.runId = 'changed'
  assert.equal(bound.definition.xMin, 2)
  assert.equal(bound.context.runId, checkFixtures[0].context.runId)
  const result = runCheck(bound, checkFixtures[0])
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.context), true)
  assert.equal(Object.isFrozen(result.replicatedValues), true)
})
