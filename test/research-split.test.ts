import test from "node:test";
import assert from "node:assert/strict";
import { splitResearchRows, type ResearchRow } from "../shared/research-split.ts";

const rows: ResearchRow[] = [
  { id: "a1", group: "A", time: 1, outcome: 10 },
  { id: "b1", group: "B", time: 1, outcome: 20 },
  { id: "a2", group: "A", time: 2, outcome: null },
  { id: "b2", group: "B", time: 2, outcome: 22 },
  { id: "a3", group: "A", time: 3, outcome: 15 },
  { id: "b3", group: "B", time: 3, outcome: null },
];
const ids = (items: ResearchRow[]) => items.map(r => r.id);

test("group holdout keeps whole groups and counts missing outcomes after splitting", () => {
  const result = splitResearchRows(rows, { kind: "group", testGroups: ["B"], target: "未観測の装置" });
  assert.deepEqual(ids(result.train), ["a1", "a2", "a3"]);
  assert.deepEqual(ids(result.test), ["b1", "b2", "b3"]);
  assert.deepEqual(ids(result.scoreable), ["b1", "b2"]);
  assert.deepEqual(ids(result.missingTestOutcome), ["b3"]);
  assert.deepEqual(result.counts, { total: 6, train: 3, test: 3, scoreable: 2, missingTestOutcome: 1, excluded: 0 });
  assert.equal(result.target, "未観測の装置");
});

test("time cutoff keeps equal timestamps together regardless of row order", () => {
  const plan = { kind: "time" as const, testFrom: 2, target: "時刻2以降" };
  const result = splitResearchRows(rows, plan);
  assert.deepEqual(ids(result.train), ["a1", "b1"]);
  assert.deepEqual(ids(result.test), ["a2", "b2", "a3", "b3"]);
  assert.ok(Math.max(...result.train.map(r => r.time!)) < Math.min(...result.test.map(r => r.time!)));
  assert.deepEqual(ids(splitResearchRows([...rows].reverse(), plan).test).sort(), ids(result.test).sort());
});

test("explicit IDs retain unused rows with reasons and all-missing test denominator", () => {
  const result = splitResearchRows(rows, { kind: "explicit", trainIds: ["b1"], testIds: ["a2", "b3"], target: "探索用に指定した行" });
  assert.equal(result.scoreable.length, 0);
  assert.equal(result.counts.test, 2);
  assert.equal(result.counts.missingTestOutcome, 2);
  assert.deepEqual(result.excluded.map(item => [item.row.id, item.reason]), [["a1", "not-selected"], ["b2", "not-selected"], ["a3", "not-selected"]]);
});

test("rejects duplicate, foreign and overlapping IDs instead of quietly dropping rows", () => {
  const base = { kind: "explicit" as const, trainIds: ["a1"], testIds: ["b1"], target: "検証" };
  assert.throws(() => splitResearchRows([...rows, rows[0]], base), /重複/);
  assert.throws(() => splitResearchRows(rows, { ...base, trainIds: ["a1", "a1"] }), /重複/);
  assert.throws(() => splitResearchRows(rows, { ...base, testIds: ["b1", "b1"] }), /重複/);
  assert.throws(() => splitResearchRows(rows, { ...base, testIds: ["a1"] }), /両方/);
  assert.throws(() => splitResearchRows(rows, { ...base, testIds: ["absent"] }), /存在/);
});

test("rejects missing split metadata, unknown groups, nonfinite values, empty partitions and targets", () => {
  const group = { kind: "group" as const, testGroups: ["B"], target: "新群" };
  const time = { kind: "time" as const, testFrom: 2, target: "未来" };
  assert.throws(() => splitResearchRows(rows.map(r => ({ ...r, group: null })), group), /群/);
  assert.throws(() => splitResearchRows(rows.map(r => ({ ...r, time: null })), time), /時刻/);
  assert.throws(() => splitResearchRows(rows, { ...group, testGroups: ["C"] }), /存在/);
  assert.throws(() => splitResearchRows(rows, { ...group, testGroups: ["B", "B"] }), /重複/);
  assert.throws(() => splitResearchRows(rows, { ...group, testGroups: ["A", "B"] }), /訓練/);
  for (const testFrom of [0, 4]) assert.throws(() => splitResearchRows(rows, { ...time, testFrom }), /訓練|保留/);
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => splitResearchRows([{ ...rows[0], outcome: value }, rows[1]], group));
    assert.throws(() => splitResearchRows([{ ...rows[0], time: value }, rows[1]], time));
    assert.throws(() => splitResearchRows(rows, { ...time, testFrom: value }));
  }
  assert.throws(() => splitResearchRows(rows, { ...time, target: " " }));
});

test("split result owns its data and does not mutate or impute input", () => {
  const input = structuredClone(rows), before = structuredClone(input);
  const result = splitResearchRows(input, { kind: "time", testFrom: 2, target: "未来" });
  assert.deepEqual(input, before);
  assert.equal(result.test[0].outcome, null);
  result.train[0].outcome = 999;
  result.test[0].group = "changed";
  assert.deepEqual(input, before);
});
