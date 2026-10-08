# 旧アプリの未コミット修正を保存する

`plate-axis-uncommitted.patch` は2026-10-08に以下のworktreeから読み取った差分の写し。元worktree・未コミット状態は変更していない。

- branch: `claude/blissful-cohen-efc55d`
- base: `c636a2ac15b043d212e16df0d3ed024f65f57340`
- source: `C:/Users/ootan/projects/bayes-canvas/.claude/worktrees/blissful-cohen-efc55d`
- 対象: `app/src/lib/authoringSnapshot.ts`、`app/src/lib/core/compiler.ts`、`app/test/core.test.mjs`

旧Canvasの `shape:[J]` と `plate:group` が別々の軸になり `J × GROUP` と二重計上される問題の修正と、疑わしい重複を `BC-SHAPE-004` として警告する変更。portable packageの往復テストも含む。

現行Possible Worldsはノードに一つの `plate` を持ち、旧 `shape` / `valueType.axes` / `axisId` は持たない。旧ファイルを復活させて適用することはしない。将来、旧形式の取り込みや多次元イベントを扱う場合の参考として残す。今回、旧アプリのテストや修正の正しさの検証は行っていない。

必要な場合は基点の別worktreeで `git apply --check` をしてから適用する。現行統合worktreeや保存元の未コミットworktreeへ重ねて適用しない。
