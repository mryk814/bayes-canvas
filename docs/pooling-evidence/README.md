# 階層の共有先と群差の確認

2026-10-08、Windowsの専用productionサーバー `http://127.0.0.1:5236/` と `work/pooling-qa.json` をCodex内蔵ブラウザーで操作した。既存`test/seed-checks-demo.ts`の二例・prior生成32drawに、群0件表示用の合成Dataset/runを追加した。実MCMCや実データではない。

0件群fixtureは観測例の群添字2を1へ写し、群プレート3要素を保持したDataset `ds_f236e61631` と、元runのdrawを複写した `run_1d010c3577`（版 `ver_d3ce38ec95`）である。件数は12/24/0。変更後のデータへ再適合していないことをmethod/noteに明記し、既存の全fixture項目は追加前後で一致した。

- `groups-desktop.jpg`: 1265×712px。`bias[群] ~ Normal(0,tau_bias)`、共有中心0と全3群の5/50/95%点を同じ軸で表示。観測0行の群も残る。
- `groups-mobile.jpg`: 375×812px。狭幅の棒・数値の折返し・群SDの説明。
- `contrast-mobile.jpg`: 375×812px。群A=2、B=0、閾値5MPa。差の5/50/95%点は約−34.3483 / −1.8292 / 18.2592、超過7/32=21.875%（画面21.88%）。
- `table-mobile.jpg`: 375×812px。同じ条件で全drawの表を開き、矢印キーで右側まで横スクロール。共有中心と群SDを表示。
- `unsupported-desktop.jpg`: 1280×720px。曲線例のrunには対象群量がないことを表示し、pointを群に読み替えない。

狭幅のviewport指定は390×844で、上記は保存画像ファイルの実寸。指定値と画像実寸を混同しない。一時viewportは復帰済み。スクリーンショットの実際の符号化に合わせてjpgで保存した。ソースは `source-manifest.json` のSHA256で特定する。

量の選択、群と閾値変更、全32draw表、空閾値の拒否、旧v1の表示、run未選択の案内、世界との往復で条件保持を確認した。発言 `int_90f4d1823e` はnode/群A,B/観測件数/閾値/単位/差の区間/割合/全draw数/Dataset/version/run/methodを本文に、版runをsceneに保存し、ファイルとreload後の対話で確認した。表示操作はモデル・Dataset・runを変更しない。

100テスト・型検査・本体build成功。候補探索、scalar式、同drawの定差、厳密な閾値、0件群、参照不一致、非有限、非正SD、差のoverflow、観測依存の拒否を検証した。ラボの入力は変えておらず今回lab buildは再実行していない。本体buildの既存chunkサイズ警告は残る。

各量の区間は周辺区間であり同時90%領域ではない。共有中心への近さをpooling効果・縮約率と解釈しない。独立群モデルとの適合比較、pooling強度変更の再推論、実MCMC、実データ、Claude最新版との統合、スマホ実機、利用者評価は未実施。
