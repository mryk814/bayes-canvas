# 潜在量を消してから戻す、小さな検証実験

研究の途中では同じモデルを違う計算で解いてよい。ただし、見えている各量の平均だけでなく、量どうしの関係まで同じ結果である必要がある。この実験はその境界を確認する。

## 契約

`mu ~ Normal(m0,s0)`、`theta_g | mu ~ Normal(mu,tau)`、`y_gj | theta_g ~ Normal(theta_g,sigma)`。分散成分 `tau,sigma` と prior の `m0,s0` は既知。入力は群ごとの観測リストで、`None` は欠測として尤度から除く。ゼロで埋めない。空の群と全欠測群も theta を残す。欠損機構をモデル化していないため、MNARへの対応ではない。

同時分布の直接解は `mu,theta_1,...` の精度行列を構築する。周辺化解は theta を積分して mu の事後を求め、各 mu draw に条件付けて全 theta を復元する。どちらも posterior mean、joint covariance、観測データの log marginal likelihood を返す。dense の逆行列を明示的に作らず線形方程式を解く。

検査する条件は群サイズ不均衡、途中の欠損、観測ゼロ群、全観測ゼロ、群順序変更、異なる既知分散。間違った独立復元は各 marginal が合っていても joint covariance で検出する。2つのseedで標本復元を検査する。

## 実行

リポジトリ直下から:

```powershell
rtk uv run --with numpy python -m unittest discover -s experiments/research-inference -p "test_*.py" -v
rtk uv run --with numpy python experiments/research-inference/gaussian_collapse.py --report experiments/research-inference/results.json
```

依存は NumPy と Python 標準ライブラリだけ。合成データのみを使い、アプリの保存データを読まない。出力JSONには入力、seed、Python/NumPy版、数値誤差、測定範囲を保存する。計測は import 後の処理でありアプリ操作時間ではない。

## 限界

未知分散、非Gaussian、打ち切り、選択バイアス、実データ一般を解ける実装ではない。既存のNUTSやClaudeの専用推論を置換しない。小さな数値照合が通ることと、大規模計算で速いこと、本体への接続、GUI品質は別の検証である。

## 今回の検証結果

2026-10-08、契約と6テストを先に追加し、実装モジュール欠落の `ModuleNotFoundError` で RED を確認。その後実装を追加し、6テストすべて GREEN（0.921秒）。[results.json](results.json) は別途スクリプトを実行した数値結果。

- 解析 mean の最大差 `4.44e-16`、joint covariance の最大差 `1.11e-16`、log marginal likelihood の差 `4.26e-14`。
- seed 17 / 913、各160,000 drawsの条件付き復元を検査。テストの最大絶対許容は mean 0.012、covariance 0.022。有限標本検査だけでなく上記解析照合も行う。
- 独立復元という意図した誤りは marginal mean/variance 検査を通る一方、観測ゼロ群どうしの covariance が正解 `1.3333` に対して `-0.00525` になり検出された。
- import 後に30回反復した solve＋evidence の中央値は直接解0.129ms、周辺化解0.106ms。この小例の測定は優劣の根拠にしない。直接解側は照合用の密な観測 covariance の計算も含み、仕事量が同じではない。

Claude側へ渡すときは `joint()` を独立な解析 reference、`recover()` を drawの依存関係を保つ例、`independent_recovery()` を故障注入として使える。最後の関数は意図的に間違った教材なので本体の推論には使わない。
