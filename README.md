# W3 ARC DEX

W3 是部署在 ARC Testnet 的集中流动性 DEX 项目，包含完整网页、V3 池、聚合兑换、仓位管理、W3 手续费激励和 W3 跨链页面。线上演示：[w333.live](https://w333.live)。

当前版本仅用于测试网，所有合约均未审计。

## 功能

- V3 集中流动性，只支持 0.01%、0.05%、0.3% 三档费率
- Swap 自动比较三档池的报价
- 自定义滑点和防 MEV 选项
- 添加、移除、质押和赎回 NFT 流动性仓位
- 任意钱包可为具体池添加 W3，固定 7 天按仓位手续费占比分配
- 链上 K 线和最近 100 笔交易
- W3 跨链页面

## Fee choices

`feePpm` uses a denominator of 1,000,000 and accepts exactly:

- `100` = 0.01%
- `500` = 0.05%
- `3000` = 0.30%

## ARC Testnet

- Chain ID: `5042002`
- RPC: `https://rpc.testnet.arc.network`
- Explorer: `https://testnet.arcscan.app`
- Native gas currency: USDC
- Testnet USDC ERC-20: `0x3600000000000000000000000000000000000000`
- Faucet: `https://faucet.circle.com`

## 目录

- `contracts/`：DEX、Uniswap V3 核心合约和手续费激励合约
- `scripts/`：部署、初始化池和测试脚本
- `deployments/`：公开的测试网合约地址与交易记录，不包含签名凭据
- `test/`：Hardhat 测试
- `w333-site/`：w333.live 完整前端和跨链合约源码

## Local verification

```bash
npm install
npm test
cd w333-site
npm install
npm test
npm run build
```

## Deploy (requires your local signing key)

```bash
cp .env.example .env
# edit .env locally; never commit or share the private key
set -a && source .env && set +a
npm run deploy:arc
```

Set `W3_TOKEN` to the real W3 ERC-20 address on ARC Testnet. If omitted, the script deploys a clearly marked `TestW3` token for testing. The deployment script verifies chain ID 5042002 before broadcasting and writes addresses to `deployments/arc-testnet.json`.

`FeeWeightedV3Rewards` 接收任何地址添加的 W3 激励。每次添加会把该池的结束时间设置为交易后的 7 天；周期结束后，根据每个已质押 NFT 仓位新增手续费的 USDC 计价占比分配奖励。

## 凭据安全

- 仓库不会提交 `.env`、钱包 JSON、私钥、助记词或 keystore。
- `.env.example` 只保留空白配置模板。
- 部署和测试前，应在本机创建 `.env`，切勿通过 Issue、日志或聊天发送私钥。
- 推送前建议运行：`git grep -nEI 'private.key|mnemonic|seed phrase'`。

## Security status

Unaudited testnet code. Do not use it with real assets before independent review, fuzz/invariant testing, role design, emergency controls, oracle/TWAP safeguards, and a production emissions policy.
