const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { getCreateAddress } = require("ethers");

const USDC = "0x3600000000000000000000000000000000000000";
const SWAP_TX = "0x57b1aa298f119df1b13b5ab64a7ab45326116a3308207894d1d34a2b8dbfdeb4";

async function sent(label, promise) { const tx = await promise; console.log(`${label}: ${tx.hash}`); return tx.wait(); }

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  if (chainId !== 5042002n) throw new Error(`Refusing non-ARC chain ${chainId}`);
  const w3Address = getCreateAddress({ from: deployer.address, nonce: 0 });
  const factoryAddress = getCreateAddress({ from: deployer.address, nonce: 1 });
  const routerAddress = getCreateAddress({ from: deployer.address, nonce: 2 });
  const gaugeFactoryAddress = getCreateAddress({ from: deployer.address, nonce: 3 });
  for (const [name,address] of Object.entries({w3Address,factoryAddress,routerAddress,gaugeFactoryAddress})) {
    if ((await ethers.provider.getCode(address)) === "0x") throw new Error(`${name} has no code at ${address}`);
  }
  const factory = await ethers.getContractAt("W3PoolFactory", factoryAddress, deployer);
  const gaugeFactory = await ethers.getContractAt("W3GaugeFactory", gaugeFactoryAddress, deployer);
  const w3 = await ethers.getContractAt("TestW3", w3Address, deployer);
  const poolAddress = await factory.getPool(USDC, w3Address, 500);
  const gaugeAddress = await gaugeFactory.gaugeForPool(poolAddress);
  const pool = await ethers.getContractAt("W3Pool", poolAddress, deployer);
  const gauge = await ethers.getContractAt("W3Gauge", gaugeAddress, deployer);

  const swapReceipt = await ethers.provider.getTransactionReceipt(SWAP_TX);
  const parsed = swapReceipt.logs.map(log=>{try{return pool.interface.parseLog(log)}catch{return null}}).find(x=>x?.name==="Swap");
  if (!parsed) throw new Error("Confirmed swap event not found");
  const actualOut = poolAddress.toLowerCase() && (await pool.token0()).toLowerCase() === USDC.toLowerCase() ? parsed.args.amount0Out : parsed.args.amount1Out;
  if (actualOut <= 0n) throw new Error("Swap event reports no USDC output");

  const lpBalance = await pool.balanceOf(deployer.address);
  const stakeAmount = lpBalance / 2n;
  await sent("approve LP", pool.approve(gaugeAddress, stakeAmount));
  await sent("stake LP", gauge.deposit(stakeAmount));
  const rewardAmount = ethers.parseEther("70");
  await sent("approve W3 rewards", w3.approve(gaugeAddress, rewardAmount));
  await sent("fund 70-second W3 campaign", gauge.notifyRewardAmount(rewardAmount, 70));
  const w3BeforeClaim = await w3.balanceOf(deployer.address);
  const claimReceipt = await sent("claim W3 reward", gauge.getReward());
  const claimed = (await w3.balanceOf(deployer.address)) - w3BeforeClaim;
  if (await gauge.balanceOf(deployer.address) !== stakeAmount) throw new Error("Gauge stake mismatch");

  const result = {
    network:"arcTestnet",chainId:Number(chainId),deployer:deployer.address,testW3:w3Address,usdc:USDC,
    factory:factoryAddress,router:routerAddress,gaugeFactory:gaugeFactoryAddress,pools:{"500":poolAddress},gauges:{"500":gaugeAddress},
    supportedFeePpm:[100,500,3000],liquidity:{usdc:"1",w3:"1000",stakedLpWei:stakeAmount.toString()},
    testedSwap:{transaction:SWAP_TX,amountInW3:"1",amountOutUsdc:ethers.formatUnits(actualOut,6)},
    testedReward:{claimTransaction:claimReceipt.hash,fundedW3:"70",durationSeconds:70,claimedW3:ethers.formatEther(claimed)},
    nativeUsdcAfter:ethers.formatEther(await ethers.provider.getBalance(deployer.address)),testedAt:new Date().toISOString()
  };
  fs.mkdirSync(path.join(__dirname,"..","deployments"),{recursive:true});
  fs.writeFileSync(path.join(__dirname,"..","deployments","arc-testnet.json"),JSON.stringify(result,null,2));
  const config={chainId:5042002,chainHex:"0x4cef52",rpcUrl:"https://rpc.testnet.arc.network",explorer:"https://testnet.arcscan.app",usdc:USDC,w3:w3Address,factory:factoryAddress,router:routerAddress,gaugeFactory:gaugeFactoryAddress,pools:result.pools,gauges:result.gauges};
  fs.writeFileSync(path.join(__dirname,"..","site","dist","config.js"),`window.W3_DEX_CONFIG = ${JSON.stringify(config,null,2)};\n`);
  console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
