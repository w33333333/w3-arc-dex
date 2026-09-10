const hre=require("hardhat");const fs=require("fs");const path=require("path");
const file=path.join(__dirname,"..","deployments","arc-testnet.json");
async function sent(label,p){const tx=await p;console.log(`${label}: ${tx.hash}`);await tx.wait()}
async function main(){
 const {ethers}=hre,[d]=await ethers.getSigners();const x=JSON.parse(fs.readFileSync(file));
 if((await ethers.provider.getNetwork()).chainId!==5042002n)throw Error("wrong chain");
 const f=await ethers.getContractAt("W3PoolFactory",x.factory,d),r=await ethers.getContractAt("W3Router",x.router,d),gf=await ethers.getContractAt("W3GaugeFactory",x.gaugeFactory,d),w=await ethers.getContractAt("TestW3",x.testW3,d);
 const u=new ethers.Contract(x.usdc,["function approve(address,uint256) returns(bool)","function allowance(address,address) view returns(uint256)"],d);
 if(await u.allowance(d.address,x.router)<3_000_000n)await sent("approve USDC",u.approve(x.router,ethers.MaxUint256));
 if(await w.allowance(d.address,x.router)<ethers.parseEther("3000"))await sent("approve W3",w.approve(x.router,ethers.MaxUint256));
 x.pools=x.pools||{};x.gauges=x.gauges||{};const deadline=Math.floor(Date.now()/1000)+3600;
 for(const fee of [100,500,3000]){
  let pool=await f.getPool(x.usdc,x.testW3,fee);
  if(pool===ethers.ZeroAddress){await sent(`create ${fee} pool + liquidity`,r.addLiquidity(x.usdc,x.testW3,fee,1_000_000n,ethers.parseEther("1000"),0,d.address,deadline));pool=await f.getPool(x.usdc,x.testW3,fee)}
  x.pools[String(fee)]=pool;let gauge=await gf.gaugeForPool(pool);
  if(gauge===ethers.ZeroAddress){await sent(`create ${fee} gauge`,gf.createGauge(pool));gauge=await gf.gaugeForPool(pool)}
  x.gauges[String(fee)]=gauge;const g=await ethers.getContractAt("W3Gauge",gauge,d);const now=(await ethers.provider.getBlock("latest")).timestamp;
  if(Number(await g.periodFinish())<=now){const reward=ethers.parseEther("7000");await sent(`approve ${fee} rewards`,w.approve(gauge,reward));await sent(`fund ${fee} 7-day campaign`,g.notifyRewardAmount(reward,7*86400))}
 }
 x.nativeUsdcAfter=ethers.formatEther(await ethers.provider.getBalance(d.address));x.allFeePoolsReady=true;x.updatedAt=new Date().toISOString();fs.writeFileSync(file,JSON.stringify(x,null,2));
 const c={chainId:5042002,chainHex:"0x4cef52",rpcUrl:"https://rpc.testnet.arc.network",explorer:"https://testnet.arcscan.app",usdc:x.usdc,w3:x.testW3,factory:x.factory,router:x.router,gaugeFactory:x.gaugeFactory,pools:x.pools,gauges:x.gauges};
 fs.writeFileSync(path.join(__dirname,"..","site","dist","config.js"),`window.W3_DEX_CONFIG = ${JSON.stringify(c,null,2)};\n`);console.log(JSON.stringify(x,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
