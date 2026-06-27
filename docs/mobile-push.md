# 手机推送设置

这个仓库可以通过 GitHub Actions 定时获取财报日历，并推送到手机。建议先用飞书/Lark 自定义机器人，因为手机端稳定、配置简单。

## 1. 配置 GitHub Secrets

进入仓库：Settings -> Secrets and variables -> Actions -> New repository secret。

至少添加：

- `FEISHU_WEBHOOK_URL`: 飞书/Lark 机器人地址
- `FMP_API_KEY`: Financial Modeling Prep API Key

可选：

- `LARK_WEBHOOK_URL`: 如果不用 `FEISHU_WEBHOOK_URL`，也可以放这里
- `ALPHA_VANTAGE_API_KEY`: 使用 Alpha Vantage 摘要数据时需要

## 2. 手动测试

进入 Actions -> Earnings Mobile Push -> Run workflow。

先选择：

- `command`: `test`

如果手机能收到测试消息，再运行：

- `command`: `preview`
- `market`: `us`
- `sector`: `tech`
- `provider`: `fmp`

## 3. 定时运行

默认工作流每个美股交易日附近时间自动运行一次：

- GitHub cron: `0 12 * * 1-5`
- 约等于美东夏令时 08:00

## 4. 推送单只股票财报摘要

手动运行 workflow：

- `command`: `summary`
- `symbol`: `NVDA`
- `market`: `us`
- `provider`: `fmp`

## 安全提醒

API Key 不应写进 `.config/watchlist.json` 后提交到公开仓库。请放到 GitHub Secrets 或本地环境变量中。
