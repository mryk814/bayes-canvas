import type { State } from "../shared/contracts.ts";

export function savedCheckIntervals(state: State, modelId: string, versionId: string, datasetId: string) {
  return state.intents.filter(i => i.modelId === modelId && i.scene.modelVersionId === versionId &&
    state.runs.some(r => r.id === i.scene.runId && r.modelId === modelId && r.versionId === versionId && r.datasetId === datasetId))
    .flatMap(i => i.marks.flatMap((mark,index) => mark.kind === "range" || mark.kind === "bin" ? [{id:`${i.id}:${index}`,mark}] : []));
}
