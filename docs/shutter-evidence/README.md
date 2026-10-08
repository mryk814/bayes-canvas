# 観測のシャッターの実画面確認

2026-10-08、分離worktree `codex/experience-lab` のproduction buildをWindowsのloopback 5234番で起動し、Codex内蔵ブラウザーで操作した。保存先は専用合成fixture `work/shutter-qa.json`。元のClaude作業ツリーや実データは使用していない。ソースは `source-manifest.json` のSHA256で特定する。

- `comparison-desktop.png`: 1265×712、観測モデル旧v1、run `run_29a8532602`、seed=1、draw index=0、一定上限400MPa。36行の上限前・元記録・試した記録を共通軸で表示し、打ち切り0/2/7行。
- `extreme-desktop.png`: 同じ証拠に上限-1.79e308を指定。極端な有限値でも目盛りの負号を保持。
- `controls-mobile.png` / `comparison-mobile.png`: 390×844で操作欄、旧版表示、縦並びの比較図。スライダーの矢印キー操作と数値400への復帰を確認。
- `table-mobile.png`: 390×844、全行表を開き横スクロールした状態。表は横に続く。
- `curve-desktop.png`: 上限のない曲線モデルv2、prior、seed=1、index=0。上限400で15行中12行の打ち切りを確認した後、元に戻し3図とも15行・打ち切り0行。
- `nearby-ticks-desktop.png` / `nearby-ticks-mobile.png`: 専用モデル `mdl_bb493f8c7e`、版 `ver_596f6a6198`、prior、seed=1、index=0。横軸1e9〜1e9+100の15点とNormal(500,10)の観測。近接した大値のラベルを間引き、1265px/390pxとも重なりなく区別できることを確認。点と軸範囲は変えていない。

上限350→400で元の測定値・行・群が全36行不変、元へ戻すと記録も一致することを確認した。旧runの次draw→前drawで値が復元され、旧版を現行版で置換していない。空seedは説明を出して比較・保存を停止した。

試験用発言を既存intentとして保存し、世界との往復とreloadで保持された。version/run/Dataset/seed/index/capが本文とsceneに残った。保存前後でintent以外の状態のSHA256は `0ED12AC9E74180B48951B45D80C451BE54FC415998F54CC4C027DD8152B8973F` と一致した（各プロパティからintentsを除きPowerShellのJSONへ変換して比較）。

最終90テスト、型検査、本体build成功。buildの既存大容量chunk警告は残る。描画不能な軸幅の停止は単体テストで確認し、その状態の実画面は未確認。runはpriorから生成した32drawの操作fixtureで、実推論の検証ではない。実データ、Claude未コミット実装との統合、スマホ実機、利用者評価は未実施。観測過程全体の完了を意味しない。

レビューで横軸ラベルの重なりを追加修正した。最終buildで通常比較と近接大値を再撮影し、他の画像は目盛り選択・描画条件が変わらない範囲の証拠として再利用している。追加検証モデルは非intent状態の前後一致確認より後に作成し、既存fixture項目が不変なことを別途確認した。
