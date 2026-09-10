const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  const [tester] = await ethers.getSigners();
  const config = require("../deployments/arc-testnet-v3.json");
  const rewardsAddress = "0xFe4d300f0c5206af9F2a12b29CA6a25Cc6A03262";
  const amount = ethers.parseEther("0.01");
  const pool = config.pools["500"];
  const w3 = await ethers.getContractAt(
    [
      "function balanceOf(address) view returns(uint256)",
      "function allowance(address,address) view returns(uint256)",
      "function approve(address,uint256) returns(bool)",
    ],
    config.testW3,
    tester,
  );
  const rewards = await ethers.getContractAt(
    [
      "function addIncentive(address,uint256)",
      "function campaignInfo(address) view returns(uint64 id,(uint64 start,uint64 end,uint64 finalizeCursor,bool finalized,uint256 reward,uint256 claimed,uint256 totalScore) campaign,uint256 positionCount)",
    ],
    rewardsAddress,
    tester,
  );

  const balance = await w3.balanceOf(tester.address);
  if (balance < amount) throw Error("Tester W3 balance is below 0.01 W3");
  if ((await w3.allowance(tester.address, rewardsAddress)) < amount) {
    const approveTx = await w3.approve(rewardsAddress, amount);
    console.log("approve tx:", approveTx.hash);
    await approveTx.wait();
  }
  const fundTx = await rewards.addIncentive(pool, amount);
  console.log("fund tx:", fundTx.hash);
  await fundTx.wait();
  const [id, campaign, positionCount] = await rewards.campaignInfo(pool);
  console.log("campaign id:", id.toString());
  console.log("reward W3:", ethers.formatEther(campaign.reward));
  console.log("end timestamp:", campaign.end.toString());
  console.log("position count:", positionCount.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
