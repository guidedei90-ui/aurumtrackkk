// netlify/functions/webhook.js
//
// Recebe o webhook de vendas da sua plataforma de pagamento (Hotmart, Kiwify,
// Eduzz, PerfectPay, Stripe ou outra) e guarda a venda no Netlify Blobs para
// o painel ler depois em /api/sales.
//
// URL do webhook a cadastrar na plataforma de pagamento:
//   https://SEU-SITE.netlify.app/api/webhook?token=SEU_TOKEN_SECRETO
//
// O "?token=" é a proteção universal: configure a variável de ambiente
// WEBHOOK_TOKEN no Netlify com um valor secreto e use o MESMO valor na URL
// cadastrada na plataforma de pagamento. Sem isso, qualquer pessoa que
// descobrir a URL poderia mandar "vendas falsas" para o seu painel.
//
// Extras opcionais (mais seguros ainda, mas não obrigatórios):
//   HOTMART_HOTTOK          -> confere o header X-Hotmart-Hottok da Hotmart
//   STRIPE_WEBHOOK_SECRET   -> confere a assinatura oficial da Stripe
//
// Hotmart e Stripe têm formato de payload bem documentado, então são lidos
// com mapeamento específico. Kiwify, Eduzz e PerfectPay variam mais e têm
// menos documentação pública estável, então usamos um leitor genérico que
// procura, em qualquer lugar do JSON, os campos mais comuns (status, valor,
// utm_campaign, etc). Se algum campo não vier automaticamente pro seu caso,
// o payload bruto fica salvo (campo "raw") e dá pra ajustar o mapeamento —
// veja o README.

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

function deepFind(obj, keyPatterns, seen) {
  seen = seen || new Set();
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return undefined;
  seen.add(obj);
  for (const k of Object.keys(obj)) {
    if (keyPatterns.includes(k.toLowerCase())) {
      const v = obj[k];
      if (v !== null && v !== undefined && typeof v !== 'object') return v;
    }
  }
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object') {
      const found = deepFind(v, keyPatterns, seen);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function detectPlatform(headersLower, body) {
  if (headersLower['x-hotmart-hottok'] || (body && body.data && body.data.purchase)) return 'hotmart';
  if (headersLower['stripe-signature']) return 'stripe';
  if (body && (body.TrackingParameters || body.order_status || (body.Product && body.Customer))) return 'kiwify';
  if (body && (body.trans_status || (body.event && String(body.event).toLowerCase().includes('eduzz')))) return 'eduzz';
  if (body && (body.sale_status_enum || body.sale_amount !== undefined)) return 'perfectpay';
  return 'generic';
}

function parseHotmart(body) {
  const d = body.data || {};
  const purchase = d.purchase || {};
  const rawStatus = String(purchase.status || body.event || '').toUpperCase();
  const approved = /APPROVED|COMPLETE/.test(rawStatus);
  const price = (purchase.price && purchase.price.value) ?? (purchase.full_price && purchase.full_price.value) ?? 0;
  const origin = purchase.origin || {};
  return {
    platform: 'hotmart',
    external_id: purchase.transaction || body.id || null,
    status: approved ? 'aprovado' : rawStatus.toLowerCase(),
    valor: Number(price) || 0,
    moeda: (purchase.price && purchase.price.currency_value) || 'BRL',
    produto: (d.product && d.product.name) || null,
    utm_campaign: origin.sck || origin.src || origin.xcod || null,
    utm_source: origin.src || null,
    data_venda: purchase.approved_date ? new Date(purchase.approved_date).toISOString()
              : purchase.order_date ? new Date(purchase.order_date).toISOString()
              : new Date().toISOString()
  };
}

function parseStripe(body) {
  const obj = (body.data && body.data.object) || {};
  const type = body.type || '';
  const approved = /completed|succeeded|paid/.test(type);
  const amountRaw = obj.amount_total ?? obj.amount ?? obj.amount_received ?? 0;
  const md = obj.metadata || {};
  return {
    platform: 'stripe',
    external_id: obj.id || body.id || null,
    status: approved ? 'aprovado' : type,
    valor: Number(amountRaw) / 100,
    moeda: (obj.currency || 'brl').toUpperCase(),
    produto: md.product_name || null,
    utm_campaign: md.utm_campaign || null,
    utm_source: md.utm_source || null,
    data_venda: new Date((body.created || Date.now() / 1000) * 1000).toISOString()
  };
}

function parseGeneric(body, platform) {
  const statusRaw = String(deepFind(body, ['status','order_status','sale_status','sale_status_enum','trans_status','payment_status','webhook_event_type']) || '').toLowerCase();
  const approved = /paid|approved|aprovad|complet|success|pago/.test(statusRaw);
  const valorFound = deepFind(body, ['valor','amount','charge_amount','sale_amount','trans_value','total','price','value','net_amount','amount_total']);
  const valor = Number(valorFound);
  const dateRaw = deepFind(body, ['created_at','date','order_date','data_venda','trans_createdate']);
  return {
    platform,
    external_id: deepFind(body, ['order_id','order_ref','transaction','trans_cod','sale_id','id']) || null,
    status: approved ? 'aprovado' : (statusRaw || 'desconhecido'),
    valor: isNaN(valor) ? 0 : valor,
    moeda: 'BRL',
    produto: deepFind(body, ['product_name','produto','nome_produto','prod_name']) || null,
    utm_campaign: deepFind(body, ['utm_campaign','utm_campaing','campaign','sck']) || null,
    utm_source: deepFind(body, ['utm_source','src']) || null,
    data_venda: dateRaw ? new Date(dateRaw).toISOString() : new Date().toISOString()
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const qp = event.queryStringParameters || {};
  const headersLower = {};
  Object.keys(event.headers || {}).forEach((k) => { headersLower[k.toLowerCase()] = event.headers[k]; });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: 'JSON inválido' };
  }

  const platform = detectPlatform(headersLower, body);

  // Proteção universal por token na URL — recomendada para todas as plataformas.
  // O token é o mesmo mostrado na tela de Integrações do painel (gerado
  // automaticamente na primeira vez, ou definido via WEBHOOK_TOKEN).
  let requiredToken = process.env.WEBHOOK_TOKEN;
  if (!requiredToken) {
    try {
      const settingsStore = getStore('aurum-track-settings');
      requiredToken = await settingsStore.get('webhookToken', { type: 'text' });
    } catch (e) { /* se não achar nenhum token configurado, segue sem exigir */ }
  }
  if (requiredToken && qp.token !== requiredToken) {
    return { statusCode: 401, body: 'Token inválido ou ausente' };
  }

  // Verificação extra opcional da Hotmart.
  if (platform === 'hotmart' && process.env.HOTMART_HOTTOK) {
    if (headersLower['x-hotmart-hottok'] !== process.env.HOTMART_HOTTOK) {
      return { statusCode: 401, body: 'Hottok inválido' };
    }
  }

  // Verificação extra opcional da Stripe (assinatura HMAC oficial).
  if (platform === 'stripe' && process.env.STRIPE_WEBHOOK_SECRET) {
    const sig = headersLower['stripe-signature'];
    let ok = false;
    try {
      const parts = {};
      sig.split(',').forEach((p) => { const kv = p.split('='); parts[kv[0]] = kv[1]; });
      const signedPayload = parts.t + '.' + event.body;
      const expected = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(signedPayload, 'utf8').digest('hex');
      ok = expected === parts.v1;
    } catch (e) { ok = false; }
    if (!ok) return { statusCode: 401, body: 'Assinatura Stripe inválida' };
  }

  let sale;
  if (platform === 'hotmart') sale = parseHotmart(body);
  else if (platform === 'stripe') sale = parseStripe(body);
  else sale = parseGeneric(body, platform);

  sale.recebido_em = new Date().toISOString();
  sale.raw = body;

  try {
    const store = getStore('aurum-track-sales');
    const key = 'sale:' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
    await store.set(key, JSON.stringify(sale));
  } catch (e) {
    return { statusCode: 500, body: 'Erro ao salvar a venda: ' + e.message };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, platform, status: sale.status })
  };
};
