const fs = require("fs");
const path = require("path");
const { Wallet } = require("ethers");

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) throw new Error(".env already exists; refusing to overwrite it");

const wallet = Wallet.createRandom();
const contents = [
  "ARC_RPC_URL=https://rpc.testnet.arc.network",
  `DEPLOYER_PRIVATE_KEY=${wallet.privateKey}`,
  "W3_TOKEN=",
  "INITIAL_W3_SUPPLY=100000000",
  "",
].join("\n");
fs.writeFileSync(envPath, contents, { mode: 0o600, flag: "wx" });
console.log(wallet.address);
