/* CryptoFolio - application logic */

// ---------- Coin Registry ----------
const COINS = [
  { id: "bitcoin",       name: "Bitcoin",   symbol: "BTC",  emoji: "₿", color: "#f7931a" },
  { id: "ethereum",      name: "Ethereum",  symbol: "ETH",  emoji: "Ξ", color: "#627eea" },
  { id: "tether",        name: "Tether",    symbol: "USDT", emoji: "₮", color: "#26a17b" },
  { id: "binancecoin",   name: "BNB",       symbol: "BNB",  emoji: "◆", color: "#f3ba2f" },
  { id: "solana",        name: "Solana",    symbol: "SOL",  emoji: "◎", color: "#9945ff" },
  { id: "ripple",        name: "XRP",       symbol: "XRP",  emoji: "✕", color: "#00aae4" },
  { id: "usd-coin",      name: "USD Coin",  symbol: "USDC", emoji: "$", color: "#2775ca" },
  { id: "cardano",       name: "Cardano",   symbol: "ADA",  emoji: "₳", color: "#3cc8c8" },
  { id: "dogecoin",      name: "Dogecoin",  symbol: "DOGE", emoji: "Ð", color: "#c2a633" },
  { id: "avalanche-2",   name: "Avalanche", symbol: "AVAX", emoji: "▲", color: "#e84142" },
  { id: "tron",          name: "TRON",      symbol: "TRX",  emoji: "◈", color: "#ff060a" },
  { id: "polkadot",      name: "Polkadot",  symbol: "DOT",  emoji: "●", color: "#e6007a" }
];

const STORAGE_KEY = "cryptoPortfolio";
const REFRESH_SECONDS = 60;
const RETRY_WAITS = [15, 30, 45]; // seconds, for HTTP 429

// ---------- State ----------
let portfolio = [];
let marketData = {};          // keyed by coin id (cached prices)
let sortKey = "coin";
let sortAsc = true;
let countdown = REFRESH_SECONDS;
let fetching = false;

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const coinInfo = (id) => COINS.find((c) => c.id === id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const inrCompact = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: "compact", maximumFractionDigits: 2 });
const fmtINR = (n) => inr.format(n);
const fmtPct = (n) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
const plClass = (n) => (n >= 0 ? "positive" : "negative");

function showToast(message, type = "info") {
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = message;
  $("toast-container").appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------- Portfolio Storage ----------
function loadPortfolio() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    portfolio = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(portfolio)) portfolio = [];
  } catch (e) {
    portfolio = [];
  }
}

function savePortfolio() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio));
  } catch (e) {
    showToast("Could not save portfolio to browser storage.", "error");
  }
}

// ---------- Market Data (CoinGecko) ----------
async function fetchAllMarketData() {
  if (fetching) return;
  fetching = true;
  const ids = COINS.map((c) => c.id).join(",");
  const url =
    "https://api.coingecko.com/api/v3/coins/markets?vs_currency=inr" +
    "&ids=" + encodeURIComponent(ids) +
    "&order=market_cap_desc&per_page=50&page=1&sparkline=true" +
    "&price_change_percentage=24h,7d";

  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        if (attempt < RETRY_WAITS.length) {
          const wait = RETRY_WAITS[attempt++];
          showToast("Rate limited. Retrying in " + wait + "s...", "info");
          await sleep(wait * 1000);
          continue;
        }
        throw new Error("Rate limit exceeded (HTTP 429)");
      }
      if (!res.ok) throw new Error("HTTP error " + res.status);

      const data = await res.json();
      data.forEach((c) => { marketData[c.id] = c; });
      $("last-updated").textContent = "Updated " + new Date().toLocaleTimeString();
      $("status-dot").className = "dot live";
      renderAll();
      break;
    } catch (err) {
      $("status-dot").className = "dot error";
      if (Object.keys(marketData).length === 0) {
        showToast("Failed to load market data: " + err.message, "error");
      } else {
        showToast("Update failed, showing last known prices.", "error");
        renderAll();
      }
      break;
    }
  }
  fetching = false;
}

// ---------- Investment Form ----------
function populateCoinSelect() {
  const sel = $("coin-select");
  COINS.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.emoji + " " + c.name + " (" + c.symbol + ")";
    sel.appendChild(opt);
  });
}

function handleAddInvestment(e) {
  e.preventDefault();
  const coin = $("coin-select").value;
  const quantity = parseFloat($("quantity").value);
  const buyPrice = parseFloat($("buy-price").value);

  if (!coin || !coinInfo(coin)) return showToast("Please select a coin.", "error");
  if (!(quantity > 0)) return showToast("Quantity must be greater than zero.", "error");
  if (!(buyPrice > 0)) return showToast("Buy price must be greater than zero.", "error");

  portfolio.push({ id: Date.now(), coin, quantity, buyPrice });
  savePortfolio();
  $("investment-form").reset();
  renderAll();
  showToast(coinInfo(coin).name + " investment added.", "success");
}

function removeInvestment(id) {
  portfolio = portfolio.filter((p) => p.id !== id);
  savePortfolio();
  renderAll();
  showToast("Investment removed.", "info");
}

// ---------- Calculations ----------
function computeHolding(h) {
  const price = marketData[h.coin] ? marketData[h.coin].current_price : null;
  const investment = h.quantity * h.buyPrice;
  const current = price !== null ? h.quantity * price : null;
  const pl = current !== null ? current - investment : null;
  const ret = pl !== null && investment > 0 ? (pl / investment) * 100 : null;
  return { ...h, name: coinInfo(h.coin).name, investment, current, pl, ret };
}

// ---------- Rendering ----------
function renderSummary(rows) {
  let invested = 0, current = 0;
  rows.forEach((r) => {
    invested += r.investment;
    if (r.current !== null) current += r.current;
    else current += r.investment; // no price yet: treat as neutral
  });
  const pl = current - invested;
  const ret = invested > 0 ? (pl / invested) * 100 : 0;

  $("total-investment").textContent = fmtINR(invested);
  $("current-value").textContent = fmtINR(current);
  $("total-pl").textContent = (pl >= 0 ? "+" : "") + fmtINR(pl);
  $("total-pl").className = "value " + plClass(pl);
  $("total-return").textContent = fmtPct(ret);
  $("total-return").className = "value " + plClass(ret);
}

function renderAllocation(rows) {
  const bar = $("alloc-bar");
  const legend = $("alloc-legend");
  bar.innerHTML = "";
  legend.innerHTML = "";

  const byCoin = {};
  rows.forEach((r) => {
    const v = r.current !== null ? r.current : r.investment;
    byCoin[r.coin] = (byCoin[r.coin] || 0) + v;
  });
  const total = Object.values(byCoin).reduce((a, b) => a + b, 0);
  if (total <= 0) {
    legend.textContent = "Add an investment to see allocation.";
    return;
  }

  Object.entries(byCoin).forEach(([id, value]) => {
    const info = coinInfo(id);
    const pct = (value / total) * 100;

    const seg = document.createElement("div");
    seg.className = "alloc-seg";
    seg.style.width = pct + "%";
    seg.style.background = info.color;
    seg.title = info.name + ": " + pct.toFixed(1) + "%";
    bar.appendChild(seg);

    const item = document.createElement("span");
    const dot = document.createElement("i");
    dot.style.background = info.color;
    item.appendChild(dot);
    item.appendChild(document.createTextNode(info.symbol + " " + pct.toFixed(1) + "%"));
    legend.appendChild(item);
  });
}

function renderHoldings(rows) {
  const body = $("holdings-body");
  body.innerHTML = "";

  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.className = "empty";
    td.textContent = "No investments yet. Add one above.";
    tr.appendChild(td);
    body.appendChild(tr);
  }

  const val = (r) => {
    switch (sortKey) {
      case "coin": return r.name;
      case "quantity": return r.quantity;
      case "buyPrice": return r.buyPrice;
      case "investment": return r.investment;
      case "current": return r.current ?? -Infinity;
      case "pl": return r.pl ?? -Infinity;
      case "ret": return r.ret ?? -Infinity;
    }
  };
  const sorted = [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    const cmp = typeof x === "string" ? x.localeCompare(y) : x - y;
    return sortAsc ? cmp : -cmp;
  });

  sorted.forEach((r) => {
    const tr = document.createElement("tr");
    const cells = [
      r.name,
      r.quantity,
      fmtINR(r.buyPrice),
      fmtINR(r.investment),
      r.current !== null ? fmtINR(r.current) : "—",
      r.pl !== null ? (r.pl >= 0 ? "+" : "") + fmtINR(r.pl) : "—",
      r.ret !== null ? fmtPct(r.ret) : "—"
    ];
    cells.forEach((text, i) => {
      const td = document.createElement("td");
      td.textContent = text;
      if ((i === 5 || i === 6) && r.pl !== null) td.className = plClass(r.pl);
      tr.appendChild(td);
    });
    const tdAct = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "btn danger";
    btn.textContent = "Remove";
    btn.addEventListener("click", () => removeInvestment(r.id));
    tdAct.appendChild(btn);
    tr.appendChild(tdAct);
    body.appendChild(tr);
  });

  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.classList.remove("sorted-asc", "sorted-desc");
    if (th.dataset.sort === sortKey) th.classList.add(sortAsc ? "sorted-asc" : "sorted-desc");
  });
}

function renderTicker() {
  const items = COINS.filter((c) => marketData[c.id]).map((c) => {
    const d = marketData[c.id];
    const ch = d.price_change_percentage_24h ?? 0;
    return '<span class="ticker-item">' + c.emoji + " " + c.symbol + " " + fmtINR(d.current_price) +
      ' <span class="' + plClass(ch) + '">' + fmtPct(ch) + "</span></span>";
  }).join("");
  if (items) $("ticker").innerHTML = items + items; // duplicated for seamless loop
}

function drawSparkline(canvas, prices, color) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  if (!prices || prices.length < 2) return;

  const min = Math.min(...prices), max = Math.max(...prices);
  const range = max - min || 1;
  ctx.beginPath();
  prices.forEach((p, i) => {
    const x = (i / (prices.length - 1)) * w;
    const y = h - 4 - ((p - min) / range) * (h - 8);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

function renderMarket() {
  const grid = $("market-grid");
  const q = $("search").value.trim().toLowerCase();
  grid.innerHTML = "";

  COINS.filter((c) => !q || c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q))
    .forEach((c) => {
      const d = marketData[c.id];
      if (!d) return;
      const ch = d.price_change_percentage_24h_in_currency ?? d.price_change_percentage_24h ?? 0;

      const card = document.createElement("div");
      card.className = "card coin-card";

      const head = document.createElement("div");
      head.className = "coin-head";
      const title = document.createElement("div");
      const nm = document.createElement("span");
      nm.className = "coin-name";
      nm.textContent = c.emoji + " " + c.name;
      const sym = document.createElement("span");
      sym.className = "coin-sym";
      sym.textContent = c.symbol;
      title.append(nm, sym);
      const chg = document.createElement("span");
      chg.className = plClass(ch);
      chg.textContent = fmtPct(ch);
      head.append(title, chg);

      const price = document.createElement("div");
      price.className = "coin-price";
      price.textContent = fmtINR(d.current_price);

      const canvas = document.createElement("canvas");
      canvas.className = "spark";

      const meta = document.createElement("div");
      meta.className = "coin-meta";
      const mc = document.createElement("span");
      mc.textContent = "MCap " + inrCompact.format(d.market_cap);
      const vol = document.createElement("span");
      vol.textContent = "Vol " + inrCompact.format(d.total_volume);
      meta.append(mc, vol);

      card.append(head, price, canvas, meta);
      grid.appendChild(card);

      const trend = d.price_change_percentage_7d_in_currency ?? 0;
      drawSparkline(canvas, d.sparkline_in_7d && d.sparkline_in_7d.price, trend >= 0 ? "#22c55e" : "#ef4444");
    });

  if (!grid.children.length) {
    grid.textContent = Object.keys(marketData).length ? "No matching coins." : "Loading market data...";
  }
}

function renderAll() {
  const rows = portfolio.filter((h) => coinInfo(h.coin)).map(computeHolding);
  renderSummary(rows);
  renderAllocation(rows);
  renderHoldings(rows);
  renderTicker();
  renderMarket();
}

// ---------- Sorting ----------
function handleSort(key) {
  if (sortKey === key) sortAsc = !sortAsc;
  else { sortKey = key; sortAsc = true; }
  renderAll();
}

// ---------- Export ----------
function exportPortfolio() {
  if (portfolio.length === 0) return showToast("Portfolio is empty. Nothing to export.", "error");
  const blob = new Blob([JSON.stringify(portfolio, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "crypto-portfolio-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Portfolio exported.", "success");
}

// ---------- Auto refresh ----------
function startCountdown() {
  setInterval(() => {
    countdown--;
    if (countdown <= 0) {
      countdown = REFRESH_SECONDS;
      fetchAllMarketData();
    }
    $("countdown").textContent = countdown;
  }, 1000);
}

// ---------- Initialization ----------
document.addEventListener("DOMContentLoaded", () => {
  populateCoinSelect();
  $("investment-form").addEventListener("submit", handleAddInvestment);
  $("export-btn").addEventListener("click", exportPortfolio);
  $("search").addEventListener("input", renderMarket);
  document.querySelectorAll("th[data-sort]").forEach((th) =>
    th.addEventListener("click", () => handleSort(th.dataset.sort))
  );
  window.addEventListener("resize", renderMarket);

  loadPortfolio();
  renderAll();
  fetchAllMarketData();
  startCountdown();
});
