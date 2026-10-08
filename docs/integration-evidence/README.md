# 統合時の実worker検査

2026-10-08、Windows、Python 3.13.5、NumPyro 0.22.0、JAX 0.11.2、NumPy 2.5.3で実施。`source-hashes.json` は実行したcodegen・worker・推論ライブラリ・模式例のSHA-256。統合commit前の実ファイルを基準とする。

`dataset.json` は合成曲線15点。`CURVE_EXAMPLE` を `numpyroScript` で生成し、version `integration-smoke-synthetic-v1` とdataset `synthetic-curve-smoke` を指定した。実データは使っていない。

- `summary.json`: 同一workerに近似（seed17、keep64、check_draws256）とNUTS（seed17、2鎖×32draw、warmup32、keep64、target_accept0.9）を順に投入。READY→DONE approx→DONE nuts、exit0、stderr空、必要4サイトの有限drawとID整合を確認。短いNUTSの診断は非収束。
- `full-summary.json`: 同じ合成データでNUTS（seed17、4鎖×1000draw、warmup1000、keep400、target_accept0.95）。最大Rhat1.00356・最小ESS597.8・発散0。短い試走の極端なRhatは通常設定では再現しなかった。

ローカルの実行スクリプトと生出力は無視対象 `work/integration-inference/` に保持した（`rtk node work/integration-inference/smoke.ts` / `full-smoke.ts`）。Gitには合成入力・要約・ソースhashを保存する。workerは `rtk uv run --with numpyro --with jax python inference/worker.py` の標準入力へ、method/options/script/dataset/outを持つJSON行を受ける。再実行には現行codegenによるmodel.py生成が必要。

GUI、実際のClaude、Ladder経由の自動起動、ADVI、custom algorithm、SBC、科学的妥当性はこの実worker検査の対象外。ジョブ制御とAPI/保存は別途Nodeテストで確認した。
