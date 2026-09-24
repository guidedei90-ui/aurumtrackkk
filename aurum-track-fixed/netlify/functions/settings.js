// netlify/functions/settings.js
//
// Guarda, no Netlify Blobs, o que a pessoa preenche na tela "Integrações" do
// painel: credenciais de Meta, Google e TikTok Ads, e o token secreto usado
// para proteger a URL do webhook. Assim dá pra conectar tudo pela própria
// interface, sem precisar mexer em variáveis de ambiente.
//
// GET  /api/settings  -> devolve o estado atual (segredos nunca voltam pro
//                         navegador, só se cada fonte está conectada ou não)
// POST /api/settings  -> salva { facebook: {...} } ou { google: {...} } ou { tiktok: {...} }

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

function randomToken() {
  return crypto.randomBytes(9).toString('base64url');
}

exports.handler = async (event) => {
  const store = getStore('aurum-track-settings');

  if (event.httpMethod === 'GET') {
    let webhookToken = process.env.WEBHOOK_TOKEN;
    try {
      if (!webhookToken) {
        const saved = await store.get('webhookToken', { type: 'text' });
        if (saved) {
          webhookToken = saved;
        } else {
          webhookToken = randomToken();
          await store.set('webhookToken', webhookToken);
        }
      }
    } catch (e) { /* segue sem token persistido, ainda funciona no request atual */ }

    let facebook = null;
    try {
      const fb = await store.get('facebook', { type: 'json' });
      if (fb && fb.accountId) facebook = { connected: true, accountId: fb.accountId };
    } catch (e) { /* nada salvo ainda */ }
    if (!facebook && process.env.FB_ACCESS_TOKEN && process.env.FB_AD_ACCOUNT_ID) {
      facebook = { connected: true, accountId: process.env.FB_AD_ACCOUNT_ID };
    }

    let google = null;
    try {
      const g = await store.get('google', { type: 'json' });
      if (g && g.customerId && g.refreshToken) {
        google = { connected: true, customerId: g.customerId, clientId: g.clientId || '' };
      }
    } catch (e) { /* nada salvo ainda */ }
    if (!google && process.env.GOOGLE_ADS_CUSTOMER_ID && process.env.GOOGLE_ADS_REFRESH_TOKEN) {
      google = { connected: true, customerId: process.env.GOOGLE_ADS_CUSTOMER_ID, clientId: process.env.GOOGLE_ADS_CLIENT_ID || '' };
    }

    let tiktok = null;
    try {
      const t = await store.get('tiktok', { type: 'json' });
      if (t && t.advertiserId && t.token) tiktok = { connected: true, advertiserId: t.advertiserId };
    } catch (e) { /* nada salvo ainda */ }
    if (!tiktok && process.env.TIKTOK_ACCESS_TOKEN && process.env.TIKTOK_ADVERTISER_ID) {
      tiktok = { connected: true, advertiserId: process.env.TIKTOK_ADVERTISER_ID };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookToken, facebook, google, tiktok })
    };
  }

  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (e) {
      return { statusCode: 400, body: 'JSON inválido' };
    }

    try {
      if (body.facebook) {
        const existing = (await store.get('facebook', { type: 'json' }).catch(() => null)) || {};
        const next = {
          accountId: body.facebook.accountId || existing.accountId || '',
          token: body.facebook.token || existing.token || ''
        };
        if (!next.token) return { statusCode: 400, body: 'Faltou o access token do Facebook.' };
        await store.set('facebook', JSON.stringify(next));
      }

      if (body.google) {
        const existing = (await store.get('google', { type: 'json' }).catch(() => null)) || {};
        const next = {
          customerId: body.google.customerId || existing.customerId || '',
          developerToken: body.google.developerToken || existing.developerToken || '',
          clientId: body.google.clientId || existing.clientId || '',
          clientSecret: body.google.clientSecret || existing.clientSecret || '',
          refreshToken: body.google.refreshToken || existing.refreshToken || ''
        };
        if (!next.developerToken || !next.clientId || !next.clientSecret || !next.refreshToken) {
          return { statusCode: 400, body: 'Faltou preencher alguma credencial do Google Ads (developer token, client id/secret ou refresh token).' };
        }
        await store.set('google', JSON.stringify(next));
      }

      if (body.tiktok) {
        const existing = (await store.get('tiktok', { type: 'json' }).catch(() => null)) || {};
        const next = {
          advertiserId: body.tiktok.advertiserId || existing.advertiserId || '',
          token: body.tiktok.token || existing.token || ''
        };
        if (!next.token) return { statusCode: 400, body: 'Faltou o access token do TikTok.' };
        await store.set('tiktok', JSON.stringify(next));
      }

      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
    } catch (e) {
      return { statusCode: 500, body: 'Erro ao salvar: ' + e.message };
    }
  }

  return { statusCode: 405, body: 'Method not allowed' };
};
