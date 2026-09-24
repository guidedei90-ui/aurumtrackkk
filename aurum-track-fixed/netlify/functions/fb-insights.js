// netlify/functions/fb-insights.js
//
// Busca o desempenho das campanhas direto na Marketing API do Facebook,
// usando um token guardado como variável de ambiente no Netlify — ele NUNCA
// fica exposto no navegador, ao contrário de colocar o token direto no HTML.
//
// Variáveis de ambiente necessárias (Netlify > Site settings > Environment variables):
//   FB_ACCESS_TOKEN   -> token de acesso com permissão ads_read (de preferência
//                        um token de longa duração de um System User do Business Manager)
//   FB_AD_ACCOUNT_ID  -> o ID da sua conta de anúncios, SEM o prefixo "act_"
//
// O painel chama isso em /api/insights?since=AAAA-MM-DD&until=AAAA-MM-DD

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  let token = process.env.FB_ACCESS_TOKEN;
  let accountId = process.env.FB_AD_ACCOUNT_ID;

  // Prioriza o que foi salvo pela tela de Integrações do painel.
  try {
    const store = getStore('aurum-track-settings');
    const saved = await store.get('facebook', { type: 'json' });
    if (saved && saved.token) token = saved.token;
    if (saved && saved.accountId) accountId = saved.accountId;
  } catch (e) { /* segue com env vars, se existirem */ }

  if (!token || !accountId) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Facebook ainda não conectado. Configure em Integrações no painel, ou defina FB_ACCESS_TOKEN e FB_AD_ACCOUNT_ID nas variáveis de ambiente da Netlify.' })
    };
  }

  const qp = event.queryStringParameters || {};
  const since = qp.since || isoDaysAgo(30);
  const until = qp.until || isoDaysAgo(0);

  // 1) Status das campanhas (ativo/pausado), para exibir corretamente no painel.
  const statusMap = {};
  try {
    const stUrl = `https://graph.facebook.com/v21.0/act_${accountId}/campaigns?fields=name,effective_status&limit=500&access_token=${token}`;
    const stResp = await fetch(stUrl);
    const stJson = await stResp.json();
    (stJson.data || []).forEach((c) => {
      statusMap[c.name] = /ACTIVE/i.test(c.effective_status) ? 'ativo' : 'pausado';
    });
  } catch (e) {
    // segue sem status detalhado — não é crítico
  }

  // 2) Métricas por anúncio, por dia (assim o painel consegue agrupar em
  //    campanha / conjunto de anúncios / anúncio e filtrar por qualquer período).
  const fields = 'campaign_name,adset_name,ad_name,spend,impressions,clicks,actions';
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  let url = `https://graph.facebook.com/v21.0/act_${accountId}/insights`
    + `?level=ad&fields=${fields}&time_range=${timeRange}&time_increment=1&limit=500&access_token=${token}`;

  const rows = [];
  try {
    let guard = 0;
    while (url && guard < 20) {
      guard++;
      const resp = await fetch(url);
      const json = await resp.json();
      if (json.error) {
        return {
          statusCode: 502,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Erro da API do Facebook: ' + json.error.message })
        };
      }
      (json.data || []).forEach((row) => {
        let purchases = 0;
        (row.actions || []).forEach((a) => {
          if (/purchase/.test(a.action_type)) purchases += Number(a.value) || 0;
        });
        rows.push({
          campanha: row.campaign_name,
          conjunto: row.adset_name,
          anuncio: row.ad_name,
          status: statusMap[row.campaign_name] || 'ativo',
          data: row.date_start,
          gasto: Number(row.spend) || 0,
          // A "receita" real vem das vendas confirmadas pelo webhook de pagamento
          // (mais confiável que o valor de conversão estimado pelo Facebook).
          // Aqui deixamos o número de compras que o próprio Facebook atribuiu,
          // só como referência de comparação.
          receita: 0,
          vendas: purchases,
          cliques: Number(row.clicks) || 0,
          impressoes: Number(row.impressions) || 0
        });
      });
      url = json.paging && json.paging.next ? json.paging.next : null;
    }
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Falha ao consultar o Facebook: ' + e.message })
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(rows)
  };
};

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
