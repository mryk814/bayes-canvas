# main集約の記録（2026-10-08）

旧アプリを残したmainから、Possible Worlds本体・推論エンジン・問いの道具・研究用検証台を同じブランチに集約する。統合ブランチは `codex/main-integration`。最終マージは利用者が行う。

## 対象と保存

- 基点: `main` / `origin/main` の `c636a2ac15b043d212e16df0d3ed024f65f57340`。
- `claude/inference-engine` の `f70c2be` を土台にする。`claude/possible-worlds` と `claude/model-lens-prototype` はこの履歴に含まれる。
- `codex/experience-lab` の `4e0c7343fa53f3b5b9ed1cc911dd3cff86f94545` をマージする。未取り込みだったpriorの道具、研究用検証台、専門家ペルソナを含む。
- 元の各worktree・実データ・稼働サービスには変更を加えない。旧アプリの未コミット修正は元worktreeを保持し、基点付きパッチとして別途保存する。現行ModelSpecには旧shape/axisの契約がないため適用しない。
- 旧 `app/`、旧仕様書、旧CIは作り直しの履歴で削除されている。統合時に新しいGitHub Actions workflowは追加しない。旧版はmain基点の履歴から復元できる。

## 統合時の修正契約

READMEと台帳は推論エンジンと先行実装の両方を記録し、過去の検証件数と統合後の検証を区別する。本体未接続の研究部品を接続済みとは記さない。

推論ジョブの履歴制限で実行中・待機中のジョブを削除しない。activeジョブは全件保持し、終了済みの履歴だけを直近60件に制限する。これにより進行中の結果の破棄と並列起動を防ぐ。対象回帰テストを修正前に失敗させ、修正後に確認する。

ローカルAPIはloopback Hostだけを受け、ブラウザの別Originとcross-site要求を拒否する。変更要求はapplication/jsonを必須にする。Originを送らないローカルMCP/CLIは従来どおり利用できる。これは他サイトからの意図しない呼び出しを防ぐ境界であり、ローカルプロセスの認証やPythonコードのsandboxではない。任意ホストのリバースプロキシ公開はこのローカル契約に含めない。

## 検証状況

- 統合直後: Node 166テスト、型検査、本体build、lab build、Gaussian研究実験のPython 6テスト成功。本体buildには既存の500 kB超chunk警告がある。
- ジョブ保持2件・HTTP境界1件を追加し、各RED→GREENを確認。修正後はNode全169テストと型検査が成功。フロントと研究Pythonの入力は修正で変えておらず上記build/6テストの結果を再利用する。
- 現行codegenで作った合成曲線15点のモデルを実NumPyro workerへ渡し、同一常駐プロセスで近似→NUTSの完了、必要4サイトの有限draw、version/dataset参照を確認。短い2鎖×32drawではRhatが241249で非収束。既定相当の4鎖×1000draw・warmup1000では最大Rhat 1.00356・最小ESS 597.8・発散0となった。[データ・診断値・ソースhash](integration-evidence/README.md)。この合成例の出力契約と診断を確認したもので、他モデルの推論品質を保証しない。
- 専用合成Store、loopbackの5245番で本体を起動。実データと既存5211番のサービスは使用しない。
- 内蔵ブラウザの作成は `Browser is not available: iab`。Codexパネルへの表示要求はqueuedで、画面・操作は未観測。GUI検証完了とは呼ばず、PRはDraftのままにする。
- 実際のClaudeとの会話、実データ、スマホ、デプロイは今回の検証には含めない。
