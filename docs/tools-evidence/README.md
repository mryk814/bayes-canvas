# 本体接続の画面検証（2026-10-08）

`codex/experience-lab` の今回の本体接続を、独立したproduction buildと `http://127.0.0.1:5231/` で確認した。元のClaude作業ツリー・データ・サービスは変更していない。

`test/seed-tools-demo.ts` が作る合成データのみを使用。drawはpriorから生成し、診断値は表示検証用の手作り値。画面のmethodにも「UI検証fixture・推論未実行」と明示している。実推論の妥当性を示す証拠ではない。

|画像|確認した状態|
|---|---|
|joint-desktop.png|1265px幅。bias[1]>0 AND sigma_meas>5、11/32、標本2、発言の保持|
|joint-mobile.png|390px幅。同じ条件・発言、矢印キーで標本2へ移動。全ページ画像|
|diagnostics-mobile.png|390px幅。Rhat1.08、ESS120、発散3に対する次の確認。全ページ画像|
|csv-desktop.png|1265px幅。単位換算・群対応と保存確認の最終表示|
|csv-mobile.png|390px幅。同じ確認表とチェック・保存ボタン|
|capsule-mobile.png|390px幅。異なるdataset参照を拒否する結果|

全ページ画像には撮影時スクロール位置のstickyヘッダーが含まれる場合がある。通常のviewport画像でもピクセルを直接確認した。ブラウザーの一時サイズ指定は終了後に解除した。

`source-manifest.json` は最終ソースとfixture生成器のSHA256を記録する。joint/diagnostics画像の後に加えた変更はImportCsvの表・確認ラベル・保存ボタンと、その専用CSSのみで、joint/diagnosticsの表示条件は変わっていない。CSVとcapsule画像はその最終buildで撮影した。

操作結果と未検証範囲は [実装記録](../ledger-implementation.md) を参照。旧 `docs/lab-evidence/` は先行ラボcommit `58badca` の歴史的証拠であり、この本体接続の検証とは別。
