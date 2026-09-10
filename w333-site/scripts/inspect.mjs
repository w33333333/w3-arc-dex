import fs from "node:fs";
import { Contract, JsonRpcProvider, keccak256 } from "ethers";
import { CHAINS, TOKEN_ABI } from "../src/config.js";
const report = { checkedAt: new Date().toISOString(), chains: {} };
for (const [key, cfg] of Object.entries(CHAINS)) {
  const provider = new JsonRpcProvider(cfg.rpc, cfg.id, {
    staticNetwork: true,
  });
  try {
    const chainId = Number(await provider.send("eth_chainId", []));
    if (chainId !== cfg.id) throw Error("Wrong RPC chain");
    const block = await provider.getBlockNumber();
    const token = new Contract(cfg.token, TOKEN_ABI, provider);
    const endpoint = new Contract(
      cfg.endpoint,
      ["function eid() view returns(uint32)"],
      provider,
    );
    const [symbol, decimals, code, endpointEid] = await Promise.all([
      token.symbol({ blockTag: block }),
      token.decimals({ blockTag: block }),
      provider.getCode(cfg.token, block),
      endpoint.eid({ blockTag: block }),
    ]);
    report.chains[key] = {
      chainId,
      block,
      token: cfg.token,
      symbol,
      decimals: Number(decimals),
      codeHash: keccak256(code),
      codeBytes: (code.length - 2) / 2,
      endpointEid: Number(endpointEid),
      endpointMatches: Number(endpointEid) === cfg.eid,
    };
    if (code === "0x" || Number(endpointEid) !== cfg.eid)
      throw Error("Missing token or wrong endpoint");
  } catch (e) {
    report.chains[key] = {
      ...report.chains[key],
      error: e.shortMessage || e.message,
    };
    process.exitCode = 1;
  }
  provider.destroy();
}
fs.writeFileSync("token-check.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
