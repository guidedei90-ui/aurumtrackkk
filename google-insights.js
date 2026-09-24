// netlify/functions/google-insights.js
//
// Busca gasto/cliques/impressões por campanha, por dia, na Google Ads API.
// Por enquanto só no nível de campanha (Google estrutura em Campanha > Grupo
// de anúncios > Anúncio; dá pra aprofundar depois se for útil pra você).
//
// Credenciais podem vir da tela de Integrações (salvas no Netlify Blobs) ou,
// como alternativa avançada, das variáveis de ambiente:
//   GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID,
//   GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN

const { getStore } = require('@netlify/blobs');

const API_VERSION = 'v17';

async function getAccessToken(clientId, clientSecret, refreshToken) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error_description || json.error || 'Falha ao renovar o token OAuth do Google');
  return json.access_token;
}

exports.handler = async (event) => {
  let cfg = {
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    customerId: process.env.GOOGLE_ADS_CUSTOMER_ID,
    clientId: process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN
  };

  try {
    const store = getStore('aurum-track-settings');
    const saved = await store.get('google', { type: 'json' });
    if (saved) {
      cfg = {
        developerToken: saved.developerToken || cfg.developerToken,
        customerId: saved.customerId || cfg.customerId,
        clientId: saved.clientId || cfg.clientId,
        clientSecret: saved.clientSecret || cfg.clientSecret,
        refreshToken: saved.refreshToken || cfg.refreshToken
      };
    }
  } catch (e) { /* segue só com env vars, se existirem */ }

  const missing = ['developerToken','customerId','clientId','clientSecret','refreshToken'].filter((k) => !cfg[k]);
  if (missing.length) {
    // Google Ads não conectado ainda — devolve lista vazia (não é erro fatal,
    // já que o painel funciona com as fontes que estiverem configuradas).
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([]) };
  }

  const qp = event.queryStringParameters || {};
  const since = qp.since || isoDaysAgo(30);
  const until = qp.until || isoDaysAgo(0);
  const customerId = String(cfg.customerId).replace(/-/g, '');

  try {
    const accessToken = await getAccessToken(cfg.clientId, cfg.clientSecret, cfg.refreshToken);

    const query = `
      SELECT campaign.name, campaign.status, segments.date,
             metrics.cost_micros, metrics.clicks, metrics.impressions,
             metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${since}' AND '${until}'
    `;

    const resp = await fetch(`https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': cfg.developerToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, pageSize: 1000 })
    });
    const json = await resp.json();
    if (!resp.ok) {
      const msg = (json.error && json.error.message) || JSON.stringify(json).slice(0, 300);
      return { statusCode: 502, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Erro da API do Google Ads: ' + msg }) };
    }

    const rows = (json.results || []).map((r) => ({
      campanha: r.campaign.name,
      conjunto: '—',
      anuncio: '—',
      status: /ENABLED/i.test(r.campaign.status) ? 'ativo' : 'pausado',
      data: r.segments.date,
      gasto: Number(r.metrics.costMicros || 0) / 1e6,
      receita: 0, // a receita real vem do webhook de pagamento
      vendas: Number(r.metrics.conversions || 0),
      cliques: Number(r.metrics.clicks || 0),
      impressoes: Number(r.metrics.impressions || 0)
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(rows)
    };
  } catch (e) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Falha ao consultar o Google Ads: ' + e.message }) };
  }
};

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
