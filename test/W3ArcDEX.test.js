const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("W3 ARC DEX", function () {
  async function fixture() {
    const [owner, lp, trader] = await ethers.getSigners();
    const tokenA = await ethers.deployContract("MockERC20", ["Token A", "A", 18]);
    const tokenB = await ethers.deployContract("MockERC20", ["Token B", "B", 18]);
    const w3 = await ethers.deployContract("MockERC20", ["W3", "W3", 18]);
    const factory = await ethers.deployContract("W3PoolFactory");
    const router = await ethers.deployContract("W3Router", [await factory.getAddress()]);
    const gaugeFactory = await ethers.deployContract("W3GaugeFactory", [await factory.getAddress(), await w3.getAddress()]);
    for (const u of [lp, trader]) { await tokenA.mint(u.address, ethers.parseEther("10000")); await tokenB.mint(u.address, ethers.parseEther("10000")); }
    return { owner, lp, trader, tokenA, tokenB, w3, factory, router, gaugeFactory };
  }

  it("only permits the three configured fee tiers", async function () {
    const { tokenA, tokenB, factory } = await fixture();
    for (const fee of [100, 500, 3000]) { await expect(factory.createPool(tokenA, tokenB, fee)).to.emit(factory, "PoolCreated"); }
    await expect(factory.createPool(tokenA, tokenB, 10000)).to.be.revertedWith("UNSUPPORTED_FEE");
  });

  it("adds liquidity, swaps with the selected fee, and removes liquidity", async function () {
    const { lp, trader, tokenA, tokenB, factory, router } = await fixture();
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    await tokenA.connect(lp).approve(router, ethers.MaxUint256); await tokenB.connect(lp).approve(router, ethers.MaxUint256);
    await router.connect(lp).addLiquidity(tokenA, tokenB, 500, ethers.parseEther("1000"), ethers.parseEther("1000"), 0, lp.address, deadline);
    const poolAddress = await factory.getPool(tokenA, tokenB, 500); const pool = await ethers.getContractAt("W3Pool", poolAddress);
    await tokenA.connect(trader).approve(router, ethers.MaxUint256);
    const quoted = await router.getAmountOut(ethers.parseEther("10"), tokenA, tokenB, 500);
    const before = await tokenB.balanceOf(trader.address);
    await router.connect(trader).swapExactTokensForTokens(ethers.parseEther("10"), quoted, tokenA, tokenB, 500, trader.address, deadline);
    expect((await tokenB.balanceOf(trader.address)) - before).to.equal(quoted);
    const liquidity = await pool.balanceOf(lp.address); await pool.connect(lp).approve(router, liquidity);
    await expect(router.connect(lp).removeLiquidity(tokenA, tokenB, 500, liquidity, 0, 0, lp.address, deadline)).not.to.be.reverted;
  });

  it("stakes LP and distributes W3 incentives", async function () {
    const { lp, tokenA, tokenB, w3, factory, router, gaugeFactory } = await fixture();
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    await tokenA.connect(lp).approve(router, ethers.MaxUint256); await tokenB.connect(lp).approve(router, ethers.MaxUint256);
    await router.connect(lp).addLiquidity(tokenA, tokenB, 3000, ethers.parseEther("1000"), ethers.parseEther("1000"), 0, lp.address, deadline);
    const poolAddress = await factory.getPool(tokenA, tokenB, 3000); await gaugeFactory.createGauge(poolAddress);
    const gauge = await ethers.getContractAt("W3Gauge", await gaugeFactory.gaugeForPool(poolAddress));
    const pool = await ethers.getContractAt("W3Pool", poolAddress); const stake = await pool.balanceOf(lp.address);
    await pool.connect(lp).approve(gauge, stake); await gauge.connect(lp).deposit(stake);
    const reward = ethers.parseEther("700"); await w3.mint(lp.address, reward); await w3.connect(lp).approve(gauge, reward);
    await gauge.connect(lp).notifyRewardAmount(reward, 7 * 86400); await ethers.provider.send("evm_increaseTime", [86400]); await ethers.provider.send("evm_mine");
    await gauge.connect(lp).getReward(); expect(await w3.balanceOf(lp.address)).to.be.closeTo(ethers.parseEther("100"), ethers.parseEther("0.01"));
  });
});
