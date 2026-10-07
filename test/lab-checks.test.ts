import test from 'node:test'
import assert from 'node:assert/strict'
import { bindCheck, runCheck, checkFixtures } from '../shared/checks.ts'
import type { CheckDefinition } from '../shared/checks.ts'

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

test('population sd uses selected rows and every replication, with singleton and constant zero', () => {
  const context = checkFixtures[0].context
  const points = (ys: number[]) => ys.map((y, i) => ({ x: 2 + i / 10, y, group: 'A' }))
  const bound = bindCheck({ ...definition, statistic: 'sd' }, context)
  const observed = [...points([2, 4, 4, 4, 5, 5, 7, 9]), { x: 1, y: 999, group: 'A' }, { x: 2, y: 999, group: 'B' }]
  const result = runCheck(bound, { context, observed, replicated: [points([1, 3]), points([7]), points([4, 4, 4])] })
  assert.ok(Math.abs(result.observedValue - 2) < 1e-14)
  assert.equal(result.observedCount, 8)
  assert.deepEqual(result.replicatedValues, [1, 0, 0])
  assert.equal(result.tailFraction, 0)
  assert.throws(() => runCheck(bound, { context, observed: [], replicated: [points([1])] }), /empty/)
  for (const y of [NaN, Infinity, -Infinity]) {
    assert.throws(() => runCheck(bound, { context, observed: [...observed, { x: 99, y }], replicated: [points([1])] }), /finite/)
    assert.throws(() => runCheck(bound, { context, observed, replicated: [points([1]), [{ x: 99, y }]] }), /finite/)
  }
})

test('sd avoids squared and opposite-sign difference overflow for finite inputs', () => {
  const context = checkFixtures[0].context
  const bound = bindCheck({ ...definition, statistic: 'sd', group: undefined }, context)
  for (const [ys, expected] of [ [[-1e308, 1e308], 1e308], [[1e308, 0], 5e307], [[Number.MAX_VALUE, -Number.MAX_VALUE], Number.MAX_VALUE], [[1e308, 1e308, 1e308], 0], [[0, 0], 0], [[-1e-300, 1e-300], 1e-300] ] as [number[], number][]) {
    const observed = ys.map(y => ({ x: 2, y }))
    const result = runCheck(bound, { context, observed, replicated: [observed] })
    assert.ok(Number.isFinite(result.observedValue))
    assert.equal(result.observedValue, expected)
    assert.deepEqual(result.replicatedValues, [expected])
  }
})

test('sd retains small spread around a large common offset', () => {
  const context = checkFixtures[0].context
  const bound = bindCheck({ ...definition, statistic: 'sd', group: undefined }, context)
  const observed = [1, 2, 3].map(delta => ({ x: 2, y: 1e12 + delta }))
  const result = runCheck(bound, { context, observed, replicated: [observed] })
  assert.ok(Math.abs(result.observedValue - Math.sqrt(2 / 3)) < 1e-14)
})

test('exceedance counts strictly greater selected records, keeps ties in the separate predictive tail', () => {
  const context = checkFixtures[0].context
  const def = { ...definition, statistic: 'exceedance' as const, threshold: -2 }
  const points = (ys: number[]) => ys.map(y => ({ x: 2, y, group: 'A' }))
  const observed = [...points([-3, -2, -1, 1e308]), { x: 1, y: 99, group: 'A' }, { x: 2, y: 99, group: 'B' }]
  const result = runCheck(bindCheck(def, context), { context, observed, replicated: [points([-2, -3]), points([0, 1]), points([-2, 0])] })
  assert.equal(result.observedValue, 0.5)
  assert.equal(result.observedCount, 4)
  assert.deepEqual(result.replicatedValues, [0, 1, 0.5])
  assert.equal(result.tailFraction, 2 / 3)
  for (const threshold of [-Number.MAX_VALUE, Number.MAX_VALUE]) {
    const result = runCheck(bindCheck({ ...def, threshold }, context), { context, observed: points([-1e308, 1e308]), replicated: [points([0])] })
    assert.equal(result.observedValue, threshold < 0 ? 1 : 0)
  }
  const bound = bindCheck(def, context)
  assert.throws(() => runCheck(bound, { context, observed: [], replicated: [points([0])] }), /empty/)
  assert.throws(() => runCheck(bound, { context, observed, replicated: [[]] }), /empty/)
  for (const y of [Infinity, -Infinity, NaN]) assert.throws(() => runCheck(bound, { context, observed: [...observed, { x: 99, y }], replicated: [points([0])] }), /finite/)
})

test('threshold is finite and required only for exceedance at the calculation boundary', () => {
  const context = checkFixtures[0].context
  for (const threshold of [undefined, NaN, Infinity, -Infinity]) assert.throws(() => bindCheck({ ...definition, statistic: 'exceedance', threshold }, context), /threshold/i)
  for (const statistic of ['mean', 'max', 'sd'] as const) assert.throws(() => bindCheck({ ...definition, statistic, threshold: 0 }, context), /threshold/i)
})
