// Isolated synthetic evidence for the empty-workspace capsule import journey.
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { emptyState } from "../shared/contracts.ts";
import { createCapsule } from "../shared/capsule.ts";
import { seedChecksDemo } from "./seed-checks-demo.ts";

export function seedCapsuleDemo(path: string) {
  const target = resolve(path);
  const source = `${target}.source.json`, capsulePath = `${target}.capsule.json`;
  if ([target, source, capsulePath].some(existsSync)) throw new Error("既存ファイルは上書きしません。新しい検証用パスを指定してください。");
  const { examples } = seedChecksDemo(source);
  const example = examples.find(item => item.exampleId === "observation")!;
  const capsule = createCapsule(example.second, example.dataset, example.secondRun);
  writeFileSync(capsulePath, JSON.stringify(capsule, null, 2), { encoding: "utf8", flag: "wx" });
  writeFileSync(target, JSON.stringify(emptyState()), { encoding: "utf8", flag: "wx" });
  return { target, source, capsulePath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error("新規の検証データファイル名を指定してください。");
  console.log(seedCapsuleDemo(process.argv[2]));
}
