# 構造を使って計算を組み替える推論作業場

調査日: 2026-10-08。一次資料と `bayes-canvas-inference` の作業中ファイルを読み取り、変更はしていない。以下の「Inferences」はこのアプリへの提案であり、測定済み性能ではない。

## 1. ケースごとに何を変えると、研究中の操作を速くできるか

### Takeaway
最初に変えるのはエンジン名よりも、計算する変数と条件付き構造である。解析的に消せる部分を消し、残りだけを推論し、最後に同じ事後標本の中へ潜在変数を復元する。モデルの意味を保つ変換と、意味も変える探索用モデルを分ける。

### Cited Findings
- 自動周辺化を HMC と組み合わせ、PPL から抽出したグラフの構造を利用する研究があり、階層モデルでの改善を報告している。万能な自動推論選択が完成したという主張ではない。— [Lai et al., ICML 2023](https://proceedings.mlr.press/v202/lai23a.html)
- 有限離散変数は総和で消し、残った連続変数を推論できる。消した変数の確率や期待値は条件付き分布から回収でき、Rao–Blackwell 化によって標本効率を上げられる場合がある。— [Stan: latent discrete parameters](https://mc-stan.org/docs/stan-users-guide/latent-discrete.html)
- NumPyro の HMCGibbs は NUTS/HMC と任意の条件付き Gibbs 更新を組み合わせられるが、条件付き更新の正しさは実装者の責任。公開 stable 文書では実験的 API とされる。— [NumPyro MCMC](https://num.pyro.ai/en/stable/mcmc.html#hmcgibbs)
- Gaussian prior を持つ高次元ブロックには elliptical slice sampling という選択肢がある。ステップ幅調整を不要にする方式で、任意の prior や任意のブロックに適用できるものではない。— [Murray et al., AISTATS 2010](https://proceedings.mlr.press/v9/murray10a.html)
- **「個体ごとの latent があるから Laplace は不可能」は誤り。** INLA はまさに latent Gaussian の構造を利用する。Stan の embedded Laplace も Gaussian latent の条件付き事後を近似周辺化し、hyperparameter だけを別の方法で推論する。Gaussian likelihood なら解析周辺化を利用できる。— [INLA 公式](https://www.r-inla.org/whatisinla/), [Stan embedded Laplace](https://mc-stan.org/docs/reference-manual/laplace_embedded.html)
- 密な全変数 Laplace は次元 N に対し一度の行列分解が O(N³)、標本ごとが O(N²)。潜在数が多いことは不可能性でなく、計算量と局所正規近似の品質の問題。— [Stan Laplace](https://mc-stan.org/docs/reference-manual/laplace.html)
- Pathfinder は最適化経路上の Gaussian 近似を選び、複数経路と重要度再標本化を組み合わせる。直接の事後推論に不向きな近似でも MCMC の初期化には役立つ場合がある。— [Stan Pathfinder](https://mc-stan.org/docs/reference-manual/pathfinder.html)
- 現在の Claude 実装では `PLATED_LATENT` の有無だけで Laplace と平均場 ADVI を切り替え、docstring は latent があると joint mode が崩壊すると一般化している。これはこのアプリの暫定ルールとして明示すべきで、数学的な適用条件として固定すべきでない。— [作業中コード](C:/Users/ootan/projects/bayes-canvas-inference/inference/pw_numpyro.py:197)

### Inferences
- 小さな構造ルールを先に実装する。順序は「条件付き Gaussian の解析消去」「有限離散の列挙」「非中心化等の再パラメータ化」「適したブロック更新」「残りの汎用 NUTS」。自動生成された未知の専用コードを毎回主経路にする必要はない。
- 結果に `target: exact-model / surrogate-model` と `method: exact / asymptotic-mcmc / approximation / optimization` を別々に記録する。解析消去はモデルを変えない。代表データや固定 hyperparameter、プラグイン欠損補完、MAP のみは別の対象・不確実性である。
- 対応表は演算子名だけでなく「どの変数を消したか」「消せる理由」「復元分布」「モデル・データ・マスク・変換の digest」を持つ。最終 export は canonical model と変換レシピを含め、途中の高速モデル自体を最終モデルと取り違えない。
- BNN を含む複雑な機能を増やす前に、通常の最適化や線形代数を探索・初期化に使う経路を整える。MAP から描いた帯を posterior interval と呼ばないことだけは守る。
- embedded Laplace の導入は中期候補。まず既存の NumPy/JAX で exact Gaussian collapse を一つ実証する。INLA の R runtime や Stan 最新版をいま追加する必要はない。

### Gaps
- installed NumPyro の version と新しい Gibbs composite API の利用可否はこの調査では実行確認していない。stable 文書の API をそのまま現在の依存に仮定しない。
- latent Gaussian であっても非対数凹・多峰性・強い歪みなら局所近似が失敗し得る。現在の ModelSpec からこの条件を自動判定する網羅的解析は未実装。
- BNN・粒子法・離散連続混合を広くベンチマークする段階ではない。性能優位性は対象モデルと PC 上の測定が必要。

## 2. 速い結果を、どの検査を経て表示に使うか

### Takeaway
SBC、MCMC 診断、重要度診断、予測検査は別の境界を検査する。「合格」「正しい」を一つの boolean に潰さない。特に未検査、有限反復で問題未検出、検査失敗を区別する。

### Cited Findings
- SBC は検査する量によって検出できる誤りが変わる。parameter marginal のランクだけでは、データを無視して prior を返す実装すら見逃す場合がある。data-dependent な量、特に joint likelihood の追加が有用とされる。— [Modrák et al., SBC checking](https://arxiv.org/abs/2211.02383)
- Stan は final な利用には一般に Rhat < 1.01、4 chains、bulk ESS > 100×chain 数などを勧める一方、初期探索には緩い目安を認める。最終的には関心量の Monte Carlo standard error を必要精度と比べる。診断値が良いことを真の posterior の証明とは位置付けていない。— [Stan diagnostics and warnings](https://mc-stan.org/learn-stan/diagnostics-warnings.html)
- PSIS は提案分布の標本を target に合わせるための重要度重みを安定化し、k はその重みの裾と推定安定性を診断する。元の提案分布の無重み標本が target と一致したという証明ではない。— [Vehtari et al., JMLR 2024](https://www.jmlr.org/papers/v25/19-556.html)
- 現在の近似コードは p/q から k を計算するが、表示用には guide から改めて無重み標本を返す。したがって `k <= 0.7` は「この表示のバイアスが小さい」への十分条件にならない。— [作業中 fit_approx](C:/Users/ootan/projects/bayes-canvas-inference/inference/pw_numpyro.py:227)
- `approximationTrusted` は `paretoK == null` を true とする。診断が存在しない入力を未検査ではなく合格に送る境界になっている。— [作業中 compare.ts](C:/Users/ootan/projects/bayes-canvas-inference/shared/compare.ts:7)
- 現在の SBC は 40 反復、scalar parameter と各 plate の最初の最大3個、thinning 5、chi-square 検定の非棄却を pass とする。壊れた生成 world は skip される。— [ladder.ts](C:/Users/ootan/projects/bayes-canvas-inference/server/ladder.ts:27), [evaluate.ts](C:/Users/ootan/projects/bayes-canvas-inference/shared/evaluate.ts:13), [worker adapter](C:/Users/ootan/projects/bayes-canvas-inference/inference/pw_numpyro.py:156)

### Inferences
- まず文言と状態を直す。「計算完了」「検査不足」「この範囲で問題未検出」「問題あり」を最低限分ける。診断 null、chain不足、出力欠落は成功にしない。custom kernel に divergence概念がない場合は `not-applicable` とし、0回と偽装しない。
- 近似は淡い暫定帯とし、k は補助指標。PSIS 再重み付け/再標本化を実際に行うなら、重み ESS・Monte Carlo error・使用draw数も保持する。k が低くても有限標本が遠い mode を見ていない可能性は残るので、複数初期値と別方法の比較を併用する。
- NUTS を oracle と呼ばない。基準 NUTS 自身の diagnostics が不十分なら、方法差を「候補が間違い」ではなく「不一致、基準も未確定」と表示する。比較は同じ target/dataset/missingness/estimand に限定する。
- SBC の label は「40反復で異常未検出」。採用前に failure injection を行う: priorを返す・データ一部を無視・varianceを縮める・joint covarianceだけ壊す、を検査が落とせるか。parameter・予測量・log likelihood・関心量を揃える。固定 thinning のみで独立性が確保されたとは見なさない。
- 生成失敗を黙って除外すると SBC の対象 prior predictive が条件付きになる。失敗数・理由・分母を出し、必要反復不足と生成器の問題を分ける。
- 推論成功とモデル適合を分ける。完全な exact posterior でも欠損機構・selection・構造の仮定が間違えば欲しい問いに答えない。held-out score はモデル検討の証拠であり、同じ target を解く inference algorithm の正しさの単独判定には使わない。

### Gaps
- 現コードの独自 `psis_khat` を既知実装に対して検証していない。等しい log weights、全 weight 0、有効 weight少数、極端値のケースを優先して照合すべき。
- 現在の NumPyro summary が返す Rhat/ESS を rank-normalized bulk/tail と同一と仮定しない。実装版を確認した上で診断の名前・意味を記録する必要がある。
- 40反復の各検査がどれだけ小さな誤りを検出できるかの power は未測定。非棄却を保証へ格上げできない。

## 3. 研究 PC で次に何を実験するか

### Takeaway
最初の実験は、欠損と群サイズ不均衡のある Gaussian 反復測定を、joint の直接解と解析周辺化＋条件付き復元で同じ結果へ到達させること。機能を増やすより、元の意味を保って速くする一例と、依存関係を壊した実装を見抜く検査を完成させる。

### Cited Findings
- NumPyro `jit_model_args=True` は同じ shape のデータ変更に再コンパイルを避ける仕組みだが、公開文書では複数chainの parallel mode に制限がある。`post_warmup_state` は sampling継続に使えるが、新データへの warmup は明示的にやり直す。— [NumPyro MCMC](https://num.pyro.ai/en/stable/mcmc.html)
- 現実装は長寿命 Python worker で import を節約する一方、fit ごとに module を読み込み MCMC を作り直し、1 jobずつ処理、モデル版変更で worker を停止する。性能を ESS/sec 一つで測るとこの周辺時間やキャンセル費用を見落とす。— [worker.py](C:/Users/ootan/projects/bayes-canvas-inference/inference/worker.py), [ladder.ts](C:/Users/ootan/projects/bayes-canvas-inference/server/ladder.ts), [pw_numpyro.py](C:/Users/ootan/projects/bayes-canvas-inference/inference/pw_numpyro.py:114)
- Gaussian likelihood の latent Gaussian は解析周辺化でき、復元には hyperparameter と latent を同じ反復で結ぶ二段階 sampling を利用できる。— [Stan embedded Laplace](https://mc-stan.org/docs/reference-manual/laplace_embedded.html)

### Inferences
- **限定実験契約**: `mu ~ Normal(m0,s0)`、`theta_g | mu ~ Normal(mu,tau)`、`y_gj | theta_g ~ Normal(theta_g,sigma)`。`tau, sigma, m0, s0` は既知。mu と全 theta の joint posterior を出力。欠損は「観測されなかった likelihood contribution を除く」だけで、MNAR を解決したとは言わない。
- 手法 A: 全 joint precision を構築し線形方程式を解いて mean/covariance を得る。手法 B: theta を積分し、群平均の分散 `tau² + sigma²/n_g` で mu の posterior を求め、同一 mu draw に条件付けて全 theta を復元する。ゼロ観測群は mu draw に prior の Gaussian noise を足す。群ごとに独立 mu を引き直してはいけない。
- fixtures: 群サイズ 0/1/2/7/50、途中の欠損、全欠損群、群名の並べ替え、全観測なし。既知の tau/sigma の幅を数条件。mean/cov の解析値を浮動小数精度で比較し、有限drawの共分散は固定seedと標準誤差に配慮した許容で検査する。
- failure injection: 各 theta の marginal mean/variance だけを合わせて独立に引く壊れた復元を用意する。marginal検査は通っても mu–theta/群間 covariance と差の variance が落ちることを示す。これが SBC の量選びを具体的に説明する教材になる。
- 依存は NumPy と Python標準 unittest。アプリとは独立の `experiments/research-inference/` に契約→RED→実装→GREENを残す。新ランタイム・外部サービス不要。未知hyperparameter・非Gaussian・MNARは非対応を明記する。
- 測定は cold/import、準備、solve、draw、検査、初回表示可能時刻を分ける。MCMC を比較する将来段階では warmup込み latency と関心量の MCSE 到達時間を主とし、ESS/sec は補助。少数例の速さを一般化しない。
- UIへの引き渡し候補: 「探索中」「近似を表示」「検査中」「検査された結果」「方法差あり」の状態、前の結果を保持して新しい版を薄く比較、変更を止めてから重い計算を開始、優先ジョブのために評価ジョブを後回しにする。研究者が一つの計算待ちで操作を止めない設計を狙う。
- warm start は target/変換/shape/支持が互換な場合に候補初期値として使う。以前の posterior を新しい target の証拠として流用しない。遠い初期点からの chain も残し、局所解固定を検出する。

### Gaps
- 追記: 限定実験を [README](../../experiments/research-inference/README.md) / [結果JSON](../../experiments/research-inference/results.json) として実装・実行した。6テストRED→GREEN、mean/covariance/log evidence は4.3e-14以下で一致し、独立復元の誤りを検出。本体接続と未知hyperparameter推論は未検証。
- cold/startup/JIT と標本生成を含む実PCの性能は未測定。既存workerの長寿命化だけでコンパイルキャッシュが再利用されるとは保証できない。
- 途中と最終コードの同値性を一般に自動証明する仕組みは未提案。まず限定変換ごとの解析式と回帰テストで範囲を明示する。
