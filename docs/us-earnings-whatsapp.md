# 美股 Top 1500 财报 + WhatsApp 推送

目标：每天按美股财报日历扫描**美股市值前 1500**，把当天有财报的公司结构化后发送到 WhatsApp；如果 Alpha Vantage 已有 earnings call transcript，则同时发送 transcript 的结构化分析。

## 数据源

- Financial Modeling Prep：
  - 获取美股市值前 1500 universe
  - 获取当天 earnings calendar
- Alpha Vantage：
  - 获取 `EARNINGS_CALL_TRANSCRIPT`
  - 需要 `symbol + quarter`
  - 脚本会从当前季度开始向前探测最近几个季度
- Twilio WhatsApp：
  - 发送到你的 WhatsApp 手机号

## GitHub Secrets

进入仓库：Settings -> Secrets and variables -> Actions -> New repository secret。

必须配置：

- `FMP_API_KEY`
- `ALPHA_VANTAGE_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM`
- `WHATSAPP_TO`

格式示例：

```text
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
WHATSAPP_TO=whatsapp:+1你的手机号
```

可选配置：

- `TWILIO_CONTENT_SID`
- `TWILIO_CONTENT_VARIABLES`

如果配置了 `TWILIO_CONTENT_SID`，脚本会使用 Twilio WhatsApp 模板消息。没有配置时，脚本会发送普通文本；但普通文本通常只适用于你主动给机器人发消息后的 24 小时 customer service window。

## 手动测试

进入 Actions -> US Earnings WhatsApp -> Run workflow。

第一步先选：

- `mode`: `test`

收到 WhatsApp 测试消息后，再选：

- `mode`: `dry-run`
- `date`: 例如 `2026-06-27`

`dry-run` 只生成报告，不发 WhatsApp。

最后运行：

- `mode`: `run`

## 定时运行

workflow 默认：

```yaml
cron: '0 3 * * 2-6'
```

这是 UTC 时间，约等于美东前一日晚上 23:00，适合覆盖美股盘后财报和电话会。

## 本地运行

```bash
set FMP_API_KEY=你的FMP_KEY
set ALPHA_VANTAGE_API_KEY=你的AV_KEY
set TWILIO_ACCOUNT_SID=你的SID
set TWILIO_AUTH_TOKEN=你的TOKEN
set TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
set WHATSAPP_TO=whatsapp:+1你的手机号

node scripts/us-earnings-whatsapp.js dry-run 2026-06-27
node scripts/us-earnings-whatsapp.js run 2026-06-27
```

PowerShell：

```powershell
$Env:FMP_API_KEY="你的FMP_KEY"
$Env:ALPHA_VANTAGE_API_KEY="你的AV_KEY"
$Env:TWILIO_ACCOUNT_SID="你的SID"
$Env:TWILIO_AUTH_TOKEN="你的TOKEN"
$Env:TWILIO_WHATSAPP_FROM="whatsapp:+14155238886"
$Env:WHATSAPP_TO="whatsapp:+1你的手机号"

node scripts/us-earnings-whatsapp.js dry-run 2026-06-27
```

## 输出字段

每只股票包括：

- 市值排名
- 股票代码和公司名
- 市值
- 行业 / 子行业
- 财报日期和时间
- EPS 预期
- 营收预期
- transcript 可用状态
- transcript 平均情绪
- 高频主题
- 正面线索
- 风险线索

## 注意

1. Alpha Vantage transcript 不是所有公司、所有季度都能立刻拿到；如果财报刚发，电话会文本可能延迟。
2. `MAX_TRANSCRIPTS_PER_RUN` 默认是 `12`，避免一次运行消耗过多 API 配额。
3. 如果当天财报公司很多，WhatsApp 长文本会被自动拆分。
4. WhatsApp 主动通知建议使用模板消息，否则可能被 WhatsApp 规则拦截。
