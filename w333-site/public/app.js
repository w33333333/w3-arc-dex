const C = window.W3_DEX_CONFIG,
  $ = (id) => document.getElementById(id),
  FEES = [100, 500, 3000];
let provider = new ethers.JsonRpcProvider(C.rpcUrl),
  signer,
  account,
  walletProvider,
  slippage = 0.5,
  currentPrice = 0.001,
  currentTick = 0,
  fullRange = false,
  pendingMint,
  marketPoints = [];
const announced = [],
  poolState = {};
const tokenBase = {
  USDC: { symbol: "USDC", address: C.usdc, decimals: 6 },
  W3: { symbol: "W3", address: C.w3, decimals: 18 },
};
const tokenInfoCache = new Map();
const tokenAbi = [
  "function decimals() view returns(uint8)",
  "function symbol() view returns(string)",
  "function name() view returns(string)",
  "function balanceOf(address) view returns(uint256)",
];
const PRICE_DIGITS = 5;
const fmtPrice = (v) => Number(v || 0).toFixed(PRICE_DIGITS);
const ERC20 = [
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
];
const QUOTER = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)",
];
const ROUTER = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns(uint256)",
];
const POOL = [
  "function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)",
  "function liquidity() view returns(uint128)",
];
const NFPM = [
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns(uint256,uint128,uint256,uint256)",
  "function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) payable returns(uint256,uint256)",
  "function balanceOf(address) view returns(uint256)",
  "function totalSupply() view returns(uint256)",
  "function tokenByIndex(uint256) view returns(uint256)",
  "function tokenOfOwnerByIndex(address,uint256) view returns(uint256)",
  "function ownerOf(uint256) view returns(address)",
  "function safeTransferFrom(address,address,uint256)",
  "function approve(address,uint256)",
  "function safeTransferFrom(address,address,uint256,bytes)",
  "function positions(uint256) view returns(uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)",
];
const STAKER = [
  "function stakeToken((address rewardToken,address pool,uint256 startTime,uint256 endTime,address refundee),uint256 tokenId)",
  "function claimReward(address rewardToken,address to,uint256 amountRequested) returns(uint256)",
  "function rewards(address,address) view returns(uint256)",
  "function deposits(uint256) view returns(address owner,uint48 numberOfStakes,int24 tickLower,int24 tickUpper)",
  "function getRewardInfo((address rewardToken,address pool,uint256 startTime,uint256 endTime,address refundee),uint256 tokenId) view returns(uint256 reward,uint160 secondsInsideX128)",
  "function unstakeToken((address rewardToken,address pool,uint256 startTime,uint256 endTime,address refundee),uint256 tokenId)",
  "function withdrawToken(uint256 tokenId,address to,bytes data)",
  "function multicall(bytes[] data) payable returns(bytes[] results)",
];
const FEE_REWARDS = [
  "function DURATION() view returns(uint256)",
  "function addIncentive(address pool,uint256 amount)",
  "function stake(uint256 tokenId)",
  "function finalize(address pool,uint256 maxPositions)",
  "function claim(uint256 tokenId) returns(uint256)",
  "function withdraw(uint256 tokenId)",
  "function campaignInfo(address pool) view returns(uint64 id,(uint64 start,uint64 end,uint64 finalizeCursor,bool finalized,uint256 reward,uint256 claimed,uint256 totalScore) campaign,uint256 positionCount)",
  "function pendingReward(uint256 tokenId) view returns(uint256)",
  "function deposits(uint256) view returns(address owner,address pool,uint64 campaignId,uint128 fee0Start,uint128 fee1Start,uint256 score,bool active,bool checkpointed,bool claimed)",
];
const SWAP_EVENT = new ethers.Interface([
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
]);
const toast = (m) => {
  const e = $("toast");
  e.textContent = m;
  e.classList.add("show");
  setTimeout(() => e.classList.remove("show"), 3200);
};
const fee = (n) =>
    Number(document.querySelector(`input[name=${n}]:checked`).value),
  feeLabel = (f) => (f === 100 ? "0.01%" : f === 500 ? "0.05%" : "0.3%");
function tokenMode(side) {
  return $(`token${side}`).value;
}
function tokenInput(side) {
  const s = tokenMode(side);
  return s === "custom" ? ($(`token${side}Address`)?.value || "").trim() : s;
}
function setTokenFieldVisibility(side) {
  const mode = tokenMode(side),
    wrap = $(`token${side}AddressWrap`),
    input = $(`token${side}Address`);
  if (!wrap || !input) return;
  if (mode === "custom") {
    wrap.style.display = "block";
    if (!input.value.trim()) input.focus();
  } else wrap.style.display = "none";
}
function clearMarketPair() {
  if ($("marketPair") && tokenMode("Out") && tokenMode("In")) {
    const i =
      tokenMode("In") === "custom"
        ? ($("tokenInAddress")?.dataset.symbol || ($("tokenInAddress")?.value || "自定义代币").slice(0, 6))
        : tokenMode("In");
    const o =
      tokenMode("Out") === "custom"
        ? ($("tokenOutAddress")?.dataset.symbol || ($("tokenOutAddress")?.value || "自定义代币").slice(0, 6))
        : tokenMode("Out");
    if ($("marketPair")) $("marketPair").textContent = `${o} / ${i}`;
  }
}
async function resolveToken(side) {
  const key = tokenInput(side);
  if (!key) throw Error("请先选择代币");
  const base = tokenBase[key];
  if (base) return base;
  const address = ethers.getAddress(key);
  const cached = tokenInfoCache.get(address);
  if (cached) return cached;
  const code = await provider.getCode(address);
  if (code === "0x") throw Error("该地址不是 ARC 链代币合约");
  let info = { symbol: "", name: "", address, decimals: 18 };
  const contract = new ethers.Contract(address, tokenAbi, provider);
  const [decimals, symbol, name] = await Promise.allSettled([
    contract.decimals(),
    contract.symbol(),
    contract.name(),
  ]);
  if (decimals.status !== "fulfilled") throw Error("无法读取代币精度");
  info.decimals = Number(decimals.value);
  info.symbol = symbol.status === "fulfilled" ? String(symbol.value).trim() : "";
  info.name = name.status === "fulfilled" ? String(name.value).trim() : "";
  if (!info.symbol) info.symbol = `TOKEN-${address.slice(2, 6).toUpperCase()}`;
  tokenInfoCache.set(address, info);
  return info;
}
async function identifyCustomToken(side) {
  const input = $(`token${side}Address`),
    detected = $(`token${side}Detected`),
    option = $(`token${side}`).querySelector('option[value="custom"]');
  if (!input.value.trim()) {
    input.dataset.symbol = "";
    detected.textContent = "";
    detected.classList.remove("error");
    option.textContent = "自定义 CA";
    return;
  }
  detected.textContent = "正在识别 ARC 链代币…";
  detected.classList.remove("error");
  try {
    const token = await resolveToken(side);
    input.dataset.symbol = token.symbol;
    option.textContent = token.symbol;
    detected.textContent = `${token.name || token.symbol} · ${token.symbol} · ${token.decimals} 位精度`;
    clearMarketPair();
  } catch (error) {
    input.dataset.symbol = "";
    option.textContent = "自定义 CA";
    detected.textContent = error.message || "无法识别该代币";
    detected.classList.add("error");
  }
}
function tokenAddressByKey(key) {
  return key === "USDC"
    ? tokenBase.USDC.address
    : key === "W3"
      ? tokenBase.W3.address
      : ethers.getAddress(key);
}
function buildERC20Contract(addr, writer = false) {
  return new ethers.Contract(addr, ERC20, writer ? signer : provider);
}
function okx() {
  return (
    announced.find((x) => /okx/i.test(x.info?.name || ""))?.provider ||
    window.okxwallet?.ethereum ||
    window.okxwallet ||
    window.ethereum?.providers?.find((x) => x.isOkxWallet) ||
    (window.ethereum?.isOkxWallet ? window.ethereum : null)
  );
}
function fallback() {
  return (
    announced[0]?.provider || window.ethereum?.providers?.[0] || window.ethereum
  );
}
async function ensureArc(p) {
  const n = await p.request({ method: "eth_chainId" });
  if (Number(n) !== C.chainId) {
    try {
      await p.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: C.chainHex }],
      });
    } catch (e) {
      if (e.code !== 4902 && !String(e.message).includes("Unrecognized"))
        throw e;
      await p.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: C.chainHex,
            chainName: "ARC Testnet",
            nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
            rpcUrls: [C.rpcUrl],
            blockExplorerUrls: [C.explorer],
          },
        ],
      });
    }
  }
}
async function activate(p, label, request = true) {
  if (!p) return toast(`未检测到 ${label}`);
  try {
    if (request) await p.request({ method: "eth_requestAccounts" });
    await ensureArc(p);
    walletProvider = p;
    provider = new ethers.BrowserProvider(p);
    signer = await provider.getSigner();
    account = await signer.getAddress();
    $("connect").textContent = `${account.slice(0, 6)}…${account.slice(-4)}`;
    $("status").textContent = `${label} 已连接`;
    $("swapButton").textContent = "兑换";
    $("addLiquidity").textContent = "创建 V3 仓位";
    $("stakePosition").textContent = "质押仓位";
    [
      $("swapButton"),
      $("addLiquidity"),
      $("watchW3"),
      $("stakePosition"),
      $("claimW3"),
    ].forEach((x) => x && (x.disabled = false));
    $("walletDialog").close();
    p.on?.("accountsChanged", () => location.reload());
    p.on?.("chainChanged", () => location.reload());
    await refresh();
    await refreshRewards();
    toast(`${label} 连接成功`);
  } catch (e) {
    toast(
      e.code === 4001
        ? "已取消连接"
        : e.shortMessage || e.message || "连接失败",
    );
  }
}
async function restore() {
  for (const p of [okx(), fallback()].filter(
    (x, i, a) => x && a.indexOf(x) === i,
  )) {
    try {
      if ((await p.request({ method: "eth_accounts" }))?.length)
        return activate(p, p === okx() ? "OKX" : "钱包", false);
    } catch {}
  }
}
async function refresh() {
  if (!account) return;
  for (const [side, id] of [
    ["In", "balanceIn"],
    ["Out", "balanceOut"],
  ]) {
    try {
      const token = await resolveToken(side),
        contract = buildERC20Contract(token.address),
        balance = await contract.balanceOf(account);
      $(id).textContent =
        `余额 ${Number(ethers.formatUnits(balance, token.decimals)).toLocaleString()} ${token.symbol}`;
    } catch {
      $(id).textContent = "余额 —";
    }
  }
}
async function bestQuote(amount, tokenIn, tokenOut) {
  const q = new ethers.Contract(C.quoterV2, QUOTER, provider),
    results = await Promise.all(
      FEES.map(async (f) => {
        try {
          const r = await q.quoteExactInputSingle.staticCall({
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            amountIn: amount,
            fee: f,
            sqrtPriceLimitX96: 0,
          });
          return { fee: f, out: r[0] };
        } catch {
          return { fee: f, out: 0n };
        }
      }),
    );
  return results.reduce((a, b) => (b.out > a.out ? b : a), {
    fee: 500,
    out: 0n,
  });
}
async function quote() {
  const raw = $("amountIn").value;
  if (!raw) {
    $("amountOut").textContent = "0.00000";
    return;
  }
  try {
    const [tokenIn, tokenOut] = await Promise.all([
      resolveToken("In"),
      resolveToken("Out"),
    ]);
    if (tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase())
      throw Error("请选择不同代币");
    const q = await bestQuote(
      ethers.parseUnits(raw, tokenIn.decimals),
      tokenIn,
      tokenOut,
    );
    if (!q.out) throw Error("暂无流动性");
    $("amountOut").textContent = Number(
      ethers.formatUnits(q.out, tokenOut.decimals),
    ).toFixed(PRICE_DIGITS);
    $("routeStatus").textContent =
      `已聚合最优 V3 池 · ${tokenIn.symbol}/${tokenOut.symbol}`;
  } catch (e) {
    $("amountOut").textContent = "—";
    $("routeStatus").textContent = e.message?.includes("代币")
      ? e.message
      : "暂无可用 V3 报价";
  }
}
function priceAtTick(t) {
  return 1e12 / Math.pow(1.0001, t);
}
function applyRange(percent = 20) {
  fullRange = percent === "full";
  document
    .querySelectorAll("[data-range]")
    .forEach((x) =>
      x.classList.toggle("active", x.dataset.range === String(percent)),
    );
  if (fullRange) {
    $("minPrice").value = "0";
    $("maxPrice").value = "∞";
  } else {
    $("minPrice").value = fmtPrice(currentPrice * (1 - percent / 100));
    $("maxPrice").value = fmtPrice(currentPrice * (1 + percent / 100));
  }
  updateRangeVisual();
}
function updateRangeVisual() {
  const min = Number($("minPrice").value),
    max = Number($("maxPrice").value),
    inside =
      fullRange ||
      (min > 0 && max > min && currentPrice >= min && currentPrice <= max);
  $("rangeFill").style.left = fullRange ? "0%" : "12%";
  $("rangeFill").style.width = fullRange ? "100%" : "76%";
  $("priceMarker").style.left = inside
    ? "50%"
    : currentPrice < min
      ? "5%"
      : "95%";
}
async function loadPool() {
  try {
    const f = fee("liqFee"),
      p = new ethers.Contract(C.pools[f], POOL, provider),
      [s, l] = await Promise.all([p.slot0(), p.liquidity()]);
    currentTick = Number(s[1]);
    currentPrice = priceAtTick(currentTick);
    $("poolLabel").textContent = `${feeLabel(f)} V3 池`;
    $("poolPrice").textContent = `1 W3 = ${fmtPrice(currentPrice)} USDC`;
    $("currentTick").textContent = currentTick.toLocaleString();
    $("poolLiquidity").textContent = l.toString();
    applyRange(
      document.querySelector("[data-range].active")?.dataset.range || 20,
    );
    const value = Number($("liqUsdc").value);
    if (value > 0) $("liqW3").value = (value / currentPrice).toFixed(6);
  } catch {
    $("poolPrice").textContent = "池状态读取失败";
  }
}
let poolDirectoryRetryTimer;
function fallbackPoolRows() {
  return FEES.map(
    (f) =>
      '<div class="pool-row"><div class="pool-name"><span class="token-stack"><i>$</i><i>W3</i></span><span><b>USDC / W3</b><small>' +
      feeLabel(f) +
      ' fee · V3</small></span><button class="detail-link" data-detail-fee="' +
      f +
      '">详情</button></div><div class="metric"><small>TVL</small><b>—</b></div><div class="metric"><small>24H 交易量</small><b>—</b></div><div class="metric"><small>24H 手续费</small><b class="green">—</b></div><div class="metric"><small>剩余 W3 激励</small><b class="green">—</b></div><div class="metric"><small>APR</small><b class="purple">—</b></div><button class="deposit-btn" data-pool-fee="' +
      f +
      '">添加</button></div>',
  ).join("");
}
async function loadPoolDirectory() {
  const rows = $("poolRows"),
    usdc = new ethers.Contract(C.usdc, ERC20, provider),
    w3 = new ethers.Contract(C.w3, ERC20, provider),
    rewards = new ethers.Contract(C.feeRewards, FEE_REWARDS, provider);
  try {
    const data = await Promise.all(
      FEES.map(async (f) => {
        const pool = C.pools[f],
          p = new ethers.Contract(pool, POOL, provider),
          [slot, liq, u, w, rewardInfo] = await Promise.all([
            p.slot0(),
            p.liquidity(),
            usdc.balanceOf(pool),
            w3.balanceOf(pool),
            rewards.campaignInfo(pool).catch(() => null),
          ]),
          price = priceAtTick(Number(slot[1])),
          tvl =
            Number(ethers.formatUnits(u, 6)) +
            Number(ethers.formatEther(w)) * price,
          campaign = rewardInfo?.[1],
          remaining = campaign
            ? Number(ethers.formatEther(campaign.reward - campaign.claimed))
            : 0,
          duration = campaign
            ? Math.max(0, (Number(campaign.end) - Date.now() / 1000) / 86400)
            : 0,
          daily = duration > 0 ? remaining / duration : 0,
          apr = tvl && daily ? ((daily * price * 365) / tvl) * 100 : 0;
        poolState[f] = {
          tick: Number(slot[1]),
          price,
          liquidity: liq,
          tvl,
          daily,
          remaining,
          apr,
          usdcBalance: Number(ethers.formatUnits(u, 6)),
          w3Balance: Number(ethers.formatEther(w)),
          pool,
        };
        const cutoff = Date.now() / 1000 - 86400,
          recentTrades = marketPoints.filter(
            (trade) => trade.fee === f && trade.timestamp >= cutoff,
          ),
          volume24h = recentTrades.reduce((sum, trade) => sum + trade.usdc, 0),
          fees24h = volume24h * f / 1_000_000;
        poolState[f].volume24h = volume24h;
        poolState[f].fees24h = fees24h;
        return { f, tvl, daily, remaining, apr, campaign, volume24h, fees24h };
      }),
    );
    rows.innerHTML = data
      .map(
        (x) =>
          '<div class="pool-row"><div class="pool-name"><span class="token-stack"><i>$</i><i>W3</i></span><span><b>USDC / W3</b><small>' +
          feeLabel(x.f) +
          ' fee · V3</small></span><button class="detail-link" data-detail-fee="' +
          x.f +
          '">详情</button></div><div class="metric"><small>TVL</small><b>$' +
          x.tvl.toLocaleString(undefined, { maximumFractionDigits: 2 }) +
          '</b></div><div class="metric"><small>24H 交易量</small><b>$' +
          x.volume24h.toLocaleString(undefined, { maximumFractionDigits: 5 }) +
          '</b></div><div class="metric"><small>24H 手续费</small><b class="green">$' +
          x.fees24h.toLocaleString(undefined, { maximumFractionDigits: 5 }) +
          '</b></div><div class="metric"><small>剩余 W3 激励</small><b class="green">' +
          (x.campaign
            ? x.remaining.toLocaleString(undefined, { maximumFractionDigits: 5 }) +
              " W3"
            : "—") +
          '</b></div><div class="metric"><small>APR</small><b class="purple">' +
          (x.apr ? x.apr.toFixed(2) + "%" : "—") +
          '</b></div><button class="deposit-btn" data-pool-fee="' +
          x.f +
          '">添加</button></div>',
      )
      .join("");
    rows.querySelectorAll("[data-pool-fee]").forEach(
      (b) =>
        (b.onclick = async () => {
          const radio = document.querySelector(
            'input[name=liqFee][value="' + b.dataset.poolFee + '"]',
          );
          radio.checked = true;
          await loadPool();
          $("liquidityEditor").scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }),
    );
    rows
      .querySelectorAll("[data-detail-fee]")
      .forEach(
        (b) => (b.onclick = () => showPoolDetail(Number(b.dataset.detailFee))),
      );
    renderIncentives();
    clearTimeout(poolDirectoryRetryTimer);
  } catch {
    // Keep the last successful snapshot on screen. On first-load RPC failure,
    // render the three known pools immediately and retry quietly in background.
    if (!rows.querySelector(".pool-row")) rows.innerHTML = fallbackPoolRows();
    rows.querySelectorAll("[data-detail-fee]").forEach(
      (button) =>
        (button.onclick = () => {
          const f = Number(button.dataset.detailFee);
          if (poolState[f]) showPoolDetail(f);
          else toast("池数据正在后台同步");
        }),
    );
    clearTimeout(poolDirectoryRetryTimer);
    poolDirectoryRetryTimer = setTimeout(loadPoolDirectory, 3000);
  }
}
let addIncentiveFee = 500;
async function renderIncentives() {
  const rows = $("incentiveRows");
  if (!rows) return;
  const rewards = new ethers.Contract(C.feeRewards, FEE_REWARDS, provider);
  const campaigns = await Promise.all(
    FEES.map(async (f) => {
      try {
        return await rewards.campaignInfo(C.pools[f]);
      } catch {
        return null;
      }
    }),
  );
  rows.innerHTML = FEES.map((f, index) => {
    const s = poolState[f],
      info = campaigns[index],
      campaign = info?.[1],
      remaining = campaign
        ? Number(ethers.formatEther(campaign.reward - campaign.claimed))
        : 0,
      days = campaign
        ? Math.max(0, (Number(campaign.end) - Date.now() / 1000) / 86400)
        : 0,
      indexedFees = (typeof marketPoints === "undefined" ? [] : marketPoints)
        .filter((trade) => trade.fee === f)
        .reduce((sum, trade) => sum + trade.usdc * f / 1_000_000, 0);
    return (
      '<div class="incentive-row"><div class="pool-name"><span class="token-stack"><i>$</i><i>W3</i></span><span><b>USDC / W3</b><small>' +
      feeLabel(f) +
      ' fee · V3</small></span></div><div class="metric"><small>LP TVL</small><b>$' +
      (s ? s.tvl.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—") +
      '</b></div><div class="metric"><small>已索引手续费</small><b>$' +
      indexedFees.toFixed(5) +
      '</b></div><div class="metric"><small>剩余激励</small><b class="green">' +
      remaining.toLocaleString(undefined, { maximumFractionDigits: 5 }) +
      ' W3</b><small>' +
      (days > 0 ? days.toFixed(2) + " 天" : "未开始或已结束") +
      '</small></div><button data-add-incentive="' +
      f +
      '">添加激励</button></div>'
    );
  }).join("");
  rows.querySelectorAll("[data-add-incentive]").forEach((button) => {
    button.onclick = () => {
      if (!account) return toast("请先连接钱包");
      addIncentiveFee = Number(button.dataset.addIncentive);
      $("addIncentivePool").textContent = `USDC / W3 · ${feeLabel(addIncentiveFee)} 池`;
      $("addIncentiveAmount").value = "";
      $("addIncentiveStatus").textContent = "";
      $("addIncentiveDialog").showModal();
    };
  });
}
async function showPoolDetail(f) {
  const s = poolState[f];
  if (!s) return toast("池数据仍在加载");
  document
    .querySelectorAll(".liq-subpage")
    .forEach((x) => x.classList.remove("active"));
  $("poolDetail").classList.add("active");
  document.querySelector(".liq-tabs").style.display = "none";
  document.querySelector("#liquidity>.section-title").style.display = "none";
  $("detailFee").textContent = feeLabel(f) + " 手续费 · V3";
  $("detailUsdcAddress").textContent = C.usdc;
  $("detailW3Address").textContent = C.w3;
  $("detailPoolAddress").textContent = C.pools[f];
  const tvl =
    "$" + s.tvl.toLocaleString(undefined, { maximumFractionDigits: 2 });
  $("detailTvl").textContent = tvl;
  $("detailSideTvl").textContent = tvl;
  $("chartValue").textContent = tvl;
  $("detailUsdcBalance").textContent =
    s.usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 6 }) +
    " USDC";
  $("detailW3Balance").textContent =
    s.w3Balance.toLocaleString(undefined, { maximumFractionDigits: 4 }) + " W3";
  $("detailPrice").textContent = "1 W3 = " + fmtPrice(s.price) + " USDC";
  $("detailFeeStat").textContent = feeLabel(f);
  $("detailLiquidity").textContent = s.liquidity.toString();
  $("detailEmission").textContent =
    s.remaining.toLocaleString(undefined, { maximumFractionDigits: 5 }) + " W3";
  $("detailVolume24h").textContent =
    "$" + s.volume24h.toLocaleString(undefined, { maximumFractionDigits: 5 });
  $("detailFees24h").textContent =
    "$" + s.fees24h.toLocaleString(undefined, { maximumFractionDigits: 5 });
  $("detailCreate").dataset.fee = f;
  await loadHolders(f);
}
async function loadHolders(f) {
  const list = $("holdersList");
  list.innerHTML = '<div class="holders-loading">正在读取持有人…</div>';
  try {
    const m = new ethers.Contract(C.positionManager, NFPM, provider),
      staker = new ethers.Contract(C.staker, STAKER, provider),
      total = Number(await m.totalSupply()),
      owners = new Map();
    for (let i = 0; i < total; i++) {
      const id = await m.tokenByIndex(i),
        p = await m.positions(id);
      if (
        Number(p[4]) !== f ||
        ![p[2].toLowerCase(), p[3].toLowerCase()].includes(
          C.usdc.toLowerCase(),
        ) ||
        ![p[2].toLowerCase(), p[3].toLowerCase()].includes(C.w3.toLowerCase())
      )
        continue;
      let owner = await m.ownerOf(id);
      if (owner.toLowerCase() === C.staker.toLowerCase()) {
        try {
          const d = await staker.deposits(id);
          if (d.owner !== ethers.ZeroAddress) owner = d.owner;
        } catch {}
      }
      const key = owner.toLowerCase(),
        entry = owners.get(key) || { owner, count: 0, liquidity: 0n, ids: [] };
      entry.count++;
      entry.liquidity += p[7];
      entry.ids.push(id.toString());
      owners.set(key, entry);
    }
    const all = [...owners.values()],
      sum = all.reduce((n, x) => n + x.liquidity, 0n);
    $("holderCount").textContent = all.length + " 位持有人";
    list.innerHTML =
      all
        .sort((a, b) => (a.liquidity > b.liquidity ? -1 : 1))
        .map((x) => {
          const share = sum ? Number((x.liquidity * 10000n) / sum) / 100 : 0;
          return (
            '<div class="holder-row"><a class="holder-address" href="' +
            C.explorer +
            "/address/" +
            x.owner +
            '" target="_blank" rel="noreferrer">' +
            x.owner +
            "</a><strong>" +
            x.count +
            "</strong><strong>" +
            x.liquidity +
            '</strong><div class="holder-share"><strong>' +
            share.toFixed(2) +
            '%</strong><i style="--share:' +
            Math.min(100, share) +
            '%"></i></div><div class="holder-nfts">' +
            x.ids
              .map(
                (id) =>
                  '<a href="' +
                  C.explorer +
                  "/token/" +
                  C.positionManager +
                  "?a=" +
                  id +
                  '" target="_blank" rel="noreferrer">#' +
                  id +
                  "</a>",
              )
              .join("") +
            "</div></div>"
          );
        })
        .join("") || '<div class="holders-loading">当前池暂无持有人</div>';
  } catch {
    $("holderCount").textContent = "—";
    list.innerHTML =
      '<div class="holders-loading">持有人读取失败，请稍后重试。</div>';
  }
}
function positionAmounts(liquidity, tickLower, tickUpper, tick) {
  const L = Number(liquidity),
    s = Math.sqrt(Math.pow(1.0001, tick)),
    sl = Math.sqrt(Math.pow(1.0001, tickLower)),
    su = Math.sqrt(Math.pow(1.0001, tickUpper));
  let a0 = 0,
    a1 = 0;
  if (tick <= tickLower) a0 = (L * (su - sl)) / (sl * su);
  else if (tick < tickUpper) {
    a0 = (L * (su - s)) / (s * su);
    a1 = L * (s - sl);
  } else a1 = L * (su - sl);
  return { usdc: a0 / 1e6, w3: a1 / 1e18 };
}
async function loadPositions() {
  const list = $("positionsList");
  if (!account) {
    list.innerHTML =
      '<div class="empty-position"><b>连接钱包后查看</b><span>这里会显示已添加的 V3 LP 仓位。</span></div>';
    return;
  }
  try {
    const m = new ethers.Contract(C.positionManager, NFPM, provider),
      count = Number(await m.balanceOf(account)),
      rows = [];
    for (let i = 0; i < count; i++) {
      const id = await m.tokenOfOwnerByIndex(account, i),
        p = await m.positions(id);
      if (
        ![p[2].toLowerCase(), p[3].toLowerCase()].includes(
          C.usdc.toLowerCase(),
        ) ||
        ![p[2].toLowerCase(), p[3].toLowerCase()].includes(C.w3.toLowerCase())
      )
        continue;
      const f = Number(p[4]),
        state = poolState[f] || { tick: currentTick, price: currentPrice },
        lower = Number(p[5]),
        upper = Number(p[6]),
        low = priceAtTick(upper),
        high = priceAtTick(lower),
        active = state.tick >= lower && state.tick < upper,
        amounts = positionAmounts(p[7], lower, upper, state.tick),
        value = amounts.usdc + amounts.w3 * state.price,
        unclaimed =
          Number(ethers.formatUnits(p[10], 6)) +
          Number(ethers.formatEther(p[11])) * state.price;
      rows.push(
        '<article class="position-item"><div class="position-cell"><div class="pool-name"><span class="token-stack"><i>$</i><i>W3</i></span><span><b>USDC / W3</b><small>' +
          feeLabel(f) +
          " fee · NFT #" +
          id +
          '</small></span></div></div><div class="position-cell"><span>仓位价值</span><strong>$' +
          value.toLocaleString(undefined, { maximumFractionDigits: 2 }) +
          "</strong><small>" +
          amounts.usdc.toFixed(4) +
          " USDC + " +
          amounts.w3.toFixed(3) +
          ' W3</small></div><div class="position-cell"><span class="range-status ' +
          (active ? "" : "out") +
          '"><i></i>' +
          (active ? "区间内" : "区间外") +
          '</span><div class="mini-range"></div><strong>' +
          fmtPrice(low) +
          " – " +
          fmtPrice(high) +
          '</strong></div><div class="position-cell"><span>APR</span><strong>—</strong><small>激励待启动</small></div><div class="position-cell"><span>未领取费用</span><strong>$' +
          unclaimed.toFixed(4) +
          '</strong></div><div class="position-actions"><button class="claim-btn" data-claim="' +
          id +
          '">领取</button><a href="' +
          C.explorer +
          "/token/" +
          C.positionManager +
          "?a=" +
          id +
          '" target="_blank" rel="noreferrer">管理</a></div></article>',
      );
    }
    list.innerHTML =
      rows.join("") ||
      '<div class="empty-position"><b>暂无 V3 仓位</b><span>前往“添加流动性”创建第一个 LP NFT。</span></div>';
    list
      .querySelectorAll("[data-claim]")
      .forEach((b) => (b.onclick = () => claimFees(b, b.dataset.claim)));
  } catch (e) {
    list.innerHTML =
      '<div class="empty-position"><b>仓位读取失败</b><span>请确认钱包网络为 ARC Testnet 后重试。</span></div>';
  }
}
async function claimFees(button, tokenId) {
  if (!account) return toast("请先连接钱包");
  const m = new ethers.Contract(C.positionManager, NFPM, signer);
  await txButton(button, () =>
    m.collect({
      tokenId,
      recipient: account,
      amount0Max: (1n << 128n) - 1n,
      amount1Max: (1n << 128n) - 1n,
    }),
  );
  await loadPositions();
}
function incentiveKey(f) {
  const c = C.incentives?.[f];
  if (!c) throw Error("该池暂无激励");
  return {
    rewardToken: c.rewardToken,
    pool: c.pool,
    startTime: c.startTime,
    endTime: c.endTime,
    refundee: c.refundee,
  };
}
async function refreshRewards() {
  if (!account || !C.feeRewards) return;
  const tokenId = $("stakeTokenId")?.value.trim();
  if (!tokenId || !/^\d+$/.test(tokenId)) {
    $("myRewards").textContent = "输入 NFT 查看";
    return;
  }
  try {
    const s = new ethers.Contract(C.feeRewards, FEE_REWARDS, provider),
      reward = await s.pendingReward(tokenId);
    $("myRewards").textContent =
      Number(ethers.formatEther(reward)).toLocaleString(undefined, {
        maximumFractionDigits: 5,
      }) + " W3";
  } catch {
    $("myRewards").textContent = "—";
  }
}
function ticksForRange() {
  const f = fee("liqFee"),
    spacing = Number(C.tickSpacings[f]);
  if (fullRange)
    return {
      tickLower: Math.ceil(-887272 / spacing) * spacing,
      tickUpper: Math.floor(887272 / spacing) * spacing,
    };
  const min = Number($("minPrice").value),
    max = Number($("maxPrice").value);
  if (!(min > 0 && max > min)) throw Error("请输入有效价格区间");
  let lo =
      Math.floor(Math.log(1e12 / max) / Math.log(1.0001) / spacing) * spacing,
    hi = Math.ceil(Math.log(1e12 / min) / Math.log(1.0001) / spacing) * spacing;
  lo = Math.max(Math.ceil(-887272 / spacing) * spacing, lo);
  hi = Math.min(Math.floor(887272 / spacing) * spacing, hi);
  if (lo >= hi) throw Error("价格区间过窄");
  return { tickLower: lo, tickUpper: hi };
}
async function txButton(b, work) {
  const old = b.textContent;
  b.disabled = true;
  b.textContent = "等待钱包确认…";
  try {
    const tx = await work();
    b.textContent = "链上确认中…";
    await tx.wait();
    toast("交易已确认");
    await refresh();
    await loadPool();
  } catch (e) {
    toast(e.shortMessage || e.message || "交易失败");
  } finally {
    b.disabled = false;
    b.textContent = old;
  }
}
document.querySelectorAll(".nav").forEach(
  (n) =>
    (n.onclick = () => {
      document
        .querySelectorAll(".nav,.view")
        .forEach((x) => x.classList.remove("active"));
      n.classList.add("active");
      $(n.dataset.panel).classList.add("active");
      if (n.dataset.panel === "liquidity") {
        if ($("poolDetail").classList.contains("active"))
          $("detailBack").click();
        const page = n.dataset.liqNav || "add";
        document
          .querySelectorAll("[data-liq-page],.liq-subpage")
          .forEach((x) => x.classList.remove("active"));
        document
          .querySelector('[data-liq-page="' + page + '"]')
          ?.classList.add("active");
        $(page === "add" ? "liqAdd" : "liqManage").classList.add("active");
        if (page === "manage") loadPositions();
        else loadPool();
      }
    }),
);
document.querySelectorAll("[data-liq-page]").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll("[data-liq-page],.liq-subpage")
        .forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      $(b.dataset.liqPage === "add" ? "liqAdd" : "liqManage").classList.add(
        "active",
      );
      if (b.dataset.liqPage === "manage") loadPositions();
    }),
);
$("refreshPositions").onclick = loadPositions;
$("detailBack").onclick = () => {
  $("poolDetail").classList.remove("active");
  document.querySelector(".liq-tabs").style.display = "flex";
  document.querySelector("#liquidity>.section-title").style.display = "block";
  document
    .querySelectorAll("[data-liq-page],.liq-subpage")
    .forEach((x) => x.classList.remove("active"));
  document.querySelector('[data-liq-page="add"]').classList.add("active");
  $("liqAdd").classList.add("active");
};
$("detailTrade").onclick = () =>
  document.querySelector('[data-panel="swap"]').click();
$("detailCreate").onclick = async () => {
  const f = $("detailCreate").dataset.fee;
  $("detailBack").click();
  const radio = document.querySelector('input[name=liqFee][value="' + f + '"]');
  radio.checked = true;
  await loadPool();
  $("liquidityEditor").scrollIntoView({ behavior: "smooth", block: "start" });
};
window.addEventListener("eip6963:announceProvider", (e) => {
  if (!announced.some((x) => x.info?.uuid === e.detail.info?.uuid))
    announced.push(e.detail);
});
window.dispatchEvent(new Event("eip6963:requestProvider"));
$("connect").onclick = () => $("walletDialog").showModal();
$("connectOkx").onclick = () => activate(okx(), "OKX Wallet");
$("connectInjected").onclick = () => activate(fallback(), "浏览器钱包");
$("amountIn").oninput = quote;
$("tokenIn").onchange = () => {
  if ($("tokenIn").value !== "custom")
    $("tokenOut").value = $("tokenIn").value === "USDC" ? "W3" : "USDC";
  setTokenFieldVisibility("In");
  setTokenFieldVisibility("Out");
  if ($("tokenIn").value === "custom") identifyCustomToken("In");
  clearMarketPair();
  refresh();
  quote();
};
$("tokenOut").onchange = () => {
  setTokenFieldVisibility("Out");
  if ($("tokenOut").value === "custom") identifyCustomToken("Out");
  clearMarketPair();
  refresh();
  quote();
};
for (const id of ["tokenInAddress", "tokenOutAddress"]) {
  let timer;
  $(id).oninput = () => {
    clearTimeout(timer);
    clearMarketPair();
    timer = setTimeout(async () => {
      await identifyCustomToken(id.includes("In") ? "In" : "Out");
      refresh();
      quote();
    }, 350);
  };
}
$("flip").onclick = () => {
  const a = $("tokenIn").value,
    ca = $("tokenInAddress").value;
  $("tokenIn").value = $("tokenOut").value;
  $("tokenOut").value = a;
  $("tokenInAddress").value = $("tokenOutAddress").value;
  $("tokenOutAddress").value = ca;
  setTokenFieldVisibility("In");
  setTokenFieldVisibility("Out");
  if ($("tokenIn").value === "custom") identifyCustomToken("In");
  if ($("tokenOut").value === "custom") identifyCustomToken("Out");
  clearMarketPair();
  refresh();
  quote();
};
document.querySelectorAll("[data-slip]").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll("[data-slip]")
        .forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      $("customSlippage").value = "";
      slippage = Number(b.dataset.slip);
      updateProtection();
    }),
);
$("customSlippage").oninput = (e) => {
  const v = Number(e.target.value);
  if (v > 0 && v <= 5) {
    document
      .querySelectorAll("[data-slip]")
      .forEach((x) => x.classList.remove("active"));
    slippage = v;
    updateProtection();
  }
};
function updateProtection() {
  const on = $("mevToggle").checked,
    effective = on ? Math.min(slippage, 0.3) : slippage;
  $("slippageLabel").textContent = `${effective.toFixed(2)}%`;
  if ($("sideSlip")) $("sideSlip").textContent = `${effective.toFixed(2)}%`;
  if ($("sideMev")) $("sideMev").textContent = on ? "开启" : "关闭";
  $("mevNotice").classList.toggle("show", on);
}
$("mevToggle").onchange = updateProtection;
$("swapButton").onclick = async () => {
  if (!account || !$("amountIn").value) return toast("请输入兑换数量");
  try {
    const [tokenIn, tokenOut] = await Promise.all([
      resolveToken("In"),
      resolveToken("Out"),
    ]);
    if (tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase())
      throw Error("请选择不同代币");
    const amount = ethers.parseUnits($("amountIn").value, tokenIn.decimals),
      router = new ethers.Contract(C.swapRouter, ROUTER, signer),
      token = buildERC20Contract(tokenIn.address, true);
    await txButton($("swapButton"), async () => {
      const fresh = await bestQuote(amount, tokenIn, tokenOut);
      if (!fresh.out) throw Error("暂无流动性");
      const effective = $("mevToggle").checked
          ? Math.min(slippage, 0.3)
          : slippage,
        minOut =
          (fresh.out * (10000n - BigInt(Math.round(effective * 100)))) / 10000n;
      if ((await token.allowance(account, C.swapRouter)) < amount) {
        const approval = await token.approve(C.swapRouter, ethers.MaxUint256);
        await approval.wait();
      }
      return router.exactInputSingle({
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        fee: fresh.fee,
        recipient: account,
        deadline:
          Math.floor(Date.now() / 1000) + ($("mevToggle").checked ? 120 : 1200),
        amountIn: amount,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0,
      });
    });
    await refreshRewards();
    if (account) await loadPositions();
  } catch (e) {
    toast(e.shortMessage || e.message || "兑换失败");
  }
};
document
  .querySelectorAll('input[name="liqFee"]')
  .forEach((x) => (x.onchange = loadPool));
document
  .querySelectorAll("[data-range]")
  .forEach(
    (x) =>
      (x.onclick = () =>
        applyRange(
          x.dataset.range === "full" ? "full" : Number(x.dataset.range),
        )),
  );
[$("minPrice"), $("maxPrice")].forEach(
  (x) =>
    (x.oninput = () => {
      fullRange = false;
      document
        .querySelectorAll("[data-range]")
        .forEach((b) => b.classList.remove("active"));
      updateRangeVisual();
    }),
);
$("liqUsdc").oninput = () => {
  const value = Number($("liqUsdc").value);
  $("liqW3").value =
    value > 0 && currentPrice > 0 ? (value / currentPrice).toFixed(6) : "";
};
$("addLiquidity").onclick = () => {
  if (!account) return toast("请先连接钱包");
  try {
    const a = ethers.parseUnits($("liqUsdc").value || "0", 6),
      b = ethers.parseEther($("liqW3").value || "0"),
      ticks = ticksForRange();
    if (!a || !b) return toast("请输入 USDC 数量");
    pendingMint = { a, b, ticks, fee: fee("liqFee") };
    $("confirmFee").textContent = feeLabel(pendingMint.fee);
    $("confirmPrice").textContent = `1 W3 = ${fmtPrice(currentPrice)} USDC`;
    $("confirmRange").textContent = fullRange
      ? "全区间"
      : `${$("minPrice").value} – ${$("maxPrice").value} USDC/W3`;
    $("confirmUsdc").textContent = `${$("liqUsdc").value} USDC`;
    $("confirmW3").textContent = `${$("liqW3").value} W3`;
    $("confirmLiquidity").showModal();
  } catch (e) {
    toast(e.message || "输入无效");
  }
};
$("confirmAdd").onclick = async () => {
  if (!pendingMint) return;
  $("confirmLiquidity").close();
  const { a, b, ticks, fee: f } = pendingMint,
    m = new ethers.Contract(C.positionManager, NFPM, signer);
  await txButton($("addLiquidity"), async () => {
    for (const [token, amt] of [
      [C.usdc, a],
      [C.w3, b],
    ]) {
      const t = new ethers.Contract(token, ERC20, signer);
      if ((await t.allowance(account, C.positionManager)) < amt) {
        const q = await t.approve(C.positionManager, ethers.MaxUint256);
        await q.wait();
      }
    }
    return m.mint({
      token0: C.usdc,
      token1: C.w3,
      fee: f,
      ...ticks,
      amount0Desired: a,
      amount1Desired: b,
      amount0Min: 0,
      amount1Min: 0,
      recipient: account,
      deadline: Math.floor(Date.now() / 1000) + 1200,
    });
  });
  await loadPositions();
  pendingMint = null;
};
$("stakePosition").onclick = async () => {
  if (!account) return toast("请先连接钱包");
  const id = $("stakeTokenId").value.trim(),
    f = Number($("stakeFee").value),
    button = $("stakePosition");
  if (!/^\d+$/.test(id)) return toast("请输入正确的 NFT Token ID");
  try {
    const m = new ethers.Contract(C.positionManager, NFPM, signer),
      position = await m.positions(id),
      rewards = new ethers.Contract(C.feeRewards, FEE_REWARDS, signer);
    if (Number(position[4]) !== f) throw Error("仓位费率与所选池不一致");
    button.disabled = true;
    const owner = await m.ownerOf(id);
    if (owner.toLowerCase() === account.toLowerCase()) {
      button.textContent = "授权仓位…";
      const approval = await m.approve(C.feeRewards, id);
      await approval.wait();
      button.textContent = "质押并记录手续费起点…";
      const tx = await rewards.stake(id);
      await tx.wait();
    } else throw Error("当前钱包不持有该仓位");
    toast("仓位已加入 7 天手续费激励");
    await refreshRewards();
    await loadPositions();
  } catch (e) {
    toast(e.shortMessage || e.message || "质押失败");
  } finally {
    button.disabled = false;
    button.textContent = "质押仓位";
  }
};
$("claimW3").onclick = () =>
  txButton($("claimW3"), () =>
    new ethers.Contract(C.feeRewards, FEE_REWARDS, signer).claim(
      $("stakeTokenId").value.trim(),
    ),
  );
$("confirmAddIncentive").onclick = async () => {
  if (!account) return toast("请先连接钱包");
  const amountText = $("addIncentiveAmount").value.trim();
  if (!amountText || Number(amountText) <= 0) return toast("请输入 W3 激励数量");
  const button = $("confirmAddIncentive"),
    status = $("addIncentiveStatus"),
    old = button.textContent;
  button.disabled = true;
  try {
    const amount = ethers.parseEther(amountText),
      readToken = new ethers.Contract(C.w3, ERC20, provider),
      balance = await readToken.balanceOf(account);
    if (balance < amount)
      throw Error(`W3 余额不足，当前可用 ${Number(ethers.formatEther(balance)).toLocaleString(undefined, { maximumFractionDigits: 5 })} W3`);
    const token = readToken.connect(signer),
      rewards = new ethers.Contract(C.feeRewards, FEE_REWARDS, signer);
    if ((await readToken.allowance(account, C.feeRewards)) < amount) {
      button.textContent = "请在 OKX 钱包确认授权";
      status.textContent = "第 1/2 步：授权本次 W3 数量。若未弹出，请打开 OKX 钱包查看待处理请求。";
      const approval = await token.approve(C.feeRewards, amount);
      status.textContent = "授权交易确认中…";
      await approval.wait();
    }
    button.textContent = "请在 OKX 钱包确认添加";
    status.textContent = "最后一步：确认把 W3 添加到该池的 7 天激励。";
    const tx = await rewards.addIncentive(C.pools[addIncentiveFee], amount);
    button.textContent = "链上确认中…";
    status.textContent = "交易已提交，正在等待 ARC Testnet 确认。";
    await tx.wait();
    status.textContent = "添加成功。";
    toast("W3 激励添加成功");
    await renderIncentives();
    setTimeout(() => $("addIncentiveDialog").close(), 700);
  } catch (e) {
    const message = e.shortMessage || e.reason || e.message || "添加激励失败";
    status.textContent = message.includes("user rejected")
      ? "已取消钱包请求，可重新点击提交。"
      : message;
    toast(status.textContent);
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
};
$("watchW3").onclick = async () => {
  try {
    const ok = await walletProvider.request({
      method: "wallet_watchAsset",
      params: {
        type: "ERC20",
        options: { address: C.w3, symbol: "W3", decimals: 18 },
      },
    });
    toast(ok ? "已提交添加 W3" : "钱包未添加 W3");
  } catch {
    toast("请复制 W3 合约地址手动添加");
  }
};
loadPool();
loadPoolDirectory();
setTimeout(restore, 150);
if (document.modelContext?.registerTool)
  document.modelContext.registerTool({
    name: "stage_swap",
    title: "准备 V3 智能兑换",
    description: "填写兑换参数并聚合三个 V3 费率池，不广播交易。",
    inputSchema: {
      type: "object",
      properties: {
        tokenIn: { type: "string", enum: ["USDC", "W3"] },
        amountIn: { type: "string" },
        slippagePercent: { type: "number", minimum: 0.01, maximum: 5 },
        mevProtection: { type: "boolean" },
      },
      required: ["tokenIn", "amountIn"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async ({
      tokenIn,
      amountIn,
      slippagePercent = 0.5,
      mevProtection = false,
    }) => {
      $("tokenIn").value = tokenIn;
      $("tokenOut").value = tokenIn === "USDC" ? "W3" : "USDC";
      $("amountIn").value = amountIn;
      slippage = slippagePercent;
      $("mevToggle").checked = mevProtection;
      updateProtection();
      document.querySelector('[data-panel="swap"]').click();
      await quote();
      return {
        staged: true,
        route: "V3 automatic",
        amountOut: $("amountOut").textContent,
      };
    },
  });

const createBack = document.createElement("button");
createBack.id = "createBack";
createBack.className = "back-link create-back";
createBack.textContent = "← 返回流动性池";
$("liquidityEditor").before(createBack);
function openLiquidityEditor(f) {
  const radio = document.querySelector(
    'input[name="liqFee"][value="' + f + '"]',
  );
  if (radio) radio.checked = true;
  document.querySelector("#liqAdd .pool-directory").style.display = "none";
  $("liquidityEditor").classList.add("active");
  createBack.classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
  loadPool();
}
function closeLiquidityEditor() {
  $("liquidityEditor").classList.remove("active");
  createBack.classList.remove("active");
  document.querySelector("#liqAdd .pool-directory").style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}
createBack.onclick = closeLiquidityEditor;
document.addEventListener(
  "click",
  (e) => {
    const add = e.target.closest?.("[data-pool-fee]");
    if (add) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openLiquidityEditor(Number(add.dataset.poolFee));
      return;
    }
    const tab = e.target.closest?.('[data-liq-page="add"]');
    if (tab) setTimeout(closeLiquidityEditor, 0);
  },
  true,
);
$("detailCreate").onclick = () => {
  const f = Number($("detailCreate").dataset.fee);
  $("detailBack").click();
  openLiquidityEditor(f);
};
document.title = "W3 · ARC DEX";
document
  .querySelector('meta[name="theme-color"]')
  ?.setAttribute("content", "#f2f1e9");
const dexNav = document.querySelector(".topbar nav"),
  swapNav = dexNav?.querySelector('[data-panel="swap"]'),
  liquidityNav = dexNav?.querySelector('[data-liq-nav="add"]');
const crosschain = document.createElement("a");
crosschain.href = "/crosschain/";
crosschain.className = "nav crosschain-nav";
crosschain.textContent = "W3 跨链";
dexNav?.append(crosschain);
document.querySelector(".brand")?.setAttribute("href", "/");

// V3 range-aware token matching.
function matchedW3ForUsdc(usdc) {
  if (!(usdc > 0 && currentPrice > 0)) return 0;
  try {
    const { tickLower, tickUpper } = ticksForRange(),
      sqrtP = Math.sqrt(Math.pow(1.0001, currentTick)),
      sqrtL = Math.sqrt(Math.pow(1.0001, tickLower)),
      sqrtU = Math.sqrt(Math.pow(1.0001, tickUpper));
    if (currentTick <= tickLower) return 0;
    if (currentTick >= tickUpper) return usdc / currentPrice;
    const amount0PerL = (sqrtU - sqrtP) / (sqrtP * sqrtU),
      amount1PerL = sqrtP - sqrtL;
    if (!(amount0PerL > 0 && amount1PerL >= 0)) return 0;
    return (((usdc * 1e6) / amount0PerL) * amount1PerL) / 1e18;
  } catch {
    return 0;
  }
}
function updateMatchedLiquidityAmounts() {
  const usdc = Number($("liqUsdc").value);
  $("liqW3").value = usdc > 0 ? matchedW3ForUsdc(usdc).toFixed(6) : "";
}
const baseApplyRange = applyRange;
applyRange = function (percent = 20) {
  baseApplyRange(percent);
  updateMatchedLiquidityAmounts();
};
$("liqUsdc").oninput = updateMatchedLiquidityAmounts;
[$("minPrice"), $("maxPrice")].forEach(
  (x) =>
    (x.oninput = () => {
      fullRange = false;
      document
        .querySelectorAll("[data-range]")
        .forEach((b) => b.classList.remove("active"));
      updateRangeVisual();
      updateMatchedLiquidityAmounts();
    }),
);
document
  .querySelectorAll('input[name="liqFee"]')
  .forEach((x) =>
    x.addEventListener("change", () =>
      setTimeout(updateMatchedLiquidityAmounts, 0),
    ),
  );

// Percentage-based V3 liquidity removal page.
NFPM.push(
  "function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) payable returns(uint256,uint256)",
  "function multicall(bytes[] data) payable returns(bytes[] results)",
);
let removePosition = null,
  removePercent = 50;
const removePage = document.createElement("div");
removePage.id = "liqRemove";
removePage.className = "liq-subpage remove-page";
removePage.innerHTML =
  '<button id="removeBack" class="back-link">← 返回我的流动性</button><div class="remove-shell"><div class="remove-heading"><div><span class="eyebrow">REMOVE V3 LIQUIDITY</span><h2>移除流动性</h2></div><b id="removeNft">NFT #—</b></div><div class="remove-summary"><div><span>流动性池</span><strong id="removePool">USDC / W3</strong></div><div><span>价格区间</span><strong id="removeRange">—</strong></div><div><span>当前流动性</span><strong id="removeCurrentLiquidity">—</strong></div></div><div class="remove-percent"><div><span>选择移除比例</span><strong id="removePercentLabel">50%</strong></div><input id="removeSlider" type="range" min="1" max="100" value="50"><div class="remove-presets"><button data-remove-percent="25">25%</button><button class="active" data-remove-percent="50">50%</button><button data-remove-percent="75">75%</button><button data-remove-percent="100">100%</button></div></div><div class="remove-receive"><span>预计收回</span><div><b id="removeUsdc">— USDC</b><b id="removeW3">— W3</b></div><small>实际到账数量以交易执行时的池状态为准，同时领取该仓位已产生的手续费。</small></div><button id="confirmRemove" class="primary">确认移除 50%</button></div>';
$("liqManage").after(removePage);
function updateRemovePreview(percent) {
  if (!removePosition) return;
  removePercent = Math.max(1, Math.min(100, Number(percent) || 1));
  $("removeSlider").value = removePercent;
  $("removePercentLabel").textContent = removePercent + "%";
  $("confirmRemove").textContent = "确认移除 " + removePercent + "%";
  document
    .querySelectorAll("[data-remove-percent]")
    .forEach((b) =>
      b.classList.toggle(
        "active",
        Number(b.dataset.removePercent) === removePercent,
      ),
    );
  const partial = removePosition.amounts;
  $("removeUsdc").textContent =
    ((partial.usdc * removePercent) / 100).toFixed(6) + " USDC";
  $("removeW3").textContent =
    ((partial.w3 * removePercent) / 100).toFixed(6) + " W3";
}
function openRemovePosition(id) {
  const item = positionCache.get(String(id));
  if (!item) return toast("仓位信息仍在加载");
  removePosition = item;
  document
    .querySelectorAll(".liq-subpage")
    .forEach((x) => x.classList.remove("active"));
  removePage.classList.add("active");
  document.querySelector(".liq-tabs").style.display = "none";
  document.querySelector("#liquidity>.section-title").style.display = "none";
  $("removeNft").textContent = "NFT #" + item.id;
  $("removePool").textContent = "USDC / W3 · " + feeLabel(item.f);
  $("removeRange").textContent =
    fmtPrice(item.low) + " – " + fmtPrice(item.high) + " USDC/W3";
  $("removeCurrentLiquidity").textContent = item.liquidity.toString();
  updateRemovePreview(50);
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function closeRemovePosition() {
  removePage.classList.remove("active");
  $("liqManage").classList.add("active");
  document.querySelector(".liq-tabs").style.display = "flex";
  document.querySelector("#liquidity>.section-title").style.display = "block";
  document
    .querySelectorAll("[data-liq-page]")
    .forEach((x) =>
      x.classList.toggle("active", x.dataset.liqPage === "manage"),
    );
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$("removeBack").onclick = closeRemovePosition;
$("removeSlider").oninput = (e) => updateRemovePreview(e.target.value);
document
  .querySelectorAll("[data-remove-percent]")
  .forEach(
    (b) => (b.onclick = () => updateRemovePreview(b.dataset.removePercent)),
  );
const positionCache = new Map();
loadPositions = async function () {
  const list = $("positionsList");
  positionCache.clear();
  if (!account) {
    list.innerHTML =
      '<div class="empty-position"><b>连接钱包后查看</b><span>这里会显示已添加的 V3 LP 仓位。</span></div>';
    return;
  }
  try {
    const m = new ethers.Contract(C.positionManager, NFPM, provider),
      count = Number(await m.balanceOf(account)),
      rows = [];
    for (let i = 0; i < count; i++) {
      const id = await m.tokenOfOwnerByIndex(account, i),
        p = await m.positions(id);
      if (
        ![p[2].toLowerCase(), p[3].toLowerCase()].includes(
          C.usdc.toLowerCase(),
        ) ||
        ![p[2].toLowerCase(), p[3].toLowerCase()].includes(C.w3.toLowerCase())
      )
        continue;
      const f = Number(p[4]),
        state = poolState[f] || { tick: currentTick, price: currentPrice },
        lower = Number(p[5]),
        upper = Number(p[6]),
        low = priceAtTick(upper),
        high = priceAtTick(lower),
        active = state.tick >= lower && state.tick < upper,
        liquidity = p[7],
        amounts = positionAmounts(liquidity, lower, upper, state.tick),
        value = amounts.usdc + amounts.w3 * state.price,
        unclaimed =
          Number(ethers.formatUnits(p[10], 6)) +
          Number(ethers.formatEther(p[11])) * state.price;
      positionCache.set(id.toString(), {
        id: id.toString(),
        f,
        lower,
        upper,
        low,
        high,
        liquidity,
        amounts,
      });
      rows.push(
        '<article class="position-item"><div class="position-cell"><div class="pool-name"><span class="token-stack"><i>$</i><i>W3</i></span><span><b>USDC / W3</b><small>' +
          feeLabel(f) +
          " fee · NFT #" +
          id +
          '</small></span></div></div><div class="position-cell"><span>仓位价值</span><strong>$' +
          value.toLocaleString(undefined, { maximumFractionDigits: 2 }) +
          "</strong><small>" +
          amounts.usdc.toFixed(4) +
          " USDC + " +
          amounts.w3.toFixed(3) +
          ' W3</small></div><div class="position-cell"><span class="range-status ' +
          (active ? "" : "out") +
          '"><i></i>' +
          (active ? "区间内" : "区间外") +
          '</span><div class="mini-range"></div><strong>' +
          fmtPrice(low) +
          " – " +
          fmtPrice(high) +
          '</strong></div><div class="position-cell"><span>APR</span><strong>—</strong><small>激励待启动</small></div><div class="position-cell"><span>未领取费用</span><strong>$' +
          unclaimed.toFixed(4) +
          '</strong></div><div class="position-actions"><button class="claim-btn" data-claim="' +
          id +
          '">领取</button><button data-remove="' +
          id +
          '">移除</button></div></article>',
      );
    }
    list.innerHTML =
      rows.join("") ||
      '<div class="empty-position"><b>暂无 V3 仓位</b><span>前往“添加流动性”创建第一个 LP NFT。</span></div>';
    list
      .querySelectorAll("[data-claim]")
      .forEach((b) => (b.onclick = () => claimFees(b, b.dataset.claim)));
    list
      .querySelectorAll("[data-remove]")
      .forEach((b) => (b.onclick = () => openRemovePosition(b.dataset.remove)));
  } catch {
    list.innerHTML =
      '<div class="empty-position"><b>仓位读取失败</b><span>请确认钱包网络为 ARC Testnet 后重试。</span></div>';
  }
};
$("confirmRemove").onclick = async () => {
  if (!account || !removePosition) return toast("请先连接钱包");
  const item = removePosition,
    liquidity = (item.liquidity * BigInt(removePercent)) / 100n;
  if (liquidity <= 0n) return toast("移除数量过小");
  const m = new ethers.Contract(C.positionManager, NFPM, signer),
    deadline = Math.floor(Date.now() / 1000) + 1200,
    decrease = m.interface.encodeFunctionData("decreaseLiquidity", [
      { tokenId: item.id, liquidity, amount0Min: 0, amount1Min: 0, deadline },
    ]),
    collect = m.interface.encodeFunctionData("collect", [
      {
        tokenId: item.id,
        recipient: account,
        amount0Max: (1n << 128n) - 1n,
        amount1Max: (1n << 128n) - 1n,
      },
    ]);
  await txButton($("confirmRemove"), () => m.multicall([decrease, collect]));
  closeRemovePosition();
  await loadPositions();
};

// Keep zero-liquidity NFTs visible as historical positions, separate from active LPs.
const removedSection = document.createElement("section");
removedSection.className = "removed-positions";
removedSection.innerHTML =
  '<div class="removed-head"><div><h2>已移除仓位</h2><p>流动性已全部移除、但仓位 NFT 仍由当前钱包持有的记录。</p></div><strong id="removedCount">0 个</strong></div><div class="removed-table-head"><span>流动性池</span><span>仓位 NFT</span><span>原价格区间</span><span>状态</span><span>操作</span></div><div id="removedPositionsList"><div class="removed-empty">暂无已移除仓位</div></div>';
$("positionsList").after(removedSection);
loadPositions = async function () {
  const list = $("positionsList"),
    removedList = $("removedPositionsList");
  positionCache.clear();
  if (!account) {
    list.innerHTML =
      '<div class="empty-position"><b>连接钱包后查看</b><span>这里会显示当前有流动性的 V3 LP 仓位。</span></div>';
    removedList.innerHTML =
      '<div class="removed-empty">连接钱包后查看已移除仓位</div>';
    $("removedCount").textContent = "0 个";
    return;
  }
  try {
    const m = new ethers.Contract(C.positionManager, NFPM, provider),
      count = Number(await m.balanceOf(account)),
      activeRows = [],
      removedRows = [];
    for (let i = 0; i < count; i++) {
      const id = await m.tokenOfOwnerByIndex(account, i),
        p = await m.positions(id);
      if (
        ![p[2].toLowerCase(), p[3].toLowerCase()].includes(
          C.usdc.toLowerCase(),
        ) ||
        ![p[2].toLowerCase(), p[3].toLowerCase()].includes(C.w3.toLowerCase())
      )
        continue;
      const f = Number(p[4]),
        state = poolState[f] || { tick: currentTick, price: currentPrice },
        lower = Number(p[5]),
        upper = Number(p[6]),
        low = priceAtTick(upper),
        high = priceAtTick(lower),
        liquidity = p[7],
        active = state.tick >= lower && state.tick < upper,
        amounts = positionAmounts(liquidity, lower, upper, state.tick),
        value = amounts.usdc + amounts.w3 * state.price,
        unclaimed =
          Number(ethers.formatUnits(p[10], 6)) +
          Number(ethers.formatEther(p[11])) * state.price;
      if (liquidity === 0n) {
        removedRows.push(
          '<article class="removed-item"><div class="pool-name"><span class="token-stack"><i>$</i><i>W3</i></span><span><b>USDC / W3</b><small>' +
            feeLabel(f) +
            " fee</small></span></div><strong>NFT #" +
            id +
            "</strong><span>" +
            fmtPrice(low) +
            " – " +
            fmtPrice(high) +
            '</span><b class="removed-status">已移除</b><a href="' +
            C.explorer +
            "/token/" +
            C.positionManager +
            "?a=" +
            id +
            '" target="_blank" rel="noreferrer">查看 NFT</a></article>',
        );
        continue;
      }
      positionCache.set(id.toString(), {
        id: id.toString(),
        f,
        lower,
        upper,
        low,
        high,
        liquidity,
        amounts,
      });
      activeRows.push(
        '<article class="position-item"><div class="position-cell"><div class="pool-name"><span class="token-stack"><i>$</i><i>W3</i></span><span><b>USDC / W3</b><small>' +
          feeLabel(f) +
          " fee · NFT #" +
          id +
          '</small></span></div></div><div class="position-cell"><span>仓位价值</span><strong>$' +
          value.toLocaleString(undefined, { maximumFractionDigits: 2 }) +
          "</strong><small>" +
          amounts.usdc.toFixed(4) +
          " USDC + " +
          amounts.w3.toFixed(3) +
          ' W3</small></div><div class="position-cell"><span class="range-status ' +
          (active ? "" : "out") +
          '"><i></i>' +
          (active ? "区间内" : "区间外") +
          '</span><div class="mini-range"></div><strong>' +
          fmtPrice(low) +
          " – " +
          fmtPrice(high) +
          '</strong></div><div class="position-cell"><span>APR</span><strong>—</strong><small>激励待启动</small></div><div class="position-cell"><span>未领取费用</span><strong>$' +
          unclaimed.toFixed(4) +
          '</strong></div><div class="position-actions"><button class="claim-btn" data-claim="' +
          id +
          '">领取</button><button data-remove="' +
          id +
          '">移除</button></div></article>',
      );
    }
    list.innerHTML =
      activeRows.join("") ||
      '<div class="empty-position"><b>暂无有效 V3 仓位</b><span>已全部移除的仓位会显示在下方。</span></div>';
    removedList.innerHTML =
      removedRows.join("") || '<div class="removed-empty">暂无已移除仓位</div>';
    $("removedCount").textContent = removedRows.length + " 个";
    list
      .querySelectorAll("[data-claim]")
      .forEach((b) => (b.onclick = () => claimFees(b, b.dataset.claim)));
    list
      .querySelectorAll("[data-remove]")
      .forEach((b) => (b.onclick = () => openRemovePosition(b.dataset.remove)));
  } catch {
    list.innerHTML =
      '<div class="empty-position"><b>仓位读取失败</b><span>请确认钱包网络为 ARC Testnet 后重试。</span></div>';
    removedList.innerHTML =
      '<div class="removed-empty">已移除仓位读取失败</div>';
    $("removedCount").textContent = "—";
  }
};

// A read-only collect simulation includes fee growth accrued since the position was last touched.
const renderPositionsWithStoredFees = loadPositions;
loadPositions = async function () {
  await renderPositionsWithStoredFees();
  if (!account || !signer) return;
  const m = new ethers.Contract(C.positionManager, NFPM, signer),
    max = (1n << 128n) - 1n;
  for (const row of document.querySelectorAll(
    "#positionsList .position-item",
  )) {
    const match = row
        .querySelector(".pool-name small")
        ?.textContent.match(/NFT #(\d+)/),
      feeCell = row.querySelector(".position-cell:nth-child(5)");
    if (!match || !feeCell) continue;
    const strong = feeCell.querySelector("strong");
    try {
      const item = positionCache.get(match[1]),
        quoted = await m.collect.staticCall({
          tokenId: match[1],
          recipient: account,
          amount0Max: max,
          amount1Max: max,
        }),
        usdc = Number(ethers.formatUnits(quoted[0], 6)),
        w3 = Number(ethers.formatEther(quoted[1])),
        usd = usdc + w3 * (poolState[item?.f]?.price || currentPrice);
      strong.textContent = "$" + usd.toFixed(6);
      let detail = feeCell.querySelector("small");
      if (!detail) {
        detail = document.createElement("small");
        feeCell.append(detail);
      }
      detail.textContent = usdc.toFixed(6) + " USDC + " + w3.toFixed(6) + " W3";
    } catch {
      strong.textContent = "读取失败";
    }
  }
};

// NFTs deposited into the rewards contract no longer belong to the wallet at
// the ERC-721 layer. Attribute them using Staker.deposits and show them here.
const stakedSection = document.createElement("section");
stakedSection.className = "staked-positions removed-positions";
stakedSection.innerHTML =
  '<div class="removed-head"><div><h2>已质押流动性</h2><p>仓位、手续费和 W3 奖励均读取当前链上状态。</p></div><strong id="stakedCount">0 个</strong></div><div class="staked-table-head"><span>流动性池</span><span>代币仓位</span><span>价格区间</span><span>未领取手续费</span><span>W3 奖励</span><span>状态</span><span>操作</span></div><div id="stakedPositionsList"><div class="staked-empty">暂无已质押流动性</div></div>';
removedSection.before(stakedSection);
const stakedPositionCache = new Map(),
  renderPositionsWithLiveFees = loadPositions;
async function loadStakedPositions() {
  const list = $("stakedPositionsList");
  stakedPositionCache.clear();
  if (!account) {
    list.innerHTML =
      '<div class="staked-empty">连接钱包后查看已质押流动性</div>';
    $("stakedCount").textContent = "0 个";
    return;
  }
  try {
    const m = new ethers.Contract(C.positionManager, NFPM, provider),
      s = new ethers.Contract(C.staker, STAKER, provider),
      feeRewards = new ethers.Contract(C.feeRewards, FEE_REWARDS, provider),
      total = Number(await m.totalSupply()),
      rows = [],
      max = (1n << 128n) - 1n;
    for (let i = 0; i < total; i++) {
      const id = await m.tokenByIndex(i);
      let owner;
      try {
        owner = await m.ownerOf(id);
      } catch {
        continue;
      }
      const isFeeRewards = owner.toLowerCase() === C.feeRewards.toLowerCase();
      if (!isFeeRewards && owner.toLowerCase() !== C.staker.toLowerCase()) continue;
      const d = isFeeRewards ? await feeRewards.deposits(id) : await s.deposits(id);
      if (d.owner.toLowerCase() !== account.toLowerCase()) continue;
      const p = await m.positions(id);
      if (
        ![p[2].toLowerCase(), p[3].toLowerCase()].includes(
          C.usdc.toLowerCase(),
        ) ||
        ![p[2].toLowerCase(), p[3].toLowerCase()].includes(C.w3.toLowerCase())
      )
        continue;
      const f = Number(p[4]),
        state = poolState[f] || { tick: currentTick, price: currentPrice },
        lower = Number(p[5]),
        upper = Number(p[6]),
        low = priceAtTick(upper),
        high = priceAtTick(lower),
        stakes = isFeeRewards ? 1 : Number(d.numberOfStakes),
        amounts = positionAmounts(p[7], lower, upper, state.tick);
      let feeUsdc = Number(ethers.formatUnits(p[10], 6)),
        feeW3 = Number(ethers.formatEther(p[11])),
        reward = 0;
      try {
        const data = m.interface.encodeFunctionData("collect", [
            {
              tokenId: id,
              recipient: account,
              amount0Max: max,
              amount1Max: max,
            },
          ]),
          raw = await provider.call({
            to: C.positionManager,
            from: isFeeRewards ? C.feeRewards : C.staker,
            data,
          }),
          quoted = m.interface.decodeFunctionResult("collect", raw);
        feeUsdc = Number(ethers.formatUnits(quoted[0], 6));
        feeW3 = Number(ethers.formatEther(quoted[1]));
      } catch {}
      if (isFeeRewards)
        try {
          reward = Number(ethers.formatEther(await feeRewards.pendingReward(id)));
        } catch {}
      else if (stakes > 0)
        try {
          reward = Number(
            ethers.formatEther((await s.getRewardInfo(incentiveKey(f), id))[0]),
          );
        } catch {}
      stakedPositionCache.set(id.toString(), { id: id.toString(), f, stakes, isFeeRewards });
      rows.push(
        '<article class="staked-item"><div class="pool-name"><span class="token-stack"><i>$</i><i>W3</i></span><span><b>USDC / W3</b><small>' +
          feeLabel(f) +
          " fee · NFT #" +
          id +
          '</small></span></div><div class="staked-metric" data-label="代币仓位"><b>' +
          amounts.usdc.toFixed(4) +
          " USDC</b><small>" +
          amounts.w3.toFixed(3) +
          ' W3</small></div><div class="staked-range" data-label="价格区间"><span>' +
          fmtPrice(low) +
          " – " +
          fmtPrice(high) +
          '</span></div><div class="staked-metric" data-label="未领取手续费"><b>' +
          feeUsdc.toFixed(6) +
          " USDC</b><small>" +
          feeW3.toFixed(6) +
          ' W3</small></div><div class="staked-metric reward" data-label="W3 奖励"><b>' +
          reward.toFixed(6) +
          " W3</b><small>" +
          (isFeeRewards ? "周期结束后结算" : stakes ? "实时累计奖励" : "尚未启动激励") +
          '</small></div><b class="staked-status"><i></i>' +
          (isFeeRewards ? "手续费激励中" : stakes ? "质押中" : "未启动") +
          '</b><div class="staked-actions">' +
          (stakes || isFeeRewards
            ? ""
            : '<button class="start-incentive-btn" data-start-incentive="' +
              id +
              '">启动激励</button>') +
          '<button class="redeem-btn" data-redeem="' +
          id +
          '">赎回</button></div></article>',
      );
    }
    list.innerHTML =
      rows.join("") || '<div class="staked-empty">暂无已质押流动性</div>';
    $("stakedCount").textContent = rows.length + " 个";
    list
      .querySelectorAll("[data-redeem]")
      .forEach(
        (b) => (b.onclick = () => redeemStakedPosition(b, b.dataset.redeem)),
      );
    list
      .querySelectorAll("[data-start-incentive]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            activateDepositedPosition(b, b.dataset.startIncentive)),
      );
  } catch {
    list.innerHTML =
      '<div class="staked-empty">已质押流动性读取失败，请稍后重试</div>';
    $("stakedCount").textContent = "—";
  }
}
async function redeemStakedPosition(button, id) {
  if (!account) return toast("请先连接钱包");
  const item = stakedPositionCache.get(String(id));
  if (!item) return toast("质押仓位信息仍在加载");
  const old = button.textContent;
  button.disabled = true;
  button.textContent = "等待钱包确认…";
  try {
    if (item.isFeeRewards) {
      const rewards = new ethers.Contract(C.feeRewards, FEE_REWARDS, signer),
        pool = C.pools[item.f];
      let [, campaign] = await rewards.campaignInfo(pool);
      if (!campaign.finalized) {
        if (Math.floor(Date.now() / 1000) < Number(campaign.end))
          throw Error("7 天激励周期结束后才可赎回");
        button.textContent = "正在结算手续费占比…";
        const finalizeTx = await rewards.finalize(pool, 50);
        await finalizeTx.wait();
        [, campaign] = await rewards.campaignInfo(pool);
        if (!campaign.finalized)
          throw Error("仓位较多，请再次点击赎回以继续分批结算");
      }
      const pending = await rewards.pendingReward(id);
      if (pending > 0n) {
        button.textContent = "正在领取 W3…";
        await (await rewards.claim(id)).wait();
      }
      button.textContent = "正在赎回 LP…";
      await (await rewards.withdraw(id)).wait();
      toast("W3 奖励已结算，LP 已转回钱包");
      await refreshRewards();
      await loadPositions();
      return;
    }
    const s = new ethers.Contract(C.staker, STAKER, signer),
      calls = [];
    if (item.stakes > 0)
      calls.push(
        s.interface.encodeFunctionData("unstakeToken", [
          incentiveKey(item.f),
          id,
        ]),
      );
    calls.push(
      s.interface.encodeFunctionData("withdrawToken", [id, account, "0x"]),
    );
    const tx = await s.multicall(calls);
    button.textContent = "链上赎回中…";
    await tx.wait();
    toast("LP 已解除质押并转回钱包");
    await refreshRewards();
    await loadPositions();
  } catch (e) {
    toast(e.shortMessage || e.message || "赎回失败");
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
}
async function activateDepositedPosition(button, id) {
  if (!account) return toast("请先连接钱包");
  const item = stakedPositionCache.get(String(id));
  if (!item) return toast("仓位信息仍在加载");
  const old = button.textContent;
  button.disabled = true;
  button.textContent = "等待钱包确认…";
  try {
    const tx = await new ethers.Contract(C.staker, STAKER, signer).stakeToken(
      incentiveKey(item.f),
      id,
    );
    button.textContent = "链上启动中…";
    await tx.wait();
    toast("W3 激励已启动");
    await refreshRewards();
    await loadPositions();
  } catch (e) {
    toast(e.shortMessage || e.message || "启动激励失败");
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
}
async function stakeManagedPosition(button, id) {
  if (!account) return toast("请先连接钱包");
  const item = positionCache.get(String(id));
  if (!item) return toast("仓位信息仍在加载");
  const old = button.textContent;
  button.disabled = true;
  try {
    const m = new ethers.Contract(C.positionManager, NFPM, signer),
      key = incentiveKey(item.f),
      data = ethers.AbiCoder.defaultAbiCoder().encode(
        [
          "tuple(address rewardToken,address pool,uint256 startTime,uint256 endTime,address refundee)",
        ],
        [key],
      );
    button.textContent = "等待钱包确认…";
    const tx = await m["safeTransferFrom(address,address,uint256,bytes)"](
      account,
      C.staker,
      id,
      data,
    );
    button.textContent = "链上质押中…";
    await tx.wait();
    toast("LP 已质押并开始累计 W3 奖励");
    await refreshRewards();
    await loadPositions();
  } catch (e) {
    toast(e.shortMessage || e.message || "质押失败");
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
}
let stakedRefreshBusy = false;
loadPositions = async function () {
  await renderPositionsWithLiveFees();
  document
    .querySelectorAll("#positionsList [data-remove]")
    .forEach((remove) => {
      const id = remove.dataset.remove,
        actions = remove.parentElement;
      if (actions.querySelector("[data-stake-managed]")) return;
      const stake = document.createElement("button");
      stake.dataset.stakeManaged = id;
      stake.textContent = "质押";
      stake.onclick = () => stakeManagedPosition(stake, id);
      actions.append(stake);
    });
  await loadStakedPositions();
};
$("refreshPositions").onclick = () => loadPositions();
setInterval(async () => {
  if (
    stakedRefreshBusy ||
    !account ||
    !$("liqManage").classList.contains("active") ||
    document.visibilityState !== "visible"
  )
    return;
  stakedRefreshBusy = true;
  try {
    await loadPositions();
    await refreshRewards();
  } finally {
    stakedRefreshBusy = false;
  }
}, 30000);

// Replace the old execution summary with an on-chain candlestick chart for the
// selected output token. Candles are built only from real Swap events.
const smartExecution = document.querySelector("#swap .side-card"),
  swapShell = document.querySelector("#swap .swap-shell"),
  marketChart = document.createElement("section");
marketChart.className = "market-chart";
marketChart.innerHTML =
  '<div class="market-head"><div><span>目标代币行情</span><h2 id="marketPair">W3 / USDC</h2></div><div><strong id="marketLast">—</strong><small id="marketChange">链上数据</small></div></div><div class="market-toolbar"><span>聚合 0.01% · 0.05% · 0.3% 池</span><div class="market-periods"><button data-market-period="60">1分钟</button><button data-market-period="3600">1小时</button><button class="active" data-market-period="86400">1天</button></div></div><div id="candleChart" class="candle-chart"><div class="chart-loading">正在读取全部链上成交…</div></div><div class="market-foot"><span id="marketLow">最低 —</span><span id="marketSource">ARC Testnet Swap 事件</span><span id="marketHigh">最高 —</span></div><section class="recent-trades"><div class="trades-head"><div><h3>最近 100 笔交易</h3><span>成交价格按 USDC / W3 计价</span></div><strong id="tradeCount">0 笔</strong></div><div class="trades-scroll"><div class="trades-table-head"><span>方向</span><span>W3 数量</span><span>USDC 成交额</span><span>成交价格</span><span>费率池</span><span>区块 / 交易</span></div><div id="recentTrades"><div class="trades-empty">正在读取交易…</div></div></div></section>';
smartExecution?.remove();
swapShell?.before(marketChart);
let marketLoading = false,
  marketStartBlock = 0,
  marketScannedTo = 0,
  marketPeriod = 86400;
async function firstContractBlock(address, latest) {
  let low = 0,
    high = latest;
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2),
      code = await provider.getCode(address, mid);
    if (code === "0x") low = mid;
    else high = mid;
  }
  return high;
}
async function getMarketLogs(filter, retry = 0) {
  try {
    return await provider.getLogs(filter);
  } catch (e) {
    if (retry >= 3) throw e;
    await new Promise((r) => setTimeout(r, 500 * Math.pow(2, retry)));
    return getMarketLogs(filter, retry + 1);
  }
}
async function loadMarketHistory(force = false) {
  if (marketLoading || (marketPoints.length && !force))
    return renderMarketChart();
  marketLoading = true;
  if (!marketPoints.length)
    $("candleChart").innerHTML =
      '<div class="chart-loading">正在读取全部链上成交…</div>';
  try {
    const latest = await provider.getBlockNumber();
    if (!marketStartBlock)
      marketStartBlock =
        Number(C.historyStartBlock) ||
        (await firstContractBlock(C.pools[100], latest));
    const from = marketScannedTo ? marketScannedTo + 1 : marketStartBlock,
      topic = SWAP_EVENT.getEvent("Swap").topicHash,
      logs = [],
      addresses = FEES.map((f) => C.pools[f]);
    for (let start = from; start <= latest; start += 5000) {
      const end = Math.min(latest, start + 4999);
      logs.push(
        ...(await getMarketLogs({
          address: addresses,
          topics: [topic],
          fromBlock: start,
          toBlock: end,
        })),
      );
      if (end < latest) await new Promise((r) => setTimeout(r, 120));
    }
    const blockNumbers = [...new Set(logs.map((log) => log.blockNumber))],
      timestamps = new Map();
    for (let i = 0; i < blockNumbers.length; i += 30) {
      const blocks = await Promise.all(
        blockNumbers
          .slice(i, i + 30)
          .map((number) => provider.getBlock(number)),
      );
      blocks.forEach(
        (block) =>
          block && timestamps.set(block.number, Number(block.timestamp)),
      );
    }
    const fresh = logs
      .map((log) => {
        try {
          const event = SWAP_EVENT.parseLog(log),
            amount0 = event.args.amount0,
            amount1 = event.args.amount1,
            usdc = Number(
              ethers.formatUnits(amount0 < 0n ? -amount0 : amount0, 6),
            ),
            w3 = Number(ethers.formatEther(amount1 < 0n ? -amount1 : amount1)),
            f = Number(
              Object.keys(C.pools).find(
                (key) =>
                  C.pools[key].toLowerCase() === log.address.toLowerCase(),
              ) || 0,
            );
          return {
            block: log.blockNumber,
            timestamp: timestamps.get(log.blockNumber) || 0,
            index: log.index,
            hash: log.transactionHash,
            price: priceAtTick(Number(event.args.tick)),
            tradePrice: w3 ? usdc / w3 : 0,
            usdc,
            w3,
            direction: amount0 > 0n ? "买入 W3" : "卖出 W3",
            fee: f,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    marketScannedTo = latest;
    marketPoints.push(...fresh);
    marketPoints.sort((a, b) => a.block - b.block || a.index - b.index);
    renderMarketChart();
    renderIncentives();
    if ($("liquidity").classList.contains("active")) await loadPoolDirectory();
  } catch {
    $("candleChart").innerHTML =
      '<div class="chart-loading">K 线读取失败，请稍后刷新。</div>';
  } finally {
    marketLoading = false;
  }
}
function renderMarketChart() {
  const target = $("tokenOut").value,
    invert = target === "USDC",
    pair = invert ? "USDC / W3" : "W3 / USDC";
  $("marketPair").textContent = pair;
  renderRecentTrades();
  const points = marketPoints
    .map((x) => ({
      ...x,
      value: invert ? 1 / x.tradePrice : x.tradePrice,
    }))
    .filter((x) => Number.isFinite(x.value) && x.value > 0);
  if (!points.length) {
    $("marketLast").textContent = "—";
    $("marketChange").textContent = "暂无历史成交";
    $("candleChart").innerHTML =
      '<div class="chart-loading">三个费率池创建至今暂无 Swap 成交。</div>';
    return;
  }
  const grouped = new Map();
  for (const p of points) {
    const bucket = Math.floor(p.timestamp / marketPeriod) * marketPeriod,
      c = grouped.get(bucket);
    if (c) {
      c.high = Math.max(c.high, p.value);
      c.low = Math.min(c.low, p.value);
      c.close = p.value;
    } else
      grouped.set(bucket, {
        open: p.value,
        high: p.value,
        low: p.value,
        close: p.value,
      });
  }
  const allCandles = [...grouped.entries()].map(([time, candle]) => ({
      ...candle,
      time,
    })),
    filled = allCandles.slice(-80).map((c, i) => ({ ...c, i })),
    count = Math.max(12, filled.length),
    low = Math.min(...filled.map((c) => c.low)),
    high = Math.max(...filled.map((c) => c.high)),
    range = Math.max(high - low, Math.abs(high) * 0.00001, 1e-12),
    w = 800,
    h = 350,
    pad = 26,
    step = (w - pad * 2) / count,
    scale = (v) => pad + ((high - v) / range) * (h - pad * 2);
  const grid = [0.25, 0.5, 0.75]
      .map(
        (x) =>
          '<line x1="' +
          pad +
          '" x2="' +
          (w - pad) +
          '" y1="' +
          (pad + (h - pad * 2) * x) +
          '" y2="' +
          (pad + (h - pad * 2) * x) +
          '" class="chart-grid"/>',
      )
      .join(""),
    marks = filled
      .map((c) => {
        const x = pad + (c.i + 0.5) * step,
          yOpen = scale(c.open),
          yClose = scale(c.close),
          up = c.close >= c.open,
          y = Math.min(yOpen, yClose),
          height = Math.max(2, Math.abs(yClose - yOpen));
        return (
          '<g class="candle ' +
          (up ? "up" : "down") +
          '"><line x1="' +
          x +
          '" x2="' +
          x +
          '" y1="' +
          scale(c.high) +
          '" y2="' +
          scale(c.low) +
          '"/><rect x="' +
          (x - step * 0.28) +
          '" y="' +
          y +
          '" width="' +
          step * 0.56 +
          '" height="' +
          height +
          '" rx="1"/></g>'
        );
      })
      .join(""),
    last = filled.at(-1).close,
    badges =
      '<div class="chart-price-badges"><span>当前价 <b>' +
      fmtPrice(last) +
      "</b></span><span>最高价 <b>" +
      fmtPrice(high) +
      "</b></span><span>最低价 <b>" +
      fmtPrice(low) +
      "</b></span></div>";
  $("candleChart").innerHTML =
    '<svg viewBox="0 0 800 350" role="img" aria-label="' +
    pair +
    ' 全部链上成交 K 线图">' +
    grid +
    marks +
    "</svg>" +
    badges;
  const first = filled[0].open,
    change = (last / first - 1) * 100;
  $("marketLast").textContent = fmtPrice(last);
  $("marketChange").textContent =
    (change >= 0 ? "+" : "") +
    change.toFixed(2) +
    "% · " +
    points.length +
    " 笔";
  $("marketChange").className = change >= 0 ? "positive" : "negative";
  $("marketLow").textContent = "最低 " + fmtPrice(low);
  $("marketHigh").textContent = "最高 " + fmtPrice(high);
}
function renderRecentTrades() {
  const trades = marketPoints.slice(-100).reverse();
  $("tradeCount").textContent = trades.length + " 笔";
  $("recentTrades").innerHTML =
    trades
      .map(
        (t) =>
          '<div class="trade-row"><b class="trade-direction ' +
          (t.direction.startsWith("买") ? "buy" : "sell") +
          '">' +
          t.direction +
          "</b><span>" +
          t.w3.toLocaleString(undefined, { maximumFractionDigits: 6 }) +
          "</span><span>" +
          t.usdc.toLocaleString(undefined, { maximumFractionDigits: 6 }) +
          "</span><strong>" +
          fmtPrice(t.tradePrice) +
          " USDC</strong><span>" +
          feeLabel(t.fee) +
          '</span><a href="' +
          C.explorer +
          "/tx/" +
          t.hash +
          '" target="_blank" rel="noreferrer">#' +
          t.block.toLocaleString() +
          " ↗</a></div>",
      )
      .join("") || '<div class="trades-empty">暂无历史交易</div>';
}
const baseTokenInChange = $("tokenIn").onchange,
  baseFlip = $("flip").onclick;
$("tokenIn").onchange = async (e) => {
  await baseTokenInChange(e);
  renderMarketChart();
};
$("flip").onclick = async (e) => {
  await baseFlip(e);
  renderMarketChart();
};
document.querySelectorAll("[data-market-period]").forEach((button) => {
  button.onclick = () => {
    marketPeriod = Number(button.dataset.marketPeriod);
    document
      .querySelectorAll("[data-market-period]")
      .forEach((item) => item.classList.toggle("active", item === button));
    renderMarketChart();
  };
});
setTokenFieldVisibility("In");
setTokenFieldVisibility("Out");
document
  .querySelector('[data-panel="swap"]')
  .addEventListener("click", () => loadMarketHistory());
// Let the visible shell and core pool snapshot finish first. Full historical
// Swap indexing is useful but must never compete with first-page rendering.
setTimeout(() => loadMarketHistory(), 1800);
$('stakeTokenId').addEventListener("input", refreshRewards);
setInterval(() => {
  if (document.visibilityState === "visible") loadMarketHistory(true);
}, 30000);

// Draggable V3 price-range handles. Fit the visible scale to the selected
// interval so narrow presets still leave a generous, touch-friendly gap.
const minPriceSlider = $("minPriceSlider"),
  maxPriceSlider = $("maxPriceSlider");
let sliderViewMin = Math.max(Number.EPSILON, currentPrice * 0.7),
  sliderViewMax = currentPrice * 1.3;
function fitSliderViewport(min, max) {
  if (!(min > 0 && max > min)) {
    sliderViewMin = Math.max(Number.EPSILON, currentPrice * 0.5);
    sliderViewMax = currentPrice * 1.5;
    return;
  }
  const span = max - min;
  const padding = Math.max(span * 0.35, currentPrice * 0.015);
  sliderViewMin = Math.max(Number.EPSILON, min - padding);
  sliderViewMax = max + padding;
}
function priceFromSlider(value) {
  const progress = Number(value) / 1000;
  return sliderViewMin + progress * (sliderViewMax - sliderViewMin);
}
function sliderFromPrice(price) {
  const span = sliderViewMax - sliderViewMin;
  if (!(price > 0 && span > 0)) return 0;
  return Math.max(
    0,
    Math.min(
      1000,
      Math.round(((price - sliderViewMin) / span) * 1000),
    ),
  );
}
function currentMarkerPercent() {
  const span = sliderViewMax - sliderViewMin;
  if (!(span > 0)) return 50;
  return Math.max(0, Math.min(100, ((currentPrice - sliderViewMin) / span) * 100));
}
function syncPriceSlidersFromNumbers({ fit = true } = {}) {
  if (fullRange) {
    minPriceSlider.value = 0;
    maxPriceSlider.value = 1000;
    return;
  }
  const min = Number($("minPrice").value),
    max = Number($("maxPrice").value);
  if (fit && min > 0 && max > min) fitSliderViewport(min, max);
  if (min > 0) minPriceSlider.value = sliderFromPrice(min);
  if (max > min) maxPriceSlider.value = sliderFromPrice(max);
}
const baseUpdateRangeVisual = updateRangeVisual;
updateRangeVisual = function () {
  baseUpdateRangeVisual();
  syncPriceSlidersFromNumbers();
  const left = fullRange ? 0 : Number(minPriceSlider.value) / 10,
    right = fullRange ? 100 : Number(maxPriceSlider.value) / 10;
  $("rangeFill").style.left = left + "%";
  $("rangeFill").style.width = Math.max(0, right - left) + "%";
  $("priceMarker").style.left = currentMarkerPercent() + "%";
};
function updatePricesFromSlider(changed) {
  let low = Number(minPriceSlider.value),
    high = Number(maxPriceSlider.value);
  if (changed === "min" && low >= high) {
    low = Math.max(0, high - 1);
    minPriceSlider.value = low;
  }
  if (changed === "max" && high <= low) {
    high = Math.min(1000, low + 1);
    maxPriceSlider.value = high;
  }
  fullRange = false;
  document
    .querySelectorAll("[data-range]")
    .forEach((button) => button.classList.remove("active"));
  $("minPrice").value = fmtPrice(priceFromSlider(low));
  $("maxPrice").value = fmtPrice(priceFromSlider(high));
  baseUpdateRangeVisual();
  $("rangeFill").style.left = low / 10 + "%";
  $("rangeFill").style.width = (high - low) / 10 + "%";
  $("priceMarker").style.left = currentMarkerPercent() + "%";
  updateMatchedLiquidityAmounts();
}
minPriceSlider.oninput = () => updatePricesFromSlider("min");
maxPriceSlider.oninput = () => updatePricesFromSlider("max");
[$("minPrice"), $("maxPrice")].forEach((input) =>
  input.addEventListener("input", () => setTimeout(updateRangeVisual, 0)),
);
syncPriceSlidersFromNumbers();
