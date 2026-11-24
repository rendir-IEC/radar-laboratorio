import worker from '../worker.js';
const ENV = { TOKEN: 'secreto123' };
const resp = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
const DIA = 86400; let paginas = 0;
const listado = { ethusd: Date.parse('2017-08-16T00:00:00Z') / 1000, btcusd: Date.parse('2011-08-18T00:00:00Z') / 1000 };
globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.host === 'www.bitstamp.net') {
    paginas++;
    const par = u.pathname.split('/')[4];
    const start = +u.searchParams.get('start'), limit = +u.searchParams.get('limit');
    const hoy = Math.floor(Date.now() / 1000 / DIA) * DIA; const out = [];
    for (let k = 0; k < limit; k++) { const t = Math.ceil(start / DIA) * DIA + k * DIA; if (t > hoy) break; if (t >= listado[par]) out.push({ timestamp: String(t), open: '1', high: '2', low: '0.5', close: '1.5', volume: '1' }); }
    return resp({ data: { pair: par, ohlc: out } });
  }
  throw new Error('Host no simulado ' + u.host);
};
const llamar = async (name, args) => { const r = await worker.fetch(new Request('https://x.workers.dev/mcp/secreto123', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }), ENV); const j = await r.json(); return JSON.parse(j.result.content[0].text); };
const check = (c, m) => { console.log((c ? 'OK   ' : 'FALLO') + ' ' + m); if (!c) process.exitCode = 1; };
const hoy = new Date().toISOString().slice(0, 10);
let e = await llamar('historico_diario', { simbolo: 'ETH' });
const esperado = Math.floor((Date.now() - Date.parse('2017-08-16T00:00:00Z')) / 864e5) + 1;
check(e.desde === '2017-08-16' && e.hasta === hoy, 'ETH desde 2017-08-16 hasta hoy: ' + e.desde + ' → ' + e.hasta);
check(Math.abs(e.dias - esperado) <= 1, 'ETH sin huecos: ' + e.dias + ' días (esperado ~' + esperado + '), ' + paginas + ' páginas');
paginas = 0;
const b = await llamar('historico_diario', { simbolo: 'BTC' });
const espB = Math.floor((Date.now() - Date.parse('2015-01-01T00:00:00Z')) / 864e5) + 1;
check(b.desde === '2015-01-01' && Math.abs(b.dias - espB) <= 1, 'BTC desde 2015 sin huecos: ' + b.dias + ' días, ' + paginas + ' páginas');
