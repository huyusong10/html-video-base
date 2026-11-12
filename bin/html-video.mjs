#!/usr/bin/env node
// html-video CLI 入口：自动识别调用方业务工作目录与本包安装目录
if (!process.env.VIDEO_PROJECT_ROOT) {
  process.env.VIDEO_PROJECT_ROOT = process.cwd();
}
const { runCli } = await import('../tools/cli.mjs');
runCli();
