export const CHAINS = {
  xlayer: {
    name: "X Layer",
    id: 196,
    eid: 30274,
    gas: "OKB",
    rpc: "https://rpc.xlayer.tech",
    explorer: "https://www.okx.com/web3/explorer/xlayer",
    token: "0x5164b016ef0778076f6acd24436f84d3c3aa91dc",
    endpoint: "0x1a44076050125825900e736c501f859c50fE728c",
  },
  bnb: {
    name: "BNB Chain",
    id: 56,
    eid: 30102,
    gas: "BNB",
    rpc: "https://bsc-dataseed.bnbchain.org",
    explorer: "https://bscscan.com",
    token: "0x71d912f1b3e6a559f6f34da4689a0901a7b37214",
    endpoint: "0x1a44076050125825900e736c501f859c50fE728c",
  },
};
export const TOKEN_ABI = [
  "function symbol() view returns(string)",
  "function decimals() view returns(uint8)",
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
];
export const OTHER = { xlayer: "bnb", bnb: "xlayer" };
