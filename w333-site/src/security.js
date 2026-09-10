import { AbiCoder } from "ethers";
import { OTHER } from "./config.js";

// Official deployment addresses checked against live RPC, 2026-09-09.
// Preserve observed confirmation depths; do NOT silently lower them for faster demos.
export const SECURITY = {
  xlayer: {
    send: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043",
    receive: "0x2367325334447c5e1e0f1b3a6fb947b262f58312",
    executor: "0xcce466a522984415bc91338c232d98869193d46e",
    confirmations: 225000,
    dvns: [
      "0x9c061c9a4782294eef65ef28cb88233a987f4bdd",
      "0x28af4dadbc5066e994986e8bb105240023dc44b6",
    ],
  },
  bnb: {
    send: "0x9f8c645f2d0b2159767bd6e0839de4be49e823de",
    receive: "0xb217266c3a98c8b2709ee26836c98cf12f6ccec1",
    executor: "0x3ebd570ed38b1b3b4bc886999fcf507e9d584859",
    confirmations: 20,
    dvns: [
      "0xfd6865c841c2d64565562fcc7e05e619a30615f0",
      "0x31f748a368a893bdb5abb67ec95f232507601a73",
    ],
  },
};
export const ULN =
  "tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs)";
export const EXECUTOR = "tuple(uint32 maxMessageSize,address executorAddress)";
export const ENDPOINT_ABI = [
  "function getSendLibrary(address,uint32) view returns(address)",
  "function isDefaultSendLibrary(address,uint32) view returns(bool)",
  "function getReceiveLibrary(address,uint32) view returns(address,bool)",
  "function getConfig(address,address,uint32,uint32) view returns(bytes)",
  "function setSendLibrary(address,uint32,address)",
  "function setReceiveLibrary(address,uint32,address,uint256)",
  "function setConfig(address,address,(uint32 eid,uint32 configType,bytes config)[])",
];
export function ulnBytes(k, receive = false) {
  const c = SECURITY[k],
    depth = SECURITY[receive ? OTHER[k] : k].confirmations;
  return AbiCoder.defaultAbiCoder().encode(
    [ULN],
    [[depth, 2, 255, 0, [...c.dvns].sort(), []]],
  );
}
export function executorBytes(k) {
  return AbiCoder.defaultAbiCoder().encode(
    [EXECUTOR],
    [[10000, SECURITY[k].executor]],
  );
}
export function assertUln(k, raw, receive = false) {
  const [v] = AbiCoder.defaultAbiCoder().decode([ULN], raw),
    expected = SECURITY[k],
    depth = SECURITY[receive ? OTHER[k] : k].confirmations;
  const addresses = Array.from(v.requiredDVNs)
    .map((a) => a.toLowerCase())
    .sort();
  if (
    v.confirmations !== BigInt(depth) ||
    v.requiredDVNCount !== 2n ||
    v.optionalDVNCount !== 0n ||
    v.optionalDVNThreshold !== 0n ||
    v.optionalDVNs.length ||
    JSON.stringify(addresses) !== JSON.stringify([...expected.dvns].sort())
  )
    throw Error(
      `${k} ${receive ? "接收" : "发送"}验证配置不匹配；请先配置双验证器`,
    );
  return {
    confirmations: String(v.confirmations),
    requiredDVNs: Array.from(v.requiredDVNs),
    optionalDVNs: [],
  };
}
