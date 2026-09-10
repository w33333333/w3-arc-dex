import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import {
  AbiCoder,
  BrowserProvider,
  ContractFactory,
  ZeroHash,
  parseUnits,
  zeroPadValue,
} from "ethers";
const rpc = ganache.provider({
  logging: { quiet: true },
  wallet: { totalAccounts: 3 },
  chain: { hardfork: "shanghai" },
});
const provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
provider.pollingInterval = 10;
const owner = await provider.getSigner(0),
  user = await provider.getSigner(1),
  stranger = await provider.getSigner(2);
const oa = await owner.getAddress(),
  ua = await user.getAddress();
const artifact = (n) => JSON.parse(fs.readFileSync(`artifacts/${n}.json`));
async function deploy(n, ...args) {
  const a = artifact(n);
  const c = await new ContractFactory(a.abi, a.bytecode, owner).deploy(...args);
  await c.waitForDeployment();
  return c;
}
const ea = await deploy("TestEndpoint"),
  eb = await deploy("TestEndpoint");
const ta = await deploy("TestToken", 18),
  tb = await deploy("TestToken", 6);
const a = await deploy("InventoryBridge", ta.target, ea.target, oa, 102),
  b = await deploy("InventoryBridge", tb.target, eb.target, oa, 101);
const tx = async (p) => (await p).wait();
for (const [bridge, token, other, eid, d] of [
  [a, ta, b, 102, 18],
  [b, tb, a, 101, 6],
]) {
  await tx(bridge.setPeer(eid, zeroPadValue(other.target, 32)));
  await tx(bridge.setPaused(false));
  await tx(token.mint(oa, parseUnits("10", d)));
  await tx(token.mint(ua, parseUnits("10", d)));
  await tx(token.approve(bridge.target, parseUnits("10", d)));
  await tx(token.connect(user).approve(bridge.target, parseUnits("10", d)));
  await tx(bridge.fund(parseUnits("1", d)));
}
let snapshot = await rpc.request({ method: "evm_snapshot", params: [] });
async function reset() {
  await rpc.request({ method: "evm_revert", params: [snapshot] });
  snapshot = await rpc.request({ method: "evm_snapshot", params: [] });
}
async function deadline() {
  return Number((await provider.getBlock("latest")).timestamp) + 1800;
}
async function swap(bridge, amount, expiry) {
  const receipt = await tx(
    bridge
      .connect(user)
      .swap(amount, expiry ?? (await deadline()), { value: 1000 }),
  );
  return receipt.logs
    .map((l) => {
      try {
        return bridge.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((l) => l?.name === "SwapRequested").args.id;
}
async function deliver(fromEndpoint, toEndpoint, toBridge, srcEid, index = 0) {
  const p = await fromEndpoint.packets(index);
  const receipt = await tx(
    toEndpoint.deliver(
      toBridge.target,
      srcEid,
      zeroPadValue(p.sender, 32),
      index + 1,
      p.guid,
      p.message,
    ),
  );
  assert.ok(
    receipt.gasUsed < 250000n,
    `Receive gas exceeds configured budget: ${receipt.gasUsed}`,
  );
  return receipt;
}
async function invariant(bridge, token) {
  assert.equal(
    await token.balanceOf(bridge.target),
    (await bridge.freeLiquidity()) +
      (await bridge.escrowed()) +
      (await bridge.reserved()) +
      (await bridge.refundable()),
  );
}
async function check(name, fn) {
  await test(name, async () => {
    await reset();
    await fn();
    await invariant(a, ta);
    await invariant(b, tb);
  });
}

await check(
  "1:1 round trip across 18/6 decimals; reserved payout may precede acknowledgement",
  async () => {
    const id = await swap(a, parseUnits("0.2", 18));
    await deliver(ea, eb, b, 101);
    assert.equal(await b.reserved(), 200000n);
    await tx(b.connect(user).claim(id, ua));
    assert.equal(await tb.balanceOf(ua), 10200000n);
    assert.equal(await a.escrowed(), parseUnits("0.2", 18));
    await tx(b.relayResult(id, { value: 1000 }));
    await deliver(eb, ea, a, 102);
    assert.equal((await a.outbound(id)).state, 2n);
    assert.equal(await a.freeLiquidity(), parseUnits("1.2", 18));
    const reverse = await swap(b, 200000n);
    await deliver(eb, ea, a, 102, 1);
    await tx(a.connect(user).claim(reverse, ua));
    await tx(a.relayResult(reverse, { value: 1000 }));
    await deliver(ea, eb, b, 101, 1);
    assert.equal(await ta.balanceOf(ua), parseUnits("10", 18));
    assert.equal(await tb.balanceOf(ua), 10000000n);
  },
);
await check(
  "insufficient inventory is rejected and refund requires authenticated result",
  async () => {
    await tx(b.withdrawFree(1000000, oa));
    const id = await swap(a, parseUnits("0.1", 18));
    await assert.rejects(() => a.connect(user).claimRefund(id, ua));
    await deliver(ea, eb, b, 101);
    assert.equal((await b.inbound(id)).state, 2n);
    await tx(b.relayResult(id, { value: 1000 }));
    await deliver(eb, ea, a, 102);
    await tx(a.withdrawFree(parseUnits("1", 18), oa));
    await assert.rejects(() => a.withdrawFree(1, oa));
    await tx(a.connect(user).claimRefund(id, ua));
    assert.equal(await ta.balanceOf(ua), parseUnits("10", 18));
    await assert.rejects(() => a.connect(user).claimRefund(id, ua));
  },
);
await check(
  "duplicate requests and results cannot reserve, settle or pay twice",
  async () => {
    const id = await swap(a, parseUnits("0.3", 18));
    await deliver(ea, eb, b, 101);
    await deliver(ea, eb, b, 101);
    assert.equal(await b.reserved(), 300000n);
    await tx(b.relayResult(id, { value: 1000 }));
    await deliver(eb, ea, a, 102);
    await deliver(eb, ea, a, 102);
    assert.equal(await a.freeLiquidity(), parseUnits("1.3", 18));
    await tx(b.connect(user).claim(id, ua));
    await assert.rejects(() => b.connect(user).claim(id, ua));
  },
);
await check(
  "owner cannot withdraw escrow, destination reservations or pending refunds",
  async () => {
    const id = await swap(a, parseUnits("0.4", 18));
    await tx(a.withdrawFree(parseUnits("1", 18), oa));
    await assert.rejects(() => a.withdrawFree(1, oa));
    await deliver(ea, eb, b, 101);
    await tx(b.withdrawFree(600000, oa));
    await assert.rejects(() => b.withdrawFree(1, oa));
    await tx(b.connect(user).claim(id, ua));
  },
);
await check(
  "late request rejects rather than leaving an unfillable destination claim",
  async () => {
    const id = await swap(a, parseUnits("0.1", 18), (await deadline()) - 1790);
    await rpc.request({ method: "evm_increaseTime", params: [20] });
    await rpc.request({ method: "evm_mine", params: [] });
    await deliver(ea, eb, b, 101);
    assert.equal((await b.inbound(id)).state, 2n);
  },
);
await check(
  "pause rejects new inbound orders but never blocks existing claims or results",
  async () => {
    const id = await swap(a, parseUnits("0.1", 18));
    await deliver(ea, eb, b, 101);
    await tx(b.setPaused(true));
    await tx(b.connect(user).claim(id, ua));
    await tx(b.relayResult(id, { value: 1000 }));
    await deliver(eb, ea, a, 102);
    const id2 = await swap(a, parseUnits("0.1", 18));
    await deliver(ea, eb, b, 101, 1);
    assert.equal((await b.inbound(id2)).state, 2n);
  },
);
await check(
  "arbitrary callers, wrong remote peer and wrong chain cannot inject outcomes",
  async () => {
    const id = await swap(a, parseUnits("0.1", 18));
    const msg = AbiCoder.defaultAbiCoder().encode(
      ["uint8", "bytes32", "bool"],
      [2, id, true],
    );
    await assert.rejects(() =>
      a
        .connect(stranger)
        .lzReceive(
          [102, zeroPadValue(b.target, 32), 1],
          ZeroHash,
          msg,
          oa,
          "0x",
        ),
    );
    await assert.rejects(() =>
      ea.deliver(a.target, 102, zeroPadValue(oa, 32), 1, ZeroHash, msg),
    );
    await assert.rejects(() =>
      ea.deliver(a.target, 999, zeroPadValue(b.target, 32), 1, ZeroHash, msg),
    );
    assert.equal((await a.outbound(id)).state, 1n);
  },
);
await check(
  "peer is immutable once set; only owner can fund, withdraw or pause",
  async () => {
    await assert.rejects(() => a.setPeer(102, zeroPadValue(oa, 32)));
    await assert.rejects(() => a.setPeer(103, zeroPadValue(b.target, 32)));
    await assert.rejects(() => a.connect(user).withdrawFree(1, ua));
    await assert.rejects(() => a.connect(user).fund(1));
    await assert.rejects(() => a.connect(user).setPaused(true));
  },
);
await check(
  "zero, dust, over-one-token amounts, expired deadlines and missing fee revert atomically",
  async () => {
    for (const amount of [0n, 1n, parseUnits("1.000001", 18)])
      await assert.rejects(() => swap(a, amount));
    await assert.rejects(() => swap(a, parseUnits("0.1", 18), 1));
    await assert.rejects(async () =>
      tx(
        a
          .connect(user)
          .swap(parseUnits("0.1", 18), await deadline(), { value: 0 }),
      ),
    );
    assert.equal(await a.escrowed(), 0n);
    assert.equal(await ta.balanceOf(ua), parseUnits("10", 18));
  },
);
await check(
  "fee-on-transfer deposits revert instead of creating unbacked accounting",
  async () => {
    await tx(ta.setTaxed(true));
    await assert.rejects(() => a.fund(parseUnits("0.1", 18)));
    await assert.rejects(() => swap(a, parseUnits("0.1", 18)));
  },
);
await check(
  "failed taxed payout retains reservation and can retry after token behaviour recovers",
  async () => {
    const id = await swap(a, parseUnits("0.1", 18));
    await deliver(ea, eb, b, 101);
    await tx(tb.setTaxed(true));
    await assert.rejects(() => b.connect(user).claim(id, ua));
    assert.equal((await b.inbound(id)).state, 1n);
    await tx(tb.setTaxed(false));
    await tx(b.connect(user).claim(id, ua));
  },
);
await check(
  "only beneficiary can claim; invalid recipient does not consume claim",
  async () => {
    const id = await swap(a, parseUnits("0.1", 18));
    await deliver(ea, eb, b, 101);
    await assert.rejects(() => b.connect(stranger).claim(id, oa));
    await assert.rejects(() => b.connect(user).claim(id, b.target));
    await tx(b.connect(user).claim(id, ua));
  },
);
await check(
  "concurrent requests cannot overbook destination; reordered acknowledgements preserve balances",
  async () => {
    const one = await swap(a, parseUnits("0.7", 18));
    const two = await swap(a, parseUnits("0.7", 18));
    await deliver(ea, eb, b, 101, 1);
    await deliver(ea, eb, b, 101, 0);
    assert.equal((await b.inbound(two)).state, 1n);
    assert.equal((await b.inbound(one)).state, 2n);
    await tx(b.relayResult(one, { value: 1000 }));
    await tx(b.relayResult(two, { value: 1000 }));
    await deliver(eb, ea, a, 102, 1);
    await deliver(eb, ea, a, 102, 0);
    await tx(a.connect(user).claimRefund(one, ua));
    await tx(b.connect(user).claim(two, ua));
  },
);
await check(
  "unknown result and invalid message kind revert; no unbounded amount conversion",
  async () => {
    const coder = AbiCoder.defaultAbiCoder();
    for (const msg of [
      coder.encode(["uint8", "bytes32", "bool"], [2, ZeroHash, true]),
      coder.encode(["uint8"], [3]),
      coder.encode(
        ["uint8", "bytes32", "address", "uint256", "uint64"],
        [1, ZeroHash, ua, 1000001, await deadline()],
      ),
    ])
      await assert.rejects(() =>
        ea.deliver(a.target, 102, zeroPadValue(b.target, 32), 1, ZeroHash, msg),
      );
  },
);
after(async () => {
  provider.destroy();
  await rpc.disconnect();
});
