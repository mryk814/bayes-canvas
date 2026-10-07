# Possible Worlds

ベイズモデルの prior を数値で入力せず、**そこから生まれる世界を見て、指して、話す**ことでモデルを育てるローカルアプリ。
AI（Claude Code）は MCP を通じて同じ世界を数値で読み、先輩の言葉を「意味の候補」と「モデル変更の提案」に翻訳する。確定するのは常に人。

```text
世界を見る → 指す（あり得ない／なぞる／範囲）と一言 → Claude が意味の候補を返す
→ 人が選ぶ（知識として残る）→ 変更提案を同じ seed で比べる → 採用すると新しい版
```

## 起動

```bash
npm install
npm run dev
```

`http://127.0.0.1:5199/` を開く。本番ビルドで使う場合は `npm run build` のあと `npm start`。

## Claude Code とつなぐ

このフォルダで Claude Code を開くと、`.mcp.json` の `worlds` サーバー（`bridge/mcp.ts`）が起動を求められる。許可すればツールが使える。

- **引き取り方式（どこでも動く）**: アプリで「Claude に渡す」を押したあと、Claude Code に「Possible Worlds に届いた意図を見て、候補を返してください」と送る。
- **自動で届ける方式（CLI・研究プレビュー）**: 次のように起動すると、意図を送った瞬間にセッションへ通知が入る。

  ```bash
  claude --dangerously-load-development-channels server:worlds
  ```

Claude が使えるツールは `worlds_overview` / `worlds_pending_intents` / `worlds_sample` / `worlds_reply` / `worlds_propose_model` の5つだけ。**読むことと提案することしかできず、採用・却下・版の巻き戻しはアプリの画面からだけ行える。**

## 三種類の操作を混ぜない

| 操作 | 例 | 保存のされ方 |
|---|---|---|
| 表示の変更 | 別の世界を引く、重ねて見る、観測点の表示 | 保存しない。モデルは変わらない |
| 知識の表明 | 「あり得ない」、なぞり線、範囲、一言 | 意図として送り、候補を選んだ時点で知識になる |
| モデルの変更 | prior や式の変更 | 提案として届き、採用したときだけ新しい版になる |

なぞり線は人の身振りであり、観測データとしては扱わない。表示中の世界には「prior からの世界・実データではありません」と身分を出している。

## データ

- 正本: `data/worlds.json`（`WORLDS_DATA` で変更可）。書き込みは一時ファイル経由で置き換え、直前の状態を `worlds.json.bak` に残す。
- 読めないファイルがある場合は上書きせずに起動を止める。
- 画面右上の「書き出す」で全体を JSON として保存できる。別の端末へ移すときはこのファイルを `data/worlds.json` に置く。
- 書きかけのメモと seed はブラウザの localStorage に残る（失われても正本には影響しない）。

## 構成

```text
shared/   契約（zod）、安全な式言語、seed 付きの前方シミュレーション、意味の差分
server/   正本の保存と HTTP API（/api/human/* と /api/agent/*）、変更の通知（SSE）
bridge/   Claude Code が起動する MCP ブリッジ（状態を持たず、サーバーへ中継する）
src/      React の画面（世界の劇場、メモ、対話、提案、知識、版）
test/     契約と保存の流れのテスト
```

主なライブラリ: React 19 / Vite 8、`@modelcontextprotocol/sdk`、zod 4、d3-scale・d3-shape（軸と線。描画は自前の SVG）、perfect-freehand（なぞり線を手描きの筆致にして、データの線と見分けられるようにする）、motion、KaTeX、Tabler Icons、Fontsource。

## 検証

```bash
npm test
npm run typecheck
npm run build
```

## いまの限界と次の一歩

- モデルは「x に対する1本の曲線＋ノイズ」に限る。階層、複数の説明変数、離散データは未対応。
- 推論（posterior）は持たない。prior からの前方シミュレーションだけで成立する範囲に絞っている。
- 次に試したいこと: 同じ操作の文法で「観測点を開く」（測定誤差と個体差を分ける）を2例目として作る。送ったしるしを世界の上に残す。候補の確認に短い動く比較を入れる。
