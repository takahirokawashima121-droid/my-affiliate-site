# 元のリポジトリから変えたところ（Modifications）

このフォルダは Impeccable（https://github.com/pbakaus/impeccable 、Apache License 2.0、
コミット c74755d・v4.4.0）の `.claude/skills/impeccable/` を、ポケカファクトリーのリポジトリに入れたものです。

This directory is a copy of `.claude/skills/impeccable/` from Impeccable
(https://github.com/pbakaus/impeccable, Apache License 2.0, commit c74755d, v4.4.0).

## 変えたところ / Changes
- スキルのフォルダの中のファイル（`SKILL.md`・`reference/`・`scripts/`）は変えていません。
  Files inside the skill directory (`SKILL.md`, `reference/`, `scripts/`) are unmodified.
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
