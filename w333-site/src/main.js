import "./style.css";
import { matchesRuntime } from "./validation.js";
import {
  SECURITY,
  ENDPOINT_ABI,
  EXECUTOR,
  ulnBytes,
  executorBytes,
  assertUln,
} from "./security.js";
import {
  AbiCoder,
  BrowserProvider,
  Contract,
  ContractFactory,
  JsonRpcProvider,
  ZeroAddress,
  ZeroHash,
  formatEther,
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
  zeroPadValue,
} from "ethers";
import { CHAINS, OTHER, TOKEN_ABI } from "./config.js";

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const short = (s) => (s ? `${s.slice(0, 6)}…${s.slice(-4)}` : "未设置");
const storageKey = "one-bridge-config-v1",
  ordersKey = "one-bridge-orders-v1";
function stored(k, fallback) {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? fallback;
  } catch {
    return fallback;
  }
}
const artifact = await fetch("/InventoryBridge.json").then((r) => {
  if (!r.ok) throw Error("先运行 npm run compile");
  return r.json();
});
const published = await fetch("/deployments.json")
  .then((r) => r.json())
  .catch(() => ({}));
const config = {
  ...{ xlayer: "", bnb: "" },
  ...published,
  ...stored(storageKey, {}),
};
for (const key of Object.keys(CHAINS))
  if (!isAddress(config[key])) config[key] = "";
let orders = stored(ordersKey, []);
if (!Array.isArray(orders)) orders = [];
let source = "xlayer",
  account = "",
  wallet = null,
  busy = false,
  currentTab = "swap",
  review = null,
  toastTimer,
  polling = false,
  operationStage = "";
const providers = Object.fromEntries(
  Object.entries(CHAINS).map(([k, c]) => [
    k,
    new JsonRpcProvider(c.rpc, c.id, { staticNetwork: true }),
  ]),
);
const bridge = (k, runner = providers[k], address = config[k]) => {
  if (!address) throw Error(`${CHAINS[k].name} 尚未配置兑换合约`);
  return new Contract(address, artifact.abi, runner);
};
const token = (k, runner = providers[k]) =>
  new Contract(CHAINS[k].token, TOKEN_ABI, runner);
const wallets = [];
function announce(info, provider) {
  if (!provider || wallets.some((w) => w.provider === provider)) return;
  wallets.push({ info, provider });
  renderWallets();
}
window.addEventListener("eip6963:announceProvider", (e) =>
  announce(e.detail.info, e.detail.provider),
);
window.dispatchEvent(new Event("eip6963:requestProvider"));
if (window.okxwallet) announce({ name: "OKX Wallet" }, window.okxwallet);
if (window.ethereum)
  announce(
    { name: window.ethereum.isMetaMask ? "MetaMask" : "浏览器钱包" },
    window.ethereum,
  );
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").className = `show ${error ? "error" : ""}`;
  toastTimer = setTimeout(
    () => ($("#toast").className = ""),
    error ? 14000 : 8000,
  );
}
function message(e) {
  if (e.code === 4001 || e.code === "ACTION_REJECTED")
    return "已取消钱包操作，尚未完成的步骤可以重试。";
  return e.reason || e.shortMessage || e.message || String(e);
}
async function run(fn) {
  if (busy) return;
  busy = true;
  document.body.classList.add("busy");
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    await fn();
  } catch (e) {
    console.error(e);
    toast(`${operationStage ? operationStage + "：" : ""}${message(e)}`, true);
  } finally {
    operationStage = "";
    busy = false;
    document.body.classList.remove("busy");
    document.querySelectorAll("button").forEach((b) => (b.disabled = false));
    await refresh();
  }
}
function persistConfig() {
  localStorage.setItem(storageKey, JSON.stringify(config));
  renderSetup();
}
function persistOrders() {
  localStorage.setItem(ordersKey, JSON.stringify(orders));
  $("#order-count").textContent = String(
    orders.filter(
      (o) => !account || o.user?.toLowerCase() === account.toLowerCase(),
    ).length,
  );
}
function download(name, value) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function tab(name) {
  currentTab = name;
  for (const n of ["swap", "orders", "setup"]) {
    $(`#${n}-view`).classList.toggle("hidden", n !== name);
    $(`[data-tab=${n}]`).classList.toggle("active", n === name);
  }
  if (name === "orders") refreshOrders();
}
document
  .querySelectorAll("[data-tab]")
  .forEach((b) => (b.onclick = () => tab(b.dataset.tab)));
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => $(`#${b.dataset.close}`).close()));
function renderWallets() {
  const box = $("#wallet-list");
  box.replaceChildren();
  if (!wallets.length) {
    box.textContent =
      "未发现钱包。请在安装了 OKX Wallet 或 MetaMask 的浏览器中打开此页面。";
    return;
  }
  wallets.forEach((w) => {
    const b = document.createElement("button");
    b.textContent = w.info.name || "浏览器钱包";
    b.onclick = () =>
      run(async () => {
        const accounts = await w.provider.request({
          method: "eth_requestAccounts",
        });
        if (!accounts.length) throw Error("钱包没有可用账户");
        if (wallet?.removeListener) {
          wallet.removeListener("accountsChanged", accountsChanged);
          wallet.removeListener("chainChanged", chainChanged);
        }
        wallet = w.provider;
        account = getAddress(accounts[0]);
        wallet.on?.("accountsChanged", accountsChanged);
        wallet.on?.("chainChanged", chainChanged);
        $("#wallet-dialog").close();
        toast("钱包已连接");
      });
    box.append(b);
  });
}
function accountsChanged(accounts) {
  account = accounts[0] ? getAddress(accounts[0]) : "";
  review = null;
  $("#review-dialog").close();
  refresh();
}
function chainChanged() {
  if (!busy) refresh();
}
function connect() {
  renderWallets();
  $("#wallet-dialog").showModal();
}
$("#connect").onclick = connect;
async function signerFor(k) {
  if (!wallet || !account) throw Error("请先连接钱包");
  const expected = account,
    c = CHAINS[k];
  try {
    const currentChain = await wallet.request({ method: "eth_chainId" });
    if (Number(currentChain) !== c.id) await wallet.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x" + c.id.toString(16) }],
    });
  } catch (e) {
    if (e.code !== 4902) throw e;
    await wallet.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0x" + c.id.toString(16),
          chainName: c.name,
          nativeCurrency: { name: c.gas, symbol: c.gas, decimals: 18 },
          rpcUrls: [c.rpc],
          blockExplorerUrls: [c.explorer],
        },
      ],
    });
    await wallet.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x" + c.id.toString(16) }],
    });
  }
  await assertWallet(k, expected);
  return new BrowserProvider(wallet, "any").getSigner(expected);
}
async function assertWallet(k, expected) {
  const [id, accounts] = await Promise.all([
    wallet.request({ method: "eth_chainId" }),
    wallet.request({ method: "eth_accounts" }),
  ]);
  if (
    Number(id) !== CHAINS[k].id ||
    accounts[0]?.toLowerCase() !== expected.toLowerCase()
  )
    throw Error("钱包账户或网络已变化，请重新操作。");
}
async function checked(k, address = config[k], reader = providers[k]) {
  const c = CHAINS[k],
    b = bridge(k, reader, address);
  const runtime = await reader.getCode(address);
  if (!matchesRuntime(runtime, artifact))
    throw Error(`${c.name} 合约字节码与本项目构建不一致`);
  const [t, eid, endpoint, scale] = await Promise.all([
    b.token(),
    b.remoteEid(),
    b.endpoint(),
    b.scale(),
  ]);
  if (
    t.toLowerCase() !== c.token.toLowerCase() ||
    Number(eid) !== CHAINS[OTHER[k]].eid ||
    endpoint.toLowerCase() !== c.endpoint.toLowerCase() ||
    scale !== 10n ** 12n
  )
    throw Error(`${c.name} 合约参数不匹配`);
  return b;
}
async function checkPeers() {
  const [a, b] = await Promise.all([checked("xlayer"), checked("bnb")]);
  const peers = await Promise.all([
    a.peers(CHAINS.bnb.eid),
    b.peers(CHAINS.xlayer.eid),
  ]);
  if (
    peers[0].toLowerCase() !== zeroPadValue(config.bnb, 32).toLowerCase() ||
    peers[1].toLowerCase() !== zeroPadValue(config.xlayer, 32).toLowerCase()
  )
    throw Error("两个合约尚未正确互相绑定");
  return { xlayer: a, bnb: b };
}
function amountValue() {
  const raw = $("#amount").value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(raw))
    throw Error("请输入最多 6 位小数的数量");
  const value = parseUnits(raw, 18);
  if (value <= 0n || value > parseUnits("1", 18))
    throw Error("兑换数量必须在 0.000001 至 1 W3 之间");
  return value;
}
$("#amount").oninput = () => {
  $("#receive").textContent = $("#amount").value || "0";
  review = null;
};
$("#set-small").onclick = () => {
  $("#amount").value = "0.01";
  $("#receive").textContent = "0.01";
};
$("#flip").onclick = () => {
  source = OTHER[source];
  review = null;
  refresh();
};
async function refresh() {
  const s = source,
    d = OTHER[s];
  $("#source-name").textContent = CHAINS[s].name;
  $("#destination-name").textContent = CHAINS[d].name;
  $("#connect").textContent = account ? short(account) : "连接钱包 ↗";
  $("#recipient").textContent = account
    ? short(account)
    : "连接后使用同一钱包地址";
  $("#recipient").title = account;
  $("#balance").textContent = "—";
  $("#liquidity").textContent = "—";
  $("#swap").textContent = account ? "预览兑换" : "连接钱包";
  $("#swap").disabled = busy;
  persistOrders();
  if (wallet) {
    try {
      const id = Number(await wallet.request({ method: "eth_chainId" }));
      $("#network-label").textContent =
        `${Object.values(CHAINS).find((c) => c.id === id)?.name || "其他网络"} · ${short(account)}`;
    } catch {}
  }
  if (account)
    token(s)
      .balanceOf(account)
      .then((v) => {
        if (source === s) $("#balance").textContent = formatUnits(v, 18);
      })
      .catch(() => {});
  const ready = $("#readiness");
  ready.className = "notice";
  if (!config[s] || !config[d]) {
    ready.textContent = "尚未部署 · 请先在库存管理中配置合约";
    if (account) $("#swap").disabled = true;
    return;
  }
  try {
    const bs = await checkPeers();
    const [pausedS, pausedD, free] = await Promise.all([
      bs[s].paused(),
      bs[d].paused(),
      bs[d].freeLiquidity(),
    ]);
    if (source !== s) return;
    $("#liquidity").textContent = formatUnits(free, 18);
    ready.className = `notice ${pausedS || pausedD ? "" : "ready"}`;
    ready.textContent =
      pausedS || pausedD
        ? "路径已绑定 · 管理员尚未开启两端兑换"
        : "路径已开启 · 结果回传和领取需要目标链 gas";
    $("#swap").disabled = busy || pausedS || pausedD;
  } catch (e) {
    ready.textContent = message(e);
    if (account) $("#swap").disabled = true;
  }
}
$("#swap").onclick = () => {
  if (!account) {
    connect();
    return;
  }
  run(async () => {
    const s = source,
      d = OTHER[s],
      amount = amountValue(),
      user = account,
      bs = await checkPeers();
    const [p1, p2, balance, free] = await Promise.all([
      bs[s].paused(),
      bs[d].paused(),
      token(s).balanceOf(user),
      bs[d].freeLiquidity(),
    ]);
    if (p1 || p2) throw Error("兑换已暂停");
    if (balance < amount) throw Error("钱包 W3 余额不足");
    if (free < amount) throw Error("目标链当前库存不足，请减少数量或等待注资");
    const deadline =
      Number((await providers[s].getBlock("latest")).timestamp) + 7 * 86400;
    const [fee, resultFee] = await Promise.all([
      bs[s].quoteSwap(user, amount, deadline),
      bs[d].quoteResultFee(),
    ]);
    review = {
      s,
      d,
      amount,
      user,
      deadline,
      fee: fee.nativeFee,
      sourceBridge: config[s],
      destinationBridge: config[d],
    };
    $("#review").innerHTML =
      `<div class="eyebrow">${esc(CHAINS[s].name)} → ${esc(CHAINS[d].name)}</div><div class="review-amount">${esc(formatUnits(amount, 18))} W3</div><div class="details"><div><span>目标链净领取</span><b>${esc(formatUnits(amount, 18))} W3</b></div><div><span>去程消息费</span><b>${esc(formatEther(fee.nativeFee))} ${CHAINS[s].gas}</b></div><div><span>结果回传预估</span><b>${esc(formatEther(resultFee.nativeFee))} ${CHAINS[d].gas}</b></div><div><span>钱包</span><b>${esc(short(user))}</b></div></div><p class="fine">以上不含授权、发送、回传、领取的链上 gas。X Layer 发出的消息保留 225,000 个确认，按本次观测约需 62.5 小时；两方向都包含一条 X Layer 消息。目标链收到请求时检查库存和 7 天有效期；拒绝后需回传结果才能退款。消息未送达时没有自动超时退款。</p><p class="fine">源合约 ${esc(config[s])}<br>目标合约 ${esc(config[d])}</p><br>`;
    $("#review-dialog").showModal();
  });
};
$("#confirm-swap").onclick = () =>
  run(async () => {
    if (!review) throw Error("报价已失效，请重新预览");
    const r = { ...review };
    $("#review-dialog").close();
    if (
      account !== r.user ||
      config[r.s] !== r.sourceBridge ||
      config[r.d] !== r.destinationBridge
    )
      throw Error("配置已变化，请重新预览");
    const signer = await signerFor(r.s),
      t = token(r.s, signer);
    if ((await t.allowance(r.user, r.sourceBridge)) < r.amount) {
      toast("请在钱包确认本次数量的 W3 授权");
      await (await t.approve(r.sourceBridge, r.amount)).wait();
    }
    await assertWallet(r.s, r.user);
    if (Math.floor(Date.now() / 1000) > r.deadline - 60)
      throw Error("报价已过期，请重新预览");
    const b = bridge(r.s, signer),
      fee = await b.quoteSwap(r.user, r.amount, r.deadline);
    if (fee.nativeFee > r.fee) throw Error("消息费用上涨，请重新预览最新报价");
    toast("请在钱包确认跨链请求");
    const response = await b.swap(r.amount, r.deadline, {
      value: fee.nativeFee,
    });
    const pending = {
      id: null,
      source: r.s,
      user: r.user,
      sourceBridge: r.sourceBridge,
      destinationBridge: r.destinationBridge,
      tx: response.hash,
      amount: formatUnits(r.amount, 18),
      createdAt: Date.now(),
    };
    orders.unshift(pending);
    persistOrders();
    toast(`交易已提交：${short(response.hash)}。等待链上确认。`);
    const receipt = await response.wait();
    await recordReceipt(r.s, receipt, r.sourceBridge, r.destinationBridge);
    review = null;
    tab("orders");
    toast("源链请求已确认。等待目标链处理，再回传结果与领取。");
  });
async function recordReceipt(
  s,
  receipt,
  src = config[s],
  dst = config[OTHER[s]],
) {
  const b = bridge(s, providers[s], src);
  const event = receipt.logs
    .filter((l) => l.address.toLowerCase() === src.toLowerCase())
    .map((l) => {
      try {
        return b.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e) => e?.name === "SwapRequested");
  if (!event) throw Error("交易中未找到此兑换合约的订单事件");
  const item = {
    id: event.args.id,
    source: s,
    user: event.args.user,
    sourceBridge: src,
    destinationBridge: dst,
    tx: receipt.hash,
    guid: event.args.guid,
    amount: formatUnits(event.args.amount, 18),
    createdAt: Date.now(),
  };
  const index = orders.findIndex((o) => o.tx === item.tx);
  if (index >= 0) orders[index] = { ...orders[index], ...item };
  else orders.unshift(item);
  persistOrders();
  return item;
}
const stateText = [
  "等待目标链处理",
  "目标链已保留到账款",
  "库存不足、暂停或过期，已拒绝",
  "已领取目标链代币",
];
async function refreshOrders() {
  if (polling) return;
  polling = true;
  try {
    const list = orders.filter(
      (o) => account && o.user?.toLowerCase() === account.toLowerCase(),
    );
    const container = $("#orders");
    if (!list.length) {
      container.innerHTML =
        '<div class="empty"><b>↔</b>你的钱包还没有订单<br><p>连接钱包后，跨链订单会显示在这里。</p></div>';
      return;
    }
    const fragments = await Promise.all(
      list.map(async (o) => {
        const s = o.source,
          d = OTHER[s];
        if (
          !CHAINS[s] ||
          !isAddress(o.sourceBridge) ||
          !isAddress(o.destinationBridge)
        )
          return "";
        try {
          if (!o.id) {
            const receipt = await providers[s].getTransactionReceipt(o.tx);
            if (receipt?.status === 1)
              Object.assign(
                o,
                await recordReceipt(
                  s,
                  receipt,
                  o.sourceBridge,
                  o.destinationBridge,
                ),
              );
            else
              return `<article class="order-card"><h2>${receipt?.status === 0 ? "源链交易失败，未创建订单" : "源链交易等待确认"}</h2><a class="txlink" href="${CHAINS[s].explorer}/tx/${esc(o.tx)}" target="_blank" rel="noreferrer">查看源链交易 ↗</a></article>`;
          }
          const [out, inc] = await Promise.all([
            bridge(s, providers[s], o.sourceBridge).outbound(o.id),
            bridge(d, providers[d], o.destinationBridge).inbound(o.id),
          ]);
          const outState = Number(out.state),
            inState = Number(inc.state);
          let status = stateText[inState] || "未知状态";
          if (outState === 3) status = "源链退款可领取";
          if (outState === 4) status = "已退还源链本金";
          const actions = [];
          if (inState > 0 && outState === 1)
            actions.push(["relay", "回传处理结果", d]);
          if (inState === 1) actions.push(["claim", "领取 W3", d]);
          if (outState === 3) actions.push(["refund", "领取源链退款", s]);
          return `<article class="order-card"><div class="order-head"><h2>${esc(o.amount)} W3 · ${CHAINS[s].name} → ${CHAINS[d].name}</h2><span class="chip">${esc(status)}</span></div><div class="order-id">订单 ${esc(o.id)}</div><p>${outState === 1 && inState === 0 ? "正在等待 LayerZero 传递请求。网络拥堵时请检查消息浏览器，不要重复兑换。" : outState === 1 ? "目标链处理结果已确定。回传后源链库存才会结算，领取可独立进行。" : "源链已完成结算。"} ${inState === 2 ? "目标链未扣减库存，回传拒绝结果后在源链领取退款。" : ""}</p><a class="txlink" href="${CHAINS[s].explorer}/tx/${esc(o.tx)}" target="_blank" rel="noreferrer">源链交易 ↗</a> · <a class="txlink" href="https://layerzeroscan.com/tx/${esc(o.tx)}" target="_blank" rel="noreferrer">跨链消息 ↗</a><div class="toolbar">${actions.map(([action, label, k]) => `<button class="secondary" data-order="${esc(o.id)}" data-source="${s}" data-action="${action}" ${busy ? "disabled" : ""}>${label} · ${CHAINS[k].gas} gas</button>`).join("")}</div></article>`;
        } catch (e) {
          return `<article class="order-card"><h2>${esc(o.amount || "")} W3</h2><p>暂时无法读取状态：${esc(message(e))}</p><div class="order-id">${esc(o.id || o.tx)}</div></article>`;
        }
      }),
    );
    container.innerHTML = fragments.join("");
    container
      .querySelectorAll("[data-order]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            run(() =>
              orderAction(b.dataset.order, b.dataset.source, b.dataset.action),
            )),
      );
  } finally {
    polling = false;
  }
}
async function orderAction(id, s, action) {
  const o = orders.find((o) => o.id === id && o.source === s);
  if (!o || o.user.toLowerCase() !== account.toLowerCase())
    throw Error("请连接订单发起钱包");
  const k = action === "refund" ? s : OTHER[s],
    signer = await signerFor(k),
    expected = account,
    address = action === "refund" ? o.sourceBridge : o.destinationBridge,
    b = bridge(k, signer, address);
  await checked(k, address);
  if (action === "relay") {
    const fee = await b.quoteResult(id);
    toast(
      `回传消息费：${formatEther(fee.nativeFee)} ${CHAINS[k].gas}，请确认钱包交易`,
    );
    await assertWallet(k, expected);
    const tx = await b.relayResult(id, { value: fee.nativeFee });
    o.resultTx = tx.hash;
    persistOrders();
    await tx.wait();
    toast("结果已发出，等待源链确认");
  } else {
    toast("请在钱包确认领取交易");
    await (
      await (action === "refund"
        ? b.claimRefund(id, expected)
        : b.claim(id, expected))
    ).wait();
    toast("领取交易已确认");
  }
  await refreshOrders();
}
$("#refresh-orders").onclick = () => run(refreshOrders);
$("#export-orders").onclick = () => download("one-bridge-orders.json", orders);
$("#import-order").onclick = () => $("#restore-dialog").showModal();
$("#restore").onclick = () =>
  run(async () => {
    const s = $("#restore-chain").value,
      hash = $("#restore-hash").value.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw Error("请输入有效的交易哈希");
    await checkPeers();
    const receipt = await providers[s].getTransactionReceipt(hash);
    if (!receipt || receipt.status !== 1) throw Error("未找到成功的源链交易");
    await recordReceipt(s, receipt);
    $("#restore-dialog").close();
    await refreshOrders();
    toast("订单已从链上恢复");
  });

function renderSetup() {
  $("#setup-chains").innerHTML = Object.entries(CHAINS)
    .map(
      ([k, c]) =>
        `<article class="setup-card"><div class="card-title"><h2>${c.name}</h2><span class="chip">Chain ${c.id}</span></div><p class="small-state">W3 · 18 位精度 · gas 使用 ${c.gas}</p><a class="address" href="${c.explorer}/address/${c.token}" target="_blank" rel="noreferrer">代币 ${c.token} ↗</a><label>本链兑换合约地址<input id="address-${k}" value="${esc(config[k])}" placeholder="部署后自动填写，或粘贴已验证地址"></label><div class="setup-actions"><button class="secondary" data-setup="save" data-chain="${k}">验证并保存</button><button class="secondary" data-setup="clear" data-chain="${k}">清除本地地址</button><button class="secondary" data-setup="deploy" data-chain="${k}">1. 部署合约</button><button class="secondary" data-setup="pair" data-chain="${k}">2. 绑定另一端</button><button class="secondary" data-setup="security" data-chain="${k}">3. 配置双验证器</button><button class="secondary" data-setup="fund" data-chain="${k}">4. 存入 0.09 W3</button><button class="secondary" data-setup="fund5" data-chain="${k}">存入 5 W3</button><button class="secondary" data-setup="pause" data-chain="${k}">暂停接收新订单</button><button class="secondary" data-setup="withdraw" data-chain="${k}">提取可用库存</button></div><p class="fine">绑定仅允许执行一次。只可提取空闲库存；待结算款项、到账预留和退款不受影响。</p></article>`,
    )
    .join("");
  document
    .querySelectorAll("[data-setup]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          run(() => setupAction(b.dataset.chain, b.dataset.setup))),
    );
}
function acknowledge() {
  if (!$("#risk-ack").checked)
    throw Error("请先阅读风险说明，并在启动与配置区域勾选确认。");
}
async function setupAction(k, action) {
  const c = CHAINS[k];
  if (action === "clear") {
    if (
      !window.confirm(
        "只清除本地合约地址，不会撤销部署、取回资金或删除订单。继续？",
      )
    )
      return;
    config[k] = "";
    persistConfig();
    return;
  }
  if (action === "save") {
    const address = $(`#address-${k}`).value.trim();
    if (!isAddress(address)) throw Error("请输入有效的合约地址");
    await checked(k, address);
    config[k] = getAddress(address);
    persistConfig();
    toast("合约参数已核对并保存；请确认此地址来源可信。");
    return;
  }
  acknowledge();
  operationStage = `${c.name} 钱包网络连接`;
  const signer = await signerFor(k),
    user = account;
  if (action === "deploy") {
    if (config[k])
      throw Error(
        "已有合约地址，避免重复部署。如需重新部署，请先导出配置备份，再点击清除本地地址。",
      );
    const endpoint = new Contract(
      c.endpoint,
      ["function eid() view returns(uint32)"],
      signer,
    );
    if (Number(await endpoint.eid()) !== c.eid) throw Error("Endpoint 不匹配");
    if (Number(await token(k, signer).decimals()) !== 18)
      throw Error("代币精度变化");
    toast(`请确认部署到 ${c.name}，需要 ${c.gas} gas`);
    const b = await new ContractFactory(
      artifact.abi,
      artifact.bytecode,
      signer,
    ).deploy(c.token, c.endpoint, user, CHAINS[OTHER[k]].eid);
    config[k] = await b.getAddress();
    persistConfig();
    toast(`部署交易 ${short(b.deploymentTransaction().hash)} 已提交`);
    await b.waitForDeployment();
    toast(`${c.name} 合约部署完成，当前暂停`);
    return;
  }
  operationStage = `${c.name} 合约与管理员校验`;
  const b = await checked(k, config[k], signer.provider);
  if ((await b.owner()).toLowerCase() !== user.toLowerCase())
    throw Error("此操作需要合约 owner 钱包");
  const write = bridge(k, signer);
  if (action === "pair") {
    await checked(OTHER[k]);
    const peer = await b.peers(CHAINS[OTHER[k]].eid);
    if (peer !== ZeroHash) throw Error("已绑定；绑定后不能修改");
    await (
      await write.setPeer(
        CHAINS[OTHER[k]].eid,
        zeroPadValue(config[OTHER[k]], 32),
      )
    ).wait();
    toast(`${c.name} 已绑定另一端`);
  }
  if (action === "security") {
    await configureSecurity(k, signer);
    return;
  }
  if (action === "fund" || action === "fund5") {
    const quantity = action === "fund5" ? "5" : "0.09";
    const amount = parseUnits(quantity, 18),
      t = token(k, signer);
    operationStage = `${c.name} 读取 W3 余额`;
    if ((await t.balanceOf(user)) < amount) throw Error(`钱包余额不足 ${quantity} W3`);
    operationStage = `${c.name} 读取 W3 授权额度`;
    if ((await t.allowance(user, config[k])) < amount) {
      operationStage = `${c.name} 请求 W3 授权`;
      toast(`请在 OKX 钱包确认授权 ${quantity} W3`);
      const approval = await t.approve(config[k], amount);
      operationStage = `授权已提交 ${approval.hash}，等待确认失败时请先查交易`;
      await approval.wait();
    }
    await assertWallet(k, user);
    operationStage = `${c.name} 请求存入 ${quantity} W3`;
    toast(`授权已就绪，请在 OKX 钱包确认存入 ${quantity} W3`);
    const deposit = await write.fund(amount);
    operationStage = `存入已提交 ${deposit.hash}，请先查交易，勿重复存入`;
    await deposit.wait();
    toast(`${c.name} 已存入 ${quantity} W3`);
  }
  if (action === "pause") {
    await (await write.setPaused(true)).wait();
    toast(`${c.name} 已暂停新订单，已有订单仍可领取和回传`);
  }
  if (action === "withdraw") {
    const free = await b.freeLiquidity();
    if (!free) throw Error("没有可提取库存");
    if (
      !window.confirm(
        `从 ${c.name} 提取全部空闲库存 ${formatUnits(free, 18)} W3 至 ${user}？在途订单可能因库存不足被拒绝。`,
      )
    )
      return;
    await (await write.withdrawFree(free, user)).wait();
    toast("空闲库存已提回钱包");
  }
}
async function configureSecurity(k, signer) {
  const b = await checked(k),
    c = CHAINS[k],
    plan = SECURITY[k],
    eid = CHAINS[OTHER[k]].eid;
  if (
    !(await b.paused()) ||
    (await b.escrowed()) ||
    (await b.reserved()) ||
    (await b.refundable())
  )
    throw Error("仅可在暂停且没有未完成款项时配置安全参数");
  const e = new Contract(c.endpoint, ENDPOINT_ABI, signer),
    app = config[k];
  for (const address of [plan.send, plan.receive, plan.executor, ...plan.dvns])
    if ((await providers[k].getCode(address)) === "0x")
      throw Error("消息基础设施地址没有代码");
  toast(
    "配置 LayerZero Labs + Nethermind 双验证器，两者均须确认。请依次确认钱包交易。",
  );
  if (
    (await e.isDefaultSendLibrary(app, eid)) ||
    (await e.getSendLibrary(app, eid)).toLowerCase() !== plan.send
  )
    await (await e.setSendLibrary(app, eid, plan.send)).wait();
  const [receive, isDefault] = await e.getReceiveLibrary(app, eid);
  if (isDefault || receive.toLowerCase() !== plan.receive)
    await (await e.setReceiveLibrary(app, eid, plan.receive, 0)).wait();
  await (
    await e.setConfig(app, plan.send, [
      { eid, configType: 1, config: executorBytes(k) },
      { eid, configType: 2, config: ulnBytes(k) },
    ])
  ).wait();
  await (
    await e.setConfig(app, plan.receive, [
      { eid, configType: 2, config: ulnBytes(k, true) },
    ])
  ).wait();
  toast(
    `${c.name} 已显式配置双验证器与消息库，确认深度保持 ${plan.confirmations} 块。`,
  );
}
async function routeReport() {
  await checkPeers();
  const report = {
    checkedAt: new Date().toISOString(),
    note: "LayerZero Labs + Nethermind 均须验证。X Layer 出站 225000 确认，约 62.5 小时；配置检查不保证 DVN 实时健康。",
  };
  for (const k of Object.keys(CHAINS)) {
    const c = CHAINS[k],
      plan = SECURITY[k],
      eid = CHAINS[OTHER[k]].eid,
      e = new Contract(c.endpoint, ENDPOINT_ABI, providers[k]);
    const send = await e.getSendLibrary(config[k], eid),
      [receive, isDefault] = await e.getReceiveLibrary(config[k], eid);
    if (
      send.toLowerCase() !== plan.send ||
      receive.toLowerCase() !== plan.receive ||
      isDefault ||
      (await e.isDefaultSendLibrary(config[k], eid))
    )
      throw Error(`${c.name} 尚未显式配置消息库`);
    const configs = {};
    for (const [name, lib] of [
      ["send", send],
      ["receive", receive],
    ]) {
      configs[name] = {
        library: lib,
        ...assertUln(
          k,
          await e.getConfig(config[k], lib, eid, 2),
          name === "receive",
        ),
      };
    }
    const [executor] = AbiCoder.defaultAbiCoder().decode(
      [EXECUTOR],
      await e.getConfig(config[k], send, eid, 1),
    );
    if (
      executor.executorAddress.toLowerCase() !== plan.executor ||
      executor.maxMessageSize !== 10000n
    )
      throw Error(`${c.name} Executor 配置不匹配`);
    const fee = await bridge(k).quoteResultFee();
    report[k] = {
      ...configs,
      executor: executor.executorAddress,
      resultMessageFeeNative: formatEther(fee.nativeFee),
    };
  }
  $("#route-report").textContent = JSON.stringify(report, null, 2);
  return report;
}
$("#check-route").onclick = () =>
  run(async () => {
    await routeReport();
    toast("已读取双向安全配置。开启前请核对显示的 DVN 与消息库。");
  });
$("#enable").onclick = () =>
  run(async () => {
    acknowledge();
    await routeReport();
    for (const k of Object.keys(CHAINS)) {
      const b = bridge(k);
      if (!(await b.paused())) continue;
      if ((await b.freeLiquidity()) < parseUnits("0.09", 18))
        throw Error(`${CHAINS[k].name} 初次开启前需要至少 0.09 W3 空闲库存`);
      const signer = await signerFor(k);
      toast(`请确认开启 ${CHAINS[k].name}`);
      await (await bridge(k, signer).setPaused(false)).wait();
    }
    toast("两端已开启，可以先兑换 0.01 W3");
    tab("swap");
  });
$("#export-config").onclick = () => download("deployments.json", config);
renderSetup();
renderWallets();
await refresh();
setInterval(() => {
  if (!busy) {
    if (currentTab === "orders") refreshOrders();
    else if (currentTab === "swap") refresh();
  }
}, 15000);

// Read-only proof of the operator wallet's small mainnet test, independent of connected account.
async function refreshOperatorTest() {
  const box = document.querySelector('#operator-test');
  if (!box) return;
  try {
    const response = await fetch('/mainnet-test.json', {cache:'no-store'});
    if (!response.ok) return;
    const t = await response.json();
    if (!CHAINS[t.source] || !CHAINS[t.destination] || !/^0x[0-9a-fA-F]{64}$/.test(t.id)) return;
    const [out, incoming] = await Promise.all([bridge(t.source).outbound(t.id), bridge(t.destination).inbound(t.id)]);
    let state = '等待目标链验证与执行';
    if (Number(incoming.state) === 1) state = '目标链已预留 0.01 W3，等待领取';
    if (Number(incoming.state) === 2) state = '目标链拒绝，等待回传或退款';
    if (Number(incoming.state) === 3) state = Number(out.state) === 2 ? '目标链已领取，源链结算完成' : '目标链已领取，源链回执等待确认';
    if (Number(out.state) === 4) state = '源链本金已退还';
    box.innerHTML = `<article class="order-card"><div class="order-head"><h2>部署钱包实测 · ${esc(t.amount)} W3</h2><span class="chip">只读链上记录</span></div><p>${CHAINS[t.source].name} → ${CHAINS[t.destination].name} · ${esc(state)}</p><div class="order-id">订单 ${esc(t.id)}</div><a class="txlink" target="_blank" rel="noreferrer" href="${CHAINS[t.source].explorer}/tx/${esc(t.sourceTx)}">源链交易 ↗</a> · <a class="txlink" target="_blank" rel="noreferrer" href="https://layerzeroscan.com/tx/${esc(t.sourceTx)}">跨链消息 ↗</a></article>`;
  } catch { box.textContent = '实测订单状态暂时无法读取，请稍后刷新。'; }
}
refreshOperatorTest();
setInterval(refreshOperatorTest, 15000);
