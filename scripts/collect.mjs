#!/usr/bin/env node
// 시장 데이터 수집: 네이버 증권 + 업비트 공개 API
// 사용: node scripts/collect.mjs [YYYY-MM-DD]  -> data/snapshots/<date>.json 저장 + 요약 출력
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const H = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36' };
const HIST = 30;

const kstDate = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const date = process.argv[2] || kstDate();

async function j(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: H });
      if (r.ok) return await r.json();
      if (r.status < 500 && r.status !== 429) throw new Error(`${r.status} ${url}`);
    } catch (e) {
      if (i === tries - 1) throw e;
    }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  throw new Error(`failed ${url}`);
}
const num = (v) => (v == null || v === '' || v === 'N/A' ? null : Number(String(v).replace(/,/g, '').replace(/^\+/, '')));
const errors = [];
async function safe(label, fn, fallback = null) {
  try { return await fn(); } catch (e) { errors.push(`${label}: ${e.message}`); return fallback; }
}

// ---------- 지수 ----------
const US_INDICES = [
  ['.INX', 'S&P 500'], ['.IXIC', '나스닥'], ['.DJI', '다우'], ['.SOX', '필라델피아 반도체'], ['.VIX', 'VIX'],
];
const KR_INDICES = [['KOSPI', '코스피'], ['KOSDAQ', '코스닥']];

async function usIndex([code, name]) {
  const b = await j(`https://api.stock.naver.com/index/${code}/basic`);
  const hist = await safe(`${code} hist`, async () =>
    (await j(`https://api.stock.naver.com/chart/foreign/index/${code}?periodType=dayCandle`)).priceInfos.slice(-HIST).map((p) => ({ d: p.localDate, c: p.closePrice })), []);
  return { code, name, close: num(b.closePrice), change: num(b.compareToPreviousClosePrice), changePct: num(b.fluctuationsRatio), asOf: b.localTradedAt, history: hist };
}
async function krIndex([code, name]) {
  const b = await j(`https://m.stock.naver.com/api/index/${code}/basic`);
  const hist = await safe(`${code} hist`, async () =>
    (await j(`https://api.stock.naver.com/chart/domestic/index/${code}?periodType=dayCandle`)).priceInfos.slice(-HIST).map((p) => ({ d: p.localDate, c: p.closePrice })), []);
  return { code, name, close: num(b.closePrice), change: num(b.compareToPreviousClosePrice), changePct: num(b.fluctuationsRatio), asOf: b.localTradedAt, marketStatus: b.marketStatus, history: hist };
}

// ---------- 매크로 ----------
const MACRO = [
  ['exchange', 'FX_USDKRW', '원/달러 환율', '원'],
  ['bond', 'US10YT=RR', '미국채 10년', '%'],
  ['energy', 'CLcv1', 'WTI 유가', '$'],
  ['metals', 'GCcv1', '국제 금', '$'],
];
async function macro([cat, code, name, unit]) {
  const b = await j(`https://api.stock.naver.com/marketindex/${cat}/${encodeURIComponent(code)}`);
  const info = b.exchangeInfo || b;
  const prices = await safe(`${code} hist`, () => j(`https://api.stock.naver.com/marketindex/${cat}/${encodeURIComponent(code)}/prices?page=1&pageSize=${HIST}`), []);
  const history = (Array.isArray(prices) ? prices : []).map((p) => ({ d: String(p.localTradedAt).slice(0, 10).replace(/-/g, ''), c: num(p.closePrice) })).reverse();
  return { code, name, unit, close: num(info.closePrice), change: num(info.fluctuations ?? info.compareToPreviousClosePrice), changePct: num(info.fluctuationsRatio), asOf: info.localTradedAt, history };
}
async function btc() {
  const [t] = await j('https://api.upbit.com/v1/ticker?markets=KRW-BTC');
  const c = await safe('btc hist', () => j(`https://api.upbit.com/v1/candles/days?market=KRW-BTC&count=${HIST}`), []);
  return { code: 'KRW-BTC', name: '비트코인', unit: '원', close: t.trade_price, change: t.signed_change_price, changePct: +(t.signed_change_rate * 100).toFixed(2), asOf: `${t.trade_date_kst}T${t.trade_time_kst}`,
    history: c.map((x) => ({ d: x.candle_date_time_kst.slice(0, 10).replace(/-/g, ''), c: x.trade_price })).reverse() };
}

// ---------- 종목 ----------
const usStock = (s) => ({ symbol: s.symbolCode, name: s.stockName, sector: s.industryCodeType?.industryGroupKor || '', close: num(s.closePrice), changePct: num(s.fluctuationsRatio), marketCap: s.marketValueKrwHangeul || s.marketValueHangeul || '' });
const krStock = (s) => ({ code: s.itemCode, name: s.stockName, close: num(s.closePrice), changePct: num(s.fluctuationsRatio), marketCap: s.marketValueHangeul || '', tradingValue: s.accumulatedTradingValueKrwHangeul || '', mcap: num(s.marketValue) });

async function usMegacaps() {
  const [nq, ny] = await Promise.all([
    j('https://api.stock.naver.com/stock/exchange/NASDAQ/marketValue?page=1&pageSize=10'),
    j('https://api.stock.naver.com/stock/exchange/NYSE/marketValue?page=1&pageSize=6'),
  ]);
  return [...nq.stocks, ...ny.stocks].map(usStock);
}
async function krMovers(mkt, dir) {
  const r = await j(`https://m.stock.naver.com/api/stocks/${dir}/${mkt}?page=1&pageSize=100`);
  // 우선주/소형주 노이즈 제거: 보통주 + 시총 3,000억 이상
  return r.stocks.filter((s) => s.stockEndType === 'stock' && num(s.marketValue) >= 3000).slice(0, 5).map(krStock);
}
async function flows(mkt) {
  const t = await j(`https://m.stock.naver.com/api/index/${mkt}/trend`);
  return { bizdate: t.bizdate, personal: num(t.personalValue), foreign: num(t.foreignValue), institutional: num(t.institutionalValue), unit: '억원' };
}
async function news() {
  const list = await j('https://m.stock.naver.com/api/news/list?category=mainnews&pageSize=20');
  return list.map((n) => ({ title: n.tit, summary: (n.subcontent || '').trim(), source: n.ohnm, dt: n.dt, url: `https://n.news.naver.com/mnews/article/${n.oid}/${n.aid}` }));
}

// ---------- 실행 ----------
const [usIdx, krIdx, mac, bt, mega, kospiTop, flowK, flowQ, upK, downK, upQ, downQ, nws] = await Promise.all([
  Promise.all(US_INDICES.map((x) => safe(x[0], () => usIndex(x)))),
  Promise.all(KR_INDICES.map((x) => safe(x[0], () => krIndex(x)))),
  Promise.all(MACRO.map((x) => safe(x[1], () => macro(x)))),
  safe('btc', btc),
  safe('us megacaps', usMegacaps, []),
  safe('kospi top', async () => (await j('https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=1&pageSize=10')).stocks.map(krStock), []),
  safe('flow kospi', () => flows('KOSPI')),
  safe('flow kosdaq', () => flows('KOSDAQ')),
  safe('up kospi', () => krMovers('KOSPI', 'up'), []),
  safe('down kospi', () => krMovers('KOSPI', 'down'), []),
  safe('up kosdaq', () => krMovers('KOSDAQ', 'up'), []),
  safe('down kosdaq', () => krMovers('KOSDAQ', 'down'), []),
  safe('news', news, []),
]);

const snap = {
  date,
  generatedAt: new Date().toISOString(),
  us: { indices: usIdx.filter(Boolean), megacaps: mega },
  kr: { indices: krIdx.filter(Boolean), flows: { KOSPI: flowK, KOSDAQ: flowQ }, topCaps: kospiTop,
    movers: { kospiUp: upK, kospiDown: downK, kosdaqUp: upQ, kosdaqDown: downQ } },
  macro: [...mac.filter(Boolean), bt].filter(Boolean),
  news: nws,
  errors,
};

const out = path.join(ROOT, 'data', 'snapshots', `${date}.json`);
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify(snap, null, 2));

// ---------- 글쓰기용 요약 ----------
const f = (n, d = 2) => (n == null ? '-' : n.toLocaleString('en-US', { maximumFractionDigits: d }));
const p = (n) => (n == null ? '-' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`);
const L = [];
L.push(`# 스냅샷 ${date} (저장: ${path.relative(ROOT, out)})`);
L.push('\n## 미국 지수');
for (const i of snap.us.indices) L.push(`- ${i.name}: ${f(i.close)} (${p(i.changePct)}) asOf ${i.asOf}`);
L.push('\n## 국내 지수');
for (const i of snap.kr.indices) L.push(`- ${i.name}: ${f(i.close)} (${p(i.changePct)}) asOf ${i.asOf} [${i.marketStatus}]`);
L.push('\n## 수급 (억원, +순매수)');
for (const [k, v] of Object.entries(snap.kr.flows)) if (v) L.push(`- ${k} ${v.bizdate}: 개인 ${f(v.personal)} / 외국인 ${f(v.foreign)} / 기관 ${f(v.institutional)}`);
L.push('\n## 매크로');
for (const m of snap.macro) L.push(`- ${m.name}: ${f(m.close)}${m.unit === '%' ? '%' : ''} (${p(m.changePct)})`);
L.push('\n## 미국 시총 상위');
for (const s of snap.us.megacaps) L.push(`- ${s.name}(${s.symbol}) ${f(s.close)} ${p(s.changePct)} [${s.sector}]`);
L.push('\n## 코스피 시총 상위');
for (const s of snap.kr.topCaps) L.push(`- ${s.name} ${f(s.close, 0)} ${p(s.changePct)}`);
L.push('\n## 국내 등락 상위 (시총 3천억+)');
for (const [k, arr] of Object.entries(snap.kr.movers)) L.push(`- ${k}: ${arr.map((s) => `${s.name} ${p(s.changePct)}`).join(', ')}`);
L.push('\n## 주요 뉴스 (네이버 증권)');
for (const n of snap.news) L.push(`- [${n.source} ${n.dt}] ${n.title} :: ${n.summary.slice(0, 120)} <${n.url}>`);
if (errors.length) L.push(`\n## 수집 오류\n${errors.map((e) => `- ${e}`).join('\n')}`);
console.log(L.join('\n'));
