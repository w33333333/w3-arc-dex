const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const JSBI = require("jsbi");
const { encodeSqrtRatioX96, TickMath, nearestUsableTick } = require("@uniswap/v3-sdk");

const USDC = "0x3600000000000000000000000000000000000000";
const W3 = "0x8Cc53DDCCf52E0F63423f1fD254A7a41eE2075ba";
const FEES = [{ fee: 100, spacing: 1 }, { fee: 500, spacing: 10 }, { fee: 3000, spacing: 60 }];
const outFile = path.join(__dirname, "..", "deployments", "arc-testnet-v3.json");

function artifact(p) { return require(p); }
async function deploy(label, factory, args = []) {
  const contract = await factory.deploy(...args);
  console.log(`${label} tx: ${contract.deploymentTransaction().hash}`);
  await contract.waitForDeployment();
  console.log(`${label}: ${await contract.getAddress()}`);
  return contract;
}
async function sent(label, promise) {
  const tx = await promise; console.log(`${label}: ${tx.hash}`); return tx.wait();
}
function save(value) { fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, JSON.stringify(value, null, 2)); }

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw Error("Missing DEPLOYER_PRIVATE_KEY");
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 5042002n) throw Error(`Refusing non-ARC chain ${network.chainId}`);
  console.log(`deployer: ${deployer.address}`);
  console.log(`native USDC: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))}`);

  const Factory = await ethers.getContractFactory("W3V3Factory", deployer);
  const factory = await deploy("W3V3Factory", Factory);
  const Wrapped = await ethers.getContractFactory("MockERC20", deployer);
  const wrapped = await deploy("WrappedNativePlaceholder", Wrapped, ["Wrapped ARC Test USDC", "WARC", 18]);
  const Descriptor = await ethers.getContractFactory("W3V3PositionDescriptor", deployer);
  const descriptor = await deploy("PositionDescriptor", Descriptor);

  const nfpmA = artifact("@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json");
  const routerA = artifact("@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json");
  const quoterA = artifact("@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json");
  const stakerA = artifact("@uniswap/v3-staker/artifacts/contracts/UniswapV3Staker.sol/UniswapV3Staker.json");
  const nfpm = await deploy("PositionManager", new ethers.ContractFactory(nfpmA.abi, nfpmA.bytecode, deployer), [await factory.getAddress(), await wrapped.getAddress(), await descriptor.getAddress()]);
  const router = await deploy("SwapRouter", new ethers.ContractFactory(routerA.abi, routerA.bytecode, deployer), [await factory.getAddress(), await wrapped.getAddress()]);
  const quoter = await deploy("QuoterV2", new ethers.ContractFactory(quoterA.abi, quoterA.bytecode, deployer), [await factory.getAddress(), await wrapped.getAddress()]);
  const staker = await deploy("V3Staker", new ethers.ContractFactory(stakerA.abi, stakerA.bytecode, deployer), [await factory.getAddress(), await nfpm.getAddress(), 7 * 86400, 365 * 86400]);

  const usdc = new ethers.Contract(USDC, ["function approve(address,uint256) returns(bool)", "function balanceOf(address) view returns(uint256)"], deployer);
  const w3 = new ethers.Contract(W3, ["function approve(address,uint256) returns(bool)", "function balanceOf(address) view returns(uint256)"], deployer);
  await sent("approve USDC position manager", usdc.approve(await nfpm.getAddress(), ethers.MaxUint256));
  await sent("approve W3 position manager", w3.approve(await nfpm.getAddress(), ethers.MaxUint256));
  await sent("approve W3 swap router", w3.approve(await router.getAddress(), ethers.MaxUint256));

  const token0 = USDC.toLowerCase() < W3.toLowerCase() ? USDC : W3;
  const token1 = token0 === USDC ? W3 : USDC;
  if (token0 !== USDC) throw Error("Unexpected token ordering");
  const sqrtPriceX96 = BigInt(encodeSqrtRatioX96(ethers.parseEther("1000").toString(), 1_000_000n.toString()).toString());
  const tick = TickMath.getTickAtSqrtRatio(JSBI.BigInt(sqrtPriceX96.toString()));
  const pools = {}, seedPositions = {};
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  for (const { fee, spacing } of FEES) {
    await sent(`create/init ${fee} pool`, nfpm.createAndInitializePoolIfNecessary(token0, token1, fee, sqrtPriceX96));
    const pool = await factory.getPool(token0, token1, fee); pools[String(fee)] = pool;
    const center = nearestUsableTick(tick, spacing);
    const tickLower = Math.max(TickMath.MIN_TICK + spacing, center - spacing * 100);
    const tickUpper = Math.min(TickMath.MAX_TICK - spacing, center + spacing * 100);
    const receipt = await sent(`mint ${fee} concentrated position`, nfpm.mint({ token0, token1, fee, tickLower, tickUpper, amount0Desired: 500_000n, amount1Desired: ethers.parseEther("500"), amount0Min: 0, amount1Min: 0, recipient: deployer.address, deadline }));
    const transfer = receipt.logs.map(l => { try { return nfpm.interface.parseLog(l); } catch { return null; } }).find(x => x && x.name === "Transfer" && x.args.from === ethers.ZeroAddress);
    seedPositions[String(fee)] = { tokenId: transfer.args.tokenId.toString(), tickLower, tickUpper };
  }

  const quoted = await quoter.quoteExactInputSingle.staticCall({ tokenIn: W3, tokenOut: USDC, amountIn: ethers.parseEther("1"), fee: 500, sqrtPriceLimitX96: 0 });
  const swapReceipt = await sent("test V3 swap 1 W3 -> USDC", router.exactInputSingle({ tokenIn: W3, tokenOut: USDC, fee: 500, recipient: deployer.address, deadline, amountIn: ethers.parseEther("1"), amountOutMinimum: quoted[0] * 99n / 100n, sqrtPriceLimitX96: 0 }));
  const swapEvent = new ethers.Interface(["event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)"]);
  const parsedSwap = swapReceipt.logs.map(l => { try { return swapEvent.parseLog(l); } catch { return null; } }).find(Boolean);
  const actualOut = -parsedSwap.args.amount0;

  const result = {
    network: "arcTestnet", chainId: 5042002, deployer: deployer.address, usdc: USDC, testW3: W3,
    factory: await factory.getAddress(), wrappedNativePlaceholder: await wrapped.getAddress(), positionDescriptor: await descriptor.getAddress(),
    positionManager: await nfpm.getAddress(), swapRouter: await router.getAddress(), quoterV2: await quoter.getAddress(), staker: await staker.getAddress(),
    pools, seedPositions, supportedFeePpm: FEES.map(x => x.fee), tickSpacings: Object.fromEntries(FEES.map(x => [String(x.fee), x.spacing])),
    initialPrice: "1 W3 = 0.001 USDC", testedSwap: { amountInW3: "1", amountOutUsdc: ethers.formatUnits(actualOut, 6) }, testedAt: new Date().toISOString()
  };
  save(result);
  const config = { chainId: 5042002, chainHex: "0x4cef52", rpcUrl: "https://rpc.testnet.arc.network", explorer: "https://testnet.arcscan.app", usdc: USDC, w3: W3, factory: result.factory, positionManager: result.positionManager, swapRouter: result.swapRouter, quoterV2: result.quoterV2, staker: result.staker, pools, tickSpacings: result.tickSpacings };
  fs.writeFileSync(path.join(__dirname, "..", "site", "dist", "config.js"), `window.W3_DEX_CONFIG = ${JSON.stringify(config, null, 2)};\n`);
  console.log(JSON.stringify(result, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
