const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const { ethers, network } = hre;
  if (network.config.chainId !== 5042002) throw new Error("Refusing deployment: expected ARC Testnet chainId 5042002");
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("Set DEPLOYER_PRIVATE_KEY in your local .env (never paste it into chat)");
  const actualChainId = (await ethers.provider.getNetwork()).chainId;
  if (actualChainId !== 5042002n) throw new Error(`RPC returned unexpected chainId ${actualChainId}`);

  let w3 = process.env.W3_TOKEN;
  let testW3 = false;
  if (!w3) {
    const supply = ethers.parseEther(process.env.INITIAL_W3_SUPPLY || "100000000");
    const token = await ethers.deployContract("TestW3", [deployer.address, supply]);
    await token.waitForDeployment(); w3 = await token.getAddress(); testW3 = true;
  } else if (!ethers.isAddress(w3)) throw new Error("W3_TOKEN is not a valid address");

  const factory = await ethers.deployContract("W3PoolFactory"); await factory.waitForDeployment();
  const router = await ethers.deployContract("W3Router", [await factory.getAddress()]); await router.waitForDeployment();
  const gaugeFactory = await ethers.deployContract("W3GaugeFactory", [await factory.getAddress(), w3]); await gaugeFactory.waitForDeployment();
  const result = {
    network: "arcTestnet", chainId: Number(actualChainId), deployer: deployer.address,
    w3, testW3, factory: await factory.getAddress(), router: await router.getAddress(),
    gaugeFactory: await gaugeFactory.getAddress(), supportedFeePpm: [100, 500, 3000],
  };
  fs.mkdirSync(path.join(__dirname, "..", "deployments"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "..", "deployments", "arc-testnet.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
