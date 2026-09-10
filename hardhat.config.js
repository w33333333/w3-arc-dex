require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");
const fs = require("fs");
const path = require("path");
const v3Settings = { optimizer: { enabled: true, runs: 800 }, metadata: { bytecodeHash: "none" } };
function solidityFiles(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? solidityFiles(path.join(dir, e.name)) : e.name.endsWith(".sol") ? [path.join(dir, e.name).replaceAll(path.sep, "/")] : []); }
const v3Overrides = Object.fromEntries(solidityFiles(path.join(__dirname, "contracts/v3core")).map(file => [path.relative(__dirname, file).replaceAll(path.sep, "/"), { version: "0.7.6", settings: v3Settings }]));

// Use the pinned npm solc package, keeping compilation reproducible/offline.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }, _hre, runSuper) => {
  if (solcVersion === "0.8.26") {
    return { compilerPath: require.resolve("solc/soljson.js"), isSolcJs: true, version: solcVersion, longVersion: "0.8.26+commit.8a97fa7a" };
  }
  if (solcVersion === "0.7.6") {
    return { compilerPath: require.resolve("solc-0.7/soljson.js"), isSolcJs: true, version: solcVersion, longVersion: "0.7.6+commit.7338295f" };
  }
  return runSuper();
});

const accounts = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];

module.exports = {
  solidity: {
    compilers: [
      { version: "0.8.26", settings: { optimizer: { enabled: true, runs: 500 }, viaIR: true } },
      { version: "0.7.6", settings: { optimizer: { enabled: true, runs: 800 }, metadata: { bytecodeHash: "none" } } }
    ],
    overrides: v3Overrides
  },
  networks: {
    arcTestnet: {
      url: process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network",
      chainId: 5042002,
      accounts,
    },
  },
};
