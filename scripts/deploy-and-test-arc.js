const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const USDC = "0x3600000000000000000000000000000000000000";
const FEES = [100, 500, 3000];

async function sent(label, txPromise) {
  const tx = await txPromise;
  console.log(`${label}: ${tx.hash}`);
  return tx.wait();
}

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("Missing DEPLOYER_PRIVATE_KEY");
  const chainId = (await ethers.provider.getNetwork()).chainId;
  if (chainId !== 5042002n) throw new Error(`Refusing non-ARC chain ${chainId}`);
  const nativeBefore = await ethers.provider.getBalance(deployer.address);
  if (nativeBefore < ethers.parseEther("2")) throw new Error(`Need at least 2 ARC testnet USDC; current native balance ${ethers.formatEther(nativeBefore)}`);
  console.log(`deployer: ${deployer.address}`);
  console.log(`native USDC before: ${ethers.formatEther(nativeBefore)}`);

  const w3 = await ethers.deployContract("TestW3", [deployer.address, ethers.parseEther("100000000")]); await w3.waitForDeployment();
  const factory = await ethers.deployContract("W3PoolFactory"); await factory.waitForDeployment();
  const router = await ethers.deployContract("W3Router", [await factory.getAddress()]); await router.waitForDeployment();
  const gaugeFactory = await ethers.deployContract("W3GaugeFactory", [await factory.getAddress(), await w3.getAddress()]); await gaugeFactory.waitForDeployment();
  const usdc = new ethers.Contract(USDC, ["function approve(address,uint256) returns(bool)","function balanceOf(address) view returns(uint256)"], deployer);

  await sent("approve W3", w3.approve(await router.getAddress(), ethers.MaxUint256));
  await sent("approve USDC", usdc.approve(await router.getAddress(), ethers.MaxUint256));
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  await sent("create 0.05% pool + add liquidity", router.addLiquidity(USDC, await w3.getAddress(), 500, 1_000_000n, ethers.parseEther("1000"), 0, deployer.address, deadline));
  const poolAddress = await factory.getPool(USDC, await w3.getAddress(), 500);
  await sent("create W3 gauge", gaugeFactory.createGauge(poolAddress));
  const gaugeAddress = await gaugeFactory.gaugeForPool(poolAddress);
  const gauge = await ethers.getContractAt("W3Gauge", gaugeAddress, deployer);
  const pool = await ethers.getContractAt("W3Pool", poolAddress, deployer);

  const quote = await router.getAmountOut(ethers.parseEther("1"), await w3.getAddress(), USDC, 500);
  const usdcBeforeSwap = await usdc.balanceOf(deployer.address);
  await sent("swap 1 W3 -> USDC", router.swapExactTokensForTokens(ethers.parseEther("1"), quote * 99n / 100n, await w3.getAddress(), USDC, 500, deployer.address, deadline));
  const actualOut = (await usdc.balanceOf(deployer.address)) - usdcBeforeSwap;
  if (actualOut <= 0n) throw new Error("Swap produced no USDC");

  const lpBalance = await pool.balanceOf(deployer.address);
  const stakeAmount = lpBalance / 2n;
  await sent("approve LP", pool.approve(gaugeAddress, stakeAmount));
  await sent("stake LP", gauge.deposit(stakeAmount));
  const rewardAmount = ethers.parseEther("70");
  await sent("approve W3 rewards", w3.approve(gaugeAddress, rewardAmount));
  await sent("fund 70-second W3 campaign", gauge.notifyRewardAmount(rewardAmount, 70));
  await sent("claim initial W3 reward", gauge.getReward());
  if (await gauge.balanceOf(deployer.address) !== stakeAmount) throw new Error("Gauge stake mismatch");

  const result = {
    network: "arcTestnet", chainId: Number(chainId), deployer: deployer.address,
    testW3: await w3.getAddress(), usdc: USDC, factory: await factory.getAddress(),
    router: await router.getAddress(), gaugeFactory: await gaugeFactory.getAddress(),
    pools: { "500": poolAddress }, gauges: { "500": gaugeAddress },
    supportedFeePpm: FEES, liquidity: { usdc: "1", w3: "1000", stakedLpWei: stakeAmount.toString() },
    testedSwap: { amountInW3: "1", amountOutUsdc: ethers.formatUnits(actualOut, 6) },
    nativeUsdcBefore: ethers.formatEther(nativeBefore), nativeUsdcAfter: ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    testedAt: new Date().toISOString()
  };
  fs.mkdirSync(path.join(__dirname, "..", "deployments"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "..", "deployments", "arc-testnet.json"), JSON.stringify(result, null, 2));

  const siteConfig = `window.W3_DEX_CONFIG = ${JSON.stringify({chainId:5042002,chainHex:"0x4cef52",rpcUrl:"https://rpc.testnet.arc.network",explorer:"https://testnet.arcscan.app",usdc:USDC,w3:result.testW3,factory:result.factory,router:result.router,gaugeFactory:result.gaugeFactory,pools:result.pools,gauges:result.gauges}, null, 2)};\n`;
  fs.writeFileSync(path.join(__dirname, "..", "site", "dist", "config.js"), siteConfig);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
