// netlify/functions/tiktok-insights.js
//
// Busca gasto/cliques/impressões por campanha, por dia, na TikTok Business API.
// Também entra só no nível de campanha por enquanto.
//
// Credenciais podem vir da tela de Integrações (salvas no Netlify Blobs) ou,
// como alternativa avançada, das variáveis de ambiente:
//   TIKTOK_ACCESS_TOKEN, TIKTOK_ADVERTISER_ID

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  let token = process.env.TIKTOK_ACCESS_TOKEN;
  let advertiserId = process.env.TIKTOK_ADVERTISER_ID;

  try {
    const store = getStore('aurum-track-settings');
    const saved = await store.get('tiktok', { type: 'json' });
    if (saved && saved.token) token = saved.token;
    if (saved && saved.advertiserId) advertiserId = saved.advertiserId;
  } catch (e) { /* segue só com env vars, se existirem */ }

  if (!token || !advertiserId) {
    // TikTok Ads não conectado ainda — devolve lista vazia (não é erro fatal).
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([]) };
  }

  const qp = event.queryStringParameters || {};
  const since = qp.since || isoDaysAgo(30);
  const until = qp.until || isoDaysAgo(0);

  // Mapa de status das campanhas (ativo/pausado)
  const statusMap = {};
  try {
    const campUrl = 'https://business-api.tiktok.com/open_api/v1.3/campaign/get/'
      + `?advertiser_id=${advertiserId}&page_size=1000&fields=${encodeURIComponent(JSON.stringify(['campaign_id','campaign_name','operation_status']))}`;
    const campResp = await fetch(campUrl, { headers: { 'Access-Token': token } });
    const campJson = await campResp.json();
    ((campJson.data && campJson.data.list) || []).forEach((c) => {
      statusMap[c.campaign_name] = /ENABLE/i.test(c.operation_status) ? 'ativo' : 'pausado';
    });
  } catch (e) { /* segue sem status detalhado */ }

  try {
    const reportUrl = 'https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/'
      + `?advertiser_id=${advertiserId}`
      + `&report_type=BASIC&data_level=AUCTION_CAMPAIGN`
      + `&dimensions=${encodeURIComponent(JSON.stringify(['campaign_id','stat_time_day']))}`
      + `&metrics=${encodeURIComponent(JSON.stringify(['campaign_name','spend','impressions','clicks','conversion']))}`
      + `&start_date=${since}&end_date=${until}&page_size=1000`;

    const resp = await fetch(reportUrl, { headers: { 'Access-Token': token } });
    const json = await resp.json();
    if (json.code !== 0) {
      return { statusCode: 502, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Erro da API do TikTok: ' + (json.message || 'falha desconhecida') }) };
    }

    const rows = ((json.data && json.data.list) || []).map((r) => {
      const m = r.metrics || {};
      const d = r.dimensions || {};
      const campaignName = m.campaign_name || d.campaign_id;
      return {
        campanha: campaignName,
        conjunto: '—',
        anuncio: '—',
        status: statusMap[campaignName] || 'ativo',
        data: d.stat_time_day ? String(d.stat_time_day).slice(0, 10) : since,
        gasto: Number(m.spend || 0),
        receita: 0, // a receita real vem do webhook de pagamento
        vendas: Number(m.conversion || 0),
        cliques: Number(m.clicks || 0),
        impressoes: Number(m.impressions || 0)
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(rows)
    };
  } catch (e) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Falha ao consultar o TikTok Ads: ' + e.message }) };
  }
};

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
