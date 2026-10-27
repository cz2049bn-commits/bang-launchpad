---
name: bang-connect
description: Connect a user's Binance Agentic Wallet to BANG, guide official pairing and bounded quick-trading authorization, and help revoke access. Use for BANG 接入、钱包授权、网页一键买卖. After authorization, users buy or sell directly in the BANG terminal without returning to their AI.
---

# BANG 接入与授权

目标：用户在 BANG 完成自己的钱包配对，开启有额度和期限的快捷交易，之后点击买入或卖出直接提交，不需要逐笔回 AI 发指令或再次确认。skill 安装、本地 CLI 登录、网页钱包授权是不同状态，不能把安装成功说成钱包已连接。

## 入口与实际能力

- 固定平台：`https://bangxt.fun`，BNB Smart Chain，chain ID `56`。
- 钱包与授权：`https://bangxt.fun/#/wallet`。
- 交易终端：`https://bangxt.fun/#/terminal`。
- 运行 `node scripts/connect.mjs doctor` 读取平台公开能力，或 `node scripts/connect.mjs links` 输出官方入口。Node.js 22+；无第三方依赖。
- `doctor` 只核验公开接入协议，不读取用户授权状态、不创建钱包会话、不签名。必须在用户实际使用的同一浏览器账户检查授权。
- 能力接口是 `/api/integration`。只有对应 capability 为 `true` 才说明该适配器已接入；即便已接入，每笔交易仍需实时链上验证。`false`、未知或接口失败必须如实说明，不能换到另一发射台冒充完成。BANG / GB 的名称不是 CA。
- 完整授权机制与恢复规则见 [连接流程](references/connection.md)。

## 带用户完成连接

1. 打开上述 BANG 钱包页面。优先复用用户正在使用的浏览器和现有会话。先读页面状态；有效连接无需重新配对。没有浏览器控制工具时提供该链接，让用户在网页操作。
2. 用户要求连接即允许启动配对；点击页面“连接币安钱包”。只展示该次请求实际返回的官方 Binance 配对链接、验证码和到期时间。让用户在币安 App 查看并批准。不要读取、导出或传送其私钥、助记词、CLI 凭证或浏览器 Cookie。
3. 页面显示“已连接”后核对完整 BSC 地址。配对必须由该浏览器会话发起；在用户 AI 本机运行 `baw auth signin` 不会自动授权 BANG 网站，不做凭证搬运。
4. 用户在官方 Agentic Wallet 设置中开启 Developer Mode，自行设置每日限额和有效期。刷新网页，检查 enabled、真实到期时间及余额/额度限制。不得代用户无限提额或延长授权。
5. Agent ID 购买资格由具体发射台合约校验。平台账户编号和 `.ai` 名称文字都不是单独的链上通过证明。购买前必须使用终端返回的当期链上资格、市场阶段及持仓上限结果。
6. 打开交易终端，点击“开启快捷交易”。让用户选择单笔买入 BNB 上限、每日买入 BNB 上限（UTC）、滑点上限及有效期，在网页勾选并确认授权。不要代填超出用户意愿的额度。有效期取用户选择与官方钱包权限到期时间的较早者。
7. 接入结束时报告实际状态：当前连接地址、授权有效期、单笔/每日额度、已支持的交易来源。若终端适配器尚未开放，明确它仍不可交易，不声称全套完成。

## 用户之后如何交易

授权完成后在同一浏览器选择完整 CA，输入数量及滑点，点击“买入／卖出 · 直接提交”。该次点击就是本次订单指令。终端会在限额内完成官方钱包预览、必要的 BNB 包装、精确数量 ERC20 授权及成交，并核对每一步回执；不再弹第二次确认。skill 不要求用户回 AI 输入买卖命令，也不自动点击买卖。

快捷模式支持 BANG、Gang、OpenFour 已核验的 BNB/WBNB 内盘，以及 BANG 目录中的 USDT 和 RWA 报价资产。RWA 买入按链上 30 分钟均价折算 BNB，额外预留 10% 估值余量计入用户额度；Gas 另计。估值超出预留额度、内盘已关闭、迁移中、权限过期或超额时会暂停。用户开启新快捷授权时明确接受官方非拦截风险提示，报告保留在每笔订单；官方拦截和要求的 App 确认仍生效；不能悄悄更改额度、滑点或换到另一市场。用户仍可主动选择“本次先查看详细预览”。

网站确认后钱包可能直接签名，也可能返回“等待 App 确认”。按官方返回处理，不承诺永久免确认。授权到账不等于买入完成；只有匹配该用户、代币和方向的成功链上回执才算成交。

停止快捷交易可在其额度设置中关闭。停止平台钱包授权可在钱包页点击“断开钱包”，并在币安 App 核对或撤销官方授权。断开会使 BANG 未执行预览失效，不能撤销已经广播的交易，也不会自动撤销链上 ERC20 allowance。

## 普通 EVM 钱包发行

发行入口 `https://bangxt.fun/#/create`，使用浏览器 EVM 钱包签名，不需要 Agent ID 或币安钱包配对。发行不包含初始买入。可选择 BNB、USDT、NVDAB、TSLAB、SPCXB、QQQB 底池和 1–100 BNB 毕业目标。只有后续内盘买入需要 Agent ID；每钱包当前持仓上限总量的 1%，卖出恢复额度。毕业后转到 PancakeSwap V2，LP 销毁，终端不代替 DEX 交易。链上地址以 `/api/native/status` 返回为准。
