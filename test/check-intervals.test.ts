import { test } from "node:test";
import assert from "node:assert/strict";
import { savedCheckIntervals } from "../src/check-intervals.ts";
import type { State } from "../shared/contracts.ts";

test("interval suggestions keep dataset group identity and reject prior or foreign evidence", () => {
  const state = {
    runs: [{id:"r",datasetId:"d",versionId:"v",modelId:"m"}, {id:"other",datasetId:"other-data",versionId:"v",modelId:"m"}],
    intents: ["r","other",null].map((runId,i) => ({id:`i${i}`,modelId:"m",scene:{modelVersionId:"v",runId},marks:[{kind:"bin",from:10,to:20,group:0,arg:"mu"}]})),
  } as State;
  assert.deepEqual(savedCheckIntervals(state,"m","v","d").map(x => x.id),["i0:0"]);
  assert.deepEqual(savedCheckIntervals(state,"m","another-version","d"),[]);
});
