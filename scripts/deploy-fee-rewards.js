const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw Error("Missing DEPLOYER_PRIVATE_KEY");
  const config = require("../deployments/arc-testnet-v3.json");
  const Factory = await ethers.getContractFactory("FeeWeightedV3Rewards", deployer);
  const contract = await Factory.deploy(
    config.testW3,
    config.usdc,
    config.factory,
    config.positionManager,
  );
  console.log("deployment tx:", contract.deploymentTransaction().hash);
  await contract.waitForDeployment();
  console.log("FeeWeightedV3Rewards:", await contract.getAddress());
  console.log("deployer:", deployer.address);
  console.log("gas balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
