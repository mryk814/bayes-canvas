# Possible Worlds

ベイズモデルの prior や事後分布を、数値ではなく**そこから生まれる世界を見て、指して、話す**ことで育てるローカルアプリ。
AI（Claude Code）は MCP を通じて同じ世界を数値で読み、人の言葉を「意味の候補」と「モデル変更の提案」に翻訳し、推論も実行する。モデルを確定するのは常に人。

```text
世界を見る → 指す（あり得ない／なぞる／範囲／観測点を開いて層を指す）と一言
→ Claude が読み方の違う候補を返す → 人が選ぶ（知識として残る）
→ 変更案を同じ seed で比べて採用 → 新しい版 → Claude が Stan / NumPyro で推論
→ 事後予測の世界をデータと並べて、また指す
```

## 起動

```bash
npm install
npm run dev
```

`http://127.0.0.1:5199/` を開く。本番ビルドで使う場合は `npm run build` のあと `npm start`。

## Claude Code とつなぐ

このフォルダで Claude Code を開くと `.mcp.json` の `worlds`（`bridge/mcp.ts`）が起動を求められる。許可すればツールが使える。

- **引き取り方式**: アプリで「Claude に渡す」を押したあと、Claude Code に「Possible Worlds に届いた意図を見て、候補を返してください」と送る。
- **自動で届ける方式（CLI・研究プレビュー）**: `claude --dangerously-load-development-channels server:worlds` で起動すると、送った瞬間にセッションへ通知が入る。

Claude が使えるツールは読む・提案する・証拠を付けるものだけ（`worlds_overview` / `worlds_pending_intents` / `worlds_sample` / `worlds_reply` / `worlds_propose_model` / `worlds_attach_dataset` / `worlds_synthesize_dataset` / `worlds_prepare_inference` / `worlds_attach_run`）。**採用・却下・巻き戻しはアプリの画面からだけ。** ファイルの読み書きは `work/` に限る。

## モデル：生成プログラム

モデルは PPL に依存しない生成プログラムとして保存する。

- `plates`: 添字の集合（試料、試験機…）と既定の大きさ
- `data`: 既知の入力。添字の列は `indexOf` で別のプレートを指す（0 始まり）
- `nodes`: 生成順のノード。`param` / `latent` / `deterministic` / `observed`。分布の引数は式。別プレートの値は `bias[machine_of]` のように読む。観測には `censorAbove`（記録上限による打ち切り）を付けられる
- `view`: 世界の描き方（x, y, 線, 群）

prior の世界はこのプログラムを前方シミュレーションして作る。run を見ているときは「識別性」に切り替えると、データが絞った量・prior のままの量・一緒に動く組と、その尾根の両端にある「同じ記録を作る二つの世界」を見られる（`shared/identify.ts`、`src/Lens.tsx`）。「形」では、観測の平均やばらつきがモデル上で x に沿ってどんな形かを関数の束で見せ、その上に信じる形をなぞれる。run があれば区間ごとの事後予測チェックも出す（`shared/shape.ts`、`src/Shape.tsx`）。事後予測の世界は run の joint draw でパラメータと潜在変数を固定し、観測だけを再シミュレーションする。

例は2つ。「温度と強度の曲線」と、試料・試験機・記録上限を通って値が記録される「観測点を開く」。後者では点を押すと、記録 → 測定誤差 → 試験機の偏り → 真の強度 → パラメータ → 既知の入力、の層が開き、層を指して送れる。潜在の層は prior では「仮説の値」、事後では「draw の推定」と表示し、真値とは呼ばない。

## 推論

アプリは推論の道具を内製しない。手元の NumPyro（と、検証用に CmdStan）に任せる。

### 裏で育つ事後分布

モデルの版かデータが変わると、サーバーが自分で事後分布を計算する（`server/ladder.ts`）。NumPyro のワーカー（`inference/worker.py`）を 1 つ常駐させ、JAX の読み込みは最初の 1 回だけにする。

1. **速い近似**。モデルの形で選ぶ
   - 試料ごとの潜在変数がないモデル：**ラプラス近似**（BFGS で最頻値、そこでのヘッセ行列で正規近似）
   - 潜在変数があるモデル：**平均場 ADVI**。結合事後分布の最頻値は「測定誤差 → 0」に崩れるので、ラプラス近似は原理的に使えない
   - どちらも重要度重みの **Pareto k** で検査し、0.7 を超えたら記録だけ残して表示に使わない
2. **NUTS**（4 chain）。診断（R̂・ESS・発散）と、近似とのずれを警告として付ける

「見る世界」を「自動」にすると、いまの版のいちばん確かな結果を表示し、計算が進むとその場で差し替わる。上部バーに計算の段階と経過時間、推論タブにジョブの一覧（一時停止・やり直し）が出る。版がさらに変わると古い版のジョブは止まる。`WORLDS_AUTO=0` で止められる。作業ファイルは `work/auto/`。

実測（このリポジトリの例、Windows・CPU）:

| モデル | 近似 | NUTS |
|---|---|---|
| 曲線（潜在変数なし） | ラプラス 11 秒・Pareto k 0.54（NUTS とほぼ一致） | 17 秒 |
| 観測過程・繰り返し測定つき | ADVI 18 秒・Pareto k 0.99（信用できないので表示しない） | 39 秒 |
| 同じモデルを Stan で | Pathfinder 25 秒・Pareto k 2.7 | 75 秒（コンパイル込み） |

### 手で走らせる・Stan で確かめる

別の設定や書き出し先で走らせたいときは、Claude Code が `worlds_prepare_inference`（既定は NumPyro、`backend: "stan"` で CmdStanPy）で書き出したプログラムを実行し、`worlds_attach_run` で結果を戻す。NumPyro の書き出しは `model.py` と `pw_numpyro.py`（`--method approx|nuts`）。Stan は版ごとにコンパイルが要るので、自動の階段には使わず、別の PPL による最終確認として使う。

### Stan の準備（Windows・任意）

CmdStan は C++ ツールチェーンが要る。`%USERPROFILE%\.cmdstan` に入れる。

```powershell
uv run --with cmdstanpy python -m cmdstanpy.install_cxx_toolchain
uv run --with cmdstanpy python -m cmdstanpy.install_cmdstan
```

cmdstanpy 1.x の RTools インストーラ呼び出しは失敗することがある。その場合は `%USERPROFILE%\.cmdstan\RTools40.exe` を `/DIR="%USERPROFILE%\.cmdstan\RTools40"` 付きで直接実行し、`RTools40\usr\bin\bash.exe -lc "pacman -Sy mingw-w64-x86_64-make --noconfirm"` のあと `cmdstan-<版>` で `mingw32-make build` する。`run_stan.py` は実行時に RTools を PATH に足す。Git Bash では `HOME` の形式で cmdstanpy が迷うので PowerShell から実行する。

## 三種類の操作を混ぜない

| 操作 | 例 | 保存のされ方 |
|---|---|---|
| 表示の変更 | 別の世界を引く、prior と run の切り替え、重ねて見る | 保存しない。モデルは変わらない |
| 知識の表明 | 「あり得ない」、なぞり線、範囲、層を指す、一言 | 意図として送り、候補を選んだ時点で知識になる |
| モデルの変更 | prior、観測過程、階層の変更 | 提案として届き、採用したときだけ新しい版になる |

データセットと run は証拠であり、モデルを変えない。

## データ

- 正本: `data/worlds.json`（`WORLDS_DATA` で変更可）。書き込みは一時ファイル経由で置き換え、直前を `.bak` に残す。読めないファイルは上書きせず起動を止める。
- `possible-worlds@1` のファイルは読み込み時に `@2` へ移行し、次の変更で書き戻す（`@1` は `.bak` に残る）。
- 「書き出す」で全体を JSON として保存できる。
- 推論の作業ファイルは `work/`（git 管理外）。

## 構成

```text
shared/   契約（zod）、式言語、前方シミュレーションと観測点の解剖、意味の差分、Stan / NumPyro への書き出し
inference/ NumPyro の推論（pw_numpyro.py：ラプラス / ADVI / NUTS と Pareto k、worker.py：常駐ワーカー）
server/   正本の保存、移行、HTTP API（/api/human/* と /api/agent/*）、変更の通知（SSE）
bridge/   Claude Code が起動する MCP ブリッジ（状態を持たず、サーバーへ中継する）
src/      React の画面（世界の劇場、観測点の解剖、メモ、対話、提案、知識、推論、モデル）
test/     契約・シミュレーション・書き出し・保存の流れのテスト
```

主なライブラリ: React 19 / Vite 8、`@modelcontextprotocol/sdk`、zod 4、d3-scale・d3-shape、perfect-freehand、motion、KaTeX、Tabler Icons、Fontsource。

## 検証

```bash
npm test
npm run typecheck
npm run build
```

## 確かめたこと

`work/scenario.mjs` で、実際の HTTP API（人の側）と MCP ブリッジ（Claude の側）を通して次を通した。

1. 「試験機 C だけ高温で測定が揺れる」真の過程から合成データ 60 本を作る（モデルはそれを知らない）
2. v1 を推論 → 個体差と測定誤差が識別できず失敗（R̂ 1.33、発散多数）。それも run として残す
3. 事後予測の世界で高温・試験機 C の点を開き、測定誤差の層を指して「熱くなると不安定。校正では 5 MPa くらい」
4. Claude が4つの読み方を返し、「校正値＋試験機ごとの高温での揺れ」を選んで v2 に。v1 の run は旧版になる
5. v2 を Stan と NumPyro で推論 → Stan で R̂ 1.003・ESS 656・発散 2。両者の事後はほぼ一致し、真の値（測定誤差 5、試験機 C の上乗せ約 40）を区間に含む。C だとはモデルに書いていない
6. 識別性のレンズ（run を見ているとき「識別性」）で v1 を見ると、個体差と測定誤差の尾根（ρ = −0.77）と、中身は違うのに記録がほぼ同じ二つの世界が出る。v2 では尾根が消える代わりに測定誤差が「prior のまま」（縮み 4%）と出て、校正の知識が値を決めていることが分かる
7. その組を指して「2 回ずつ測った記録がある」と伝えると、Claude が「測定」プレートを足す構造変更を提案。採用した v3 と繰り返し測定つきの合成データ（100 記録）を Stan で推論すると、校正の prior なしで尾根が消え、個体差 13.0 [10.2, 15.7]（真 12）・測定誤差 3.0 [0.8, 7.2]（真 5）に分かれる。試験機 C の揺れは 24.9 [17.3, 33.6] と真の約 40 より小さく、関数形の仮定（20°C から直線）と真の形（150°C から増える）の違いが残っている
8. 「形」でその違いを指す。区間ごとの事後予測チェックではデータの点が少なく形を言えない（外れは 1 区間で、問題のない試験機 A にも偶然の外れが出る）。そこでモデルのばらつきの帯の上に「150°C まで平ら、そこから増える」をなぞり、「ヒーターが 150°C で入る」と送る。Claude が 3 つの関数形を返し、揺れ始めの温度を推定する折れ線（prior 150 ± 15°C）を採用した v4 では、100°C の上乗せが 0.0（v3 は 7.1）、300°C が 30.0 [21.5, 43.1]（真 40 を含む）、揺れ始めは 144.6 [123, 163]。揺れ始めの縮みは 32% で、形を決めたのは主に人の知識

## 調査資料との対応

元になった調査資料（2026-10-07 の補遺と前 Atlas）のどこまでを実装したかは [`docs/research-ledger.md`](./docs/research-ledger.md) に台帳として記録している。機能を足したら台帳も更新する。

## いまの限界

- 1ノードは1つのプレートにだけ載る（交差したプレート、行列・GP・常微分方程式などは未対応）
- 離散の潜在変数は NUTS 系では扱えない（警告を出す）
- 事後の世界は run に保存した draw（既定 400）から描く
