# ONE · W3 双向跨链兑换测试版

独立前端 + 双边库存合约，X Layer ↔ BNB Chain 按整枚 W3 数量 1:1 兑换。无需修改原代币，也不需要 mint/burn 权限。使用 LayerZero V2 OApp 传递请求和结果；**不是 Stargate 合约，也不依赖 Stargate 官网收录**。

**更新：已按用户授权开始主网部署。当前地址、配置、资金和交易状态以 mainnet-deployment.json 与链上读取为准。测试预算调整为每边转入 0.1 W3，其中 0.09 W3 注入池子、0.01 W3 留在测试钱包。**

## 打开页面

需要 Node.js 22.12+（或 Vite 8 支持的更新版本）。在本目录运行：

```sh
npm ci --ignore-scripts
npm run dev
```

在安装 OKX Wallet 或 MetaMask 的浏览器中打开终端显示的本地网址，通常是 `http://127.0.0.1:5173`。普通 Codex 内置浏览器如果没有钱包扩展，只能预览页面。支持 EIP-6963/EIP-1193 注入钱包；没有集成 WalletConnect 扫码连接。所有交易均由钱包签名，不需要在项目或聊天中提供私钥。

本次工作目录已安装依赖并编译。也可执行 `npm run build` 后，将 `dist/` 部署到支持 HTTPS 的静态站点。当前没有发布公网域名。

## 固定测试资产

| 网络      | Chain ID / Endpoint ID | 原代币                                       | gas |
| --------- | ---------------------- | -------------------------------------------- | --- |
| X Layer   | 196 / 30274            | `0x5164b016ef0778076f6acd24436f84d3c3aa91dc` | OKB |
| BNB Chain | 56 / 30102             | `0x71d912f1b3e6a559f6f34da4689a0901a7b37214` | BNB |

2026-09-09 已通过 RPC 读取两边 symbol=W3、decimals=18、非空合约代码，并核对 Endpoint V2 的 eid。检查记录见 `token-check.json`，可运行 `npm run inspect` 更新。未宣称对两个原代币做过完整源码审计或确认发行方关系。

初始库存计划每边 0.09 W3，页面默认测试兑换 0.01 W3。单笔合约上限为 1 W3，下限 0.000001 W3，最多 6 位小数。不收代币手续费；成功订单可以领取与源链扣款相同数量的 W3。需要另外支付源链授权/请求、目标链结果回传/领取、退款领取等交易的 gas 和两次消息费用。

## 重要：当前版本不是即时跨链

本次 RPC 检查发现该路径默认 required DVN 是 `0x000000000000000000000000000000000000dEaD`。**只部署、绑定、注资是不够的，必须完成显式验证配置。**

代码使用官方部署表中的 LayerZero Labs + Nethermind 两个 required DVN，两个都必须验证；关闭 optional DVN 继承。两边固定 SendUln302 / ReceiveUln302 和 Executor。地址和编码集中在 `src/security.js`。

确认深度保留本次观察到的默认数值：

- X Layer 出站：225,000 块。本次 225,000 个历史区块对应 225,000 秒，约 **62.5 小时**。
- BNB 出站：20 块。具体等待时间会随链和服务状态变化。
- 对端接收配置与源链发送确认深度严格匹配。

因此 X Layer → BNB 的首次到账会等待较久；BNB → X Layer 的去程可能较快，但回传结算仍需等待 X Layer 确认。这个时间不是到账保证。网页订单有效期设为 7 天；目的链若到达时已过期则拒绝，并需要回传结果才能退款。

**不要为了“几分钟测完”直接调低确认数。** 如果需要较快的正式方案，应先核实 X Layer 最终性与 DVN 支持政策，再另行评估安全配置，或用测试网资产测试。测试网无法直接使用本需求给出的主网代币地址。

## 通过网页部署并各存 0.09 枚

先准备同一个钱包在两链各至少 0.1 W3，并分别留足 OKB 和 BNB 支付 gas。

1. 连接钱包，打开「测试管理」，阅读并勾选实验说明。
2. 在两个网络分别点击「1. 部署合约」。钱包会请求切链并显示部署费用；部署后地址保存到浏览器，合约默认暂停。
3. 确认两端地址无误，再分别点击「2. 绑定另一端」。绑定只有一次机会，之后不能更换 peer。
4. 在两端分别点击「3. 配置双验证器」。会请求多笔钱包交易：固定发送/接收消息库、发送 ULN + Executor 配置、接收 ULN 配置。整个步骤在暂停状态完成，失败后可以重试。
5. 在两端分别点击「4. 存入 0.09 W3」。首次包含授权交易和注资交易。再次点击会再存 0.09 枚，不是补齐到 0.09 枚。
6. 点击「检查双向路径」，确认读出的配置，再点「开启两端兑换」。按钮会核对两端字节码、代币、peer、消息库、精确 DVN 配置、Executor 和消息报价，并要求初次两边各至少 0.1 W3 空闲库存。
7. 回到「兑换」，从 0.01 W3 开始。预览费用后，在钱包完成限额授权和发起交易。
8. 打开「我的订单」。目标链处理后，点击「回传处理结果」；接受订单可以独立「领取 W3」，被拒绝的订单则等结果回到源链再「领取源链退款」。回传动作由任何人都可以付费执行，本页面提供按钮，不需要托管 relayer 私钥。

前端不会代理用户签名或自动扣除另外的币。部署、配置、授权、注资、兑换、领取都需要钱包确认。

## 发布前端与恢复订单

管理员在网页导出 `deployments.json`，将内容放到 `public/deployments.json`，重新 `npm run build` 后发布 `dist/`。新浏览器就能读取正确地址。当前浏览器手动保存的配置优先于发布配置。

「验证并保存」会检查链上 runtime bytecode 是否与本次构建匹配，仅跳过编译器记录的 immutable 字段，再核对代币、Endpoint、remote eid、精度。这能阻止仅伪装同名 ABI 的其他合约。依赖版本或源码变化会改变指纹；与旧部署配套的构建应保留。

订单先保存源链交易哈希，再等待确认，防止刷新时丢单。可以导出 JSON 备份；清理浏览器记录后，在「我的订单」输入源链交易哈希恢复。链上状态才是支付依据，localStorage 不是账本。旧版本合约的订单应使用与旧部署配套的前端和地址恢复。

## 合约资金流程

```text
源链 swap：用户代币 → escrowed（隔离托管）
          │ LayerZero 验证消息
          ▼
目标链：库存足够且未暂停、未过期 → freeLiquidity 减少 → reserved 增加
        库存不足/暂停/过期       → 固定 Rejected 结果，不留目标链支付义务
          │ relayResult：任何人支付目标链消息费回传固定结果
          ▼
源链：Accepted → escrowed 转入 freeLiquidity
      Rejected → escrowed 转入 refundable → 用户 claimRefund

目标链 Accepted 用户可直接 claim reserved，不必等待结果回传完成。
```

每个请求只能决定一次结果、结算一次、领取一次。并发请求按目标链实际处理顺序分配库存，后到者可被拒绝。前端读到库存不代表该库存已为当前报价预留。

正常支持的代币下保持以下记账等式（直接向合约转账的意外余额除外）：

```text
token.balanceOf(bridge) = freeLiquidity + escrowed + reserved + refundable
```

管理员仅能提取 `freeLiquidity`，不能提取在途托管、目标链预留或待退款款项。管理员暂停会拒绝新的入站订单并禁止新的出站兑换，但不会阻止已有领取、退款或结果回传。

合约不支持转账税、额外扣款、rebasing 等非标准余额行为：存入/付出时核对双方精确余额变化。代币日后若暂停、拉黑或改变行为，可能导致领取失败；状态会在失败时回滚，但恢复仍依赖代币本身。不要直接 `transfer` 给桥，请通过 `fund` 注资；直接转入的额外余额未计为可用库存，当前没有救援提取入口。

没有「仅凭超时退款」接口。否则可能在目标链已支付、源链尚未收到结果时双重支出。若 LayerZero 验证、执行或消息回传中断，资金可能等待重试或恢复，**不能保证在一个固定时间内退款**。网络费用不退。

owner/delegate 仍可修改 LayerZero 安全配置，因此这不是消除了管理员信任的生产桥。正式运行还需独立审计、权限治理和运维；本项目只用于本次小额实验。

## 验证与项目结构

```sh
npm test              # 本地合约和安全配置测试
npm run build         # 编译 Solidity 并构建静态前端
npm run inspect       # 只读核对主网代币与 Endpoint
npm run test:fork     # 在本地分叉部署/配置/报价；不写入主网
```

`contracts/InventoryBridge.sol` 是实际桥；`contracts/TestFixtures.sol` 仅是本地测试用 endpoint/token，绝不能拿来主网部署。`scripts/compile.mjs` 输出浏览器部署所用的 ABI/bytecode 和 `artifacts/standard-input.json`（区块浏览器验证用），Solidity 0.8.30、optimizer 200、EVM Paris。

测试包含双向 1:1、18/6 位精度互换、并发库存不足、拒绝退款、过期/暂停、消息重复/乱序、伪造来源、越权领取/提款、转账税拒绝和安全配置编码。主网分叉测试在本地 EVM 复制真实 Endpoint/DVN/Executor 状态，验证部署、显式配置和实际协议报价；它不是线上消息送达或真钱往返测试。详见 `fork-test-results.json`。

网页已检查未部署状态、方向切换、无钱包提示、管理/订单入口及窄屏布局。浏览器钱包签名流程仍未测试；专用测试钱包已完成 0.01 W3 的 BNB → X Layer 主网到账与领取，回传结算仍在等待确认。部署配置见 mainnet-deployment.json，实测状态见 mainnet-test.json。

Ganache 及 LayerZero 开发包带有旧的开发工具依赖，npm audit 会报告其传递依赖问题。它们不由前端导入，也不作为公网服务运行；测试使用生成的本地账户。生产交付只发布 `dist/`，不要公开 node_modules 或本地测试 RPC。依赖扫描不替代合约审计。

## 官方依据

- [X Layer 网络与 RPC](https://web3.okx.com/zh-hant/onchainos/dev-docs/xlayer/developer/rpc-endpoints/rpc-endpoints)
- [LayerZero X Layer Endpoint / DVN / Executor](https://docs.layerzero.network/v2/deployments/chains/xlayer)
- [LayerZero BNB Endpoint / DVN / Executor](https://docs.layerzero.network/v2/deployments/chains/bsc)
- [LayerZero OApp 开发文档](https://docs.layerzero.network/v2/developers/evm/oapp/overview)
- [LayerZero 执行选项](https://docs.layerzero.network/v2/developers/evm/configuration/options)

原 Stargate APD 申请草案已被本独立应用方案取代。

## 主网实测更新

两端合约均为 `0x2E6B9b1AD827e8C91E1B355173D76d5770Bf5735`（按各自网络区分）。两边各 0.09 W3 已注资并开启。测试钱包预留的 0.01 W3 已发起 BNB → X Layer，且已在 X Layer 领取。测试后快照：X Layer 钱包 0.02 W3、池子空闲 0.08 W3；BNB 钱包 0 W3、池子空闲 0.09 W3、待结算托管 0.01 W3。

- 源链交易：`0x9c3db6a06a11733303f6766175b4eb65388d3e4be010db3fcb115cf3ad9421e8`
- X Layer 领取：`0x60061737cd238f8a5d00b5efe459d52ce955eba316fe25a0c088343c72579413`
- X Layer 回传：`0xbd9769eff92e08c45586ce4966786823ecbcbccedce11c442b1c972fdbc0aeec`

回执尚未完成源链结算，不能将本状态表述为整个往返流程全部完成。「我的订单」中的部署钱包实测卡会读取实时链上状态。mainnet-test.json 是带 checkedAt 的检查快照。
