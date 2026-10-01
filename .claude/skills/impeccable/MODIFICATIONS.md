# 元のリポジトリから変えたところ（Modifications）

このフォルダは Impeccable（https://github.com/pbakaus/impeccable 、Apache License 2.0、
コミット c74755d・v4.4.0）の `.claude/skills/impeccable/` を、ポケカファクトリーのリポジトリに入れたものです。

This directory is a copy of `.claude/skills/impeccable/` from Impeccable
(https://github.com/pbakaus/impeccable, Apache License 2.0, commit c74755d, v4.4.0).

## 変えたところ / Changes
- `scripts/` を丸ごと外しました（外部のプログラムをダウンロード・実行しないため）。中身は、点検用のプログラム（engine）をGitHub Releases からダウンロードして動かすランチャー（`impeccable`・`impeccable.cmd`）と、そのプログラムが使うファイルです。
  Removed the whole `scripts/` directory (the `impeccable` / `impeccable.cmd` launcher that downloads and runs the engine binary from GitHub Releases, and the files the engine uses), so that no external program is downloaded or executed.
- `SKILL.md` の「## Setup」の直前に、「このリポジトリでは `scripts/` がないので、ランチャーを動かさず、元からある “Launcher unavailable” の手順（PRODUCT.md・DESIGN.md を直接読む）で進める。`reference/` の中のランチャーを使う手順は飛ばす。CLAUDE.md を優先する」という注記（英語）を足しました。
  Added a note (in English) just before "## Setup" in `SKILL.md`: the launcher is absent in this repository, so skip Setup step 1 and use the existing "Launcher unavailable" path; skip any step in `reference/` that runs a `scripts/impeccable` command; the repository's CLAUDE.md takes precedence.
- `reference/` のファイルは変えていません。
  Files in `reference/` are unmodified.
- 元のリポジトリの `LICENSE` と `NOTICE.md` を、このフォルダに加えました。
  Added the upstream `LICENSE` and `NOTICE.md` to this directory.
- このファイル（`MODIFICATIONS.md`）を加えました。
  Added this file (`MODIFICATIONS.md`).

## 入れなかったもの / Not included
- `.claude/settings.json`（編集のたび・セッションの開始と終了のときに自動で動く hooks）
  `.claude/settings.json` (hooks that run automatically on SessionStart, PostToolUse and Stop)
- `.claude/agents/`（サブエージェントの定義。スキルは `reference/degraded/` の手順で代わりに動きます）
  `.claude/agents/` (subagent definitions; the skill falls back to `reference/degraded/`)
- プラグイン・ほかのツール向けのファイル（`plugin/`・`.claude-plugin/`・`.cursor/` など）・CLI・拡張機能のソース
  Plugin and other-tool packaging, CLI and extension sources
