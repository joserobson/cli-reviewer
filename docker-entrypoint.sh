#!/bin/sh
set -eu

mkdir -p "$CODEX_HOME"
chown -R reviewer:reviewer "$CODEX_HOME"
mkdir -p "$CLI_REVIEWER_STATE_DIR"
chown -R reviewer:reviewer "$CLI_REVIEWER_STATE_DIR"
mkdir -p "$CLAUDE_CONFIG_DIR"
chown -R reviewer:reviewer "$CLAUDE_CONFIG_DIR"

exec gosu reviewer "$@"
