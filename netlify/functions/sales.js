// netlify/functions/sales.js
//
// Devolve, em JSON, as vendas que o webhook.js já salvou no Netlify Blobs.
// O painel (index.html) chama isso automaticamente em /api/sales.

const { getStore } = require('@netlify/blobs');

exports.handler = async () => {
  try {
    const store = getStore('aurum-track-sales');
    const listing = await store.list({ prefix: 'sale:' });
    const blobs = (listing.blobs || []).sort((a, b) => (a.key < b.key ? 1 : -1));
    const limited = blobs.slice(0, 1000); // últimas 1000 vendas é mais que suficiente para o painel

    const sales = [];
    for (const b of limited) {
      const raw = await store.get(b.key, { type: 'json' });
      if (raw) sales.push(raw);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(sales)
    };
  } catch (e) {
    return { statusCode: 500, body: 'Erro ao ler vendas: ' + e.message };
  }
};
