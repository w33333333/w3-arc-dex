// All writes run inside two LOCAL Ganache forks. Public mainnets are read-only.
import fs from "node:fs";
import assert from "node:assert/strict";
import ganache from "ganache";
import {
  AbiCoder,
  BrowserProvider,
  Contract,
  ContractFactory,
  formatEther,
  zeroPadValue,
} from "ethers";
import { CHAINS, OTHER } from "../src/config.js";
import {
  SECURITY,
  ENDPOINT_ABI,
  EXECUTOR,
  ulnBytes,
  executorBytes,
  assertUln,
} from "../src/security.js";
import { matchesRuntime } from "../src/validation.js";
const artifact = JSON.parse(fs.readFileSync("artifacts/InventoryBridge.json"));
const report = {
  checkedAt: new Date().toISOString(),
  mode: "LOCAL FORKS ONLY; no mainnet writes",
  chains: {},
};
for (const [k, c] of Object.entries(CHAINS)) {
  console.log(`Testing ${c.name} local fork…`);
  const rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: c.id, hardfork: "shanghai" },
    fork: { url: c.rpc },
    wallet: { totalAccounts: 1 },
  });
  const p = new BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  p.pollingInterval = 10;
  try {
    const signer = await p.getSigner(),
      owner = await signer.getAddress(),
      plan = SECURITY[k],
      eid = CHAINS[OTHER[k]].eid;
    const b = await new ContractFactory(
      artifact.abi,
      artifact.bytecode,
      signer,
    ).deploy(c.token, c.endpoint, owner, eid);
    await b.waitForDeployment();
    assert.ok(matchesRuntime(await p.getCode(b.target), artifact));
    await (await b.setPeer(eid, zeroPadValue(owner, 32))).wait(); // local dummy peer; quote-only
    const e = new Contract(c.endpoint, ENDPOINT_ABI, signer);
    await (await e.setSendLibrary(b.target, eid, plan.send)).wait();
    await (await e.setReceiveLibrary(b.target, eid, plan.receive, 0)).wait();
    await (
      await e.setConfig(b.target, plan.send, [
        { eid, configType: 1, config: executorBytes(k) },
        { eid, configType: 2, config: ulnBytes(k) },
      ])
    ).wait();
    await (
      await e.setConfig(b.target, plan.receive, [
        { eid, configType: 2, config: ulnBytes(k, true) },
      ])
    ).wait();
    const send = assertUln(k, await e.getConfig(b.target, plan.send, eid, 2));
    const receive = assertUln(
      k,
      await e.getConfig(b.target, plan.receive, eid, 2),
      true,
    );
    const [executor] = AbiCoder.defaultAbiCoder().decode(
      [EXECUTOR],
      await e.getConfig(b.target, plan.send, eid, 1),
    );
    assert.equal(executor.executorAddress.toLowerCase(), plan.executor);
    const resultFee = await b.quoteResultFee(),
      block = await p.getBlock("latest");
    const swapFee = await b.quoteSwap(
      owner,
      10n ** 16n,
      block.timestamp + 7 * 86400,
    );
    assert.ok(resultFee.nativeFee > 0n && swapFee.nativeFee > 0n);
    report.chains[k] = {
      success: true,
      send,
      receive,
      executor: executor.executorAddress,
      resultFee: formatEther(resultFee.nativeFee),
      swapFee: formatEther(swapFee.nativeFee),
      currency: c.gas,
    };
    console.log(
      `${c.name}: deployment + explicit dual DVN config + actual protocol quote PASS`,
    );
  } catch (e) {
    report.chains[k] = { success: false, error: e.shortMessage || e.message };
    console.error(k, e.shortMessage || e.message);
    process.exitCode = 1;
  } finally {
    p.destroy();
    await rpc.disconnect();
  }
}
fs.writeFileSync("fork-test-results.json", JSON.stringify(report, null, 2));
