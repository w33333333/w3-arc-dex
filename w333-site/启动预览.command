#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
if ! command -v npm >/dev/null 2>&1; then
  print '请先安装 Node.js 22.12 或更新版本。'
  read '?按回车退出'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm ci --ignore-scripts --cache /private/tmp/one-bridge-npm
fi
npm run build
npm run preview
