# AURUM TRACK

Painel de campanhas (roxo e preto) com fontes de dados reais conectadas:
- **Meta Ads (Facebook)**, **Google Ads** e **TikTok Ads** — gasto, cliques, impressões e status
- **Vendas reais** via webhook da sua plataforma de pagamento (Hotmart, Kiwify, Eduzz, PerfectPay, Stripe ou outra)

Sem configurar nada, o painel abre com dados de demonstração. Ele só passa a
mostrar dados reais depois que você publicar certo (veja abaixo) e conectar
pelo menos uma fonte em **Integrações**.

## ⚠️ Antes de tudo: como publicar CERTO no Netlify

Isso é o que resolve o erro "Não consegui falar com as funções da Netlify".

Este projeto tem funções de servidor (pasta `netlify/functions`) que dependem
de um pacote (`@netlify/blobs`) para guardar seus tokens e vendas. Esse
pacote só é baixado automaticamente se o Netlify **rodar `npm install`** no
deploy — e isso só acontece nos métodos abaixo:

**✅ Opção recomendada — GitHub + Netlify (roda `npm install` sozinho):**
1. Crie um repositório no GitHub e suba esta pasta inteira nele
2. No Netlify: **Add new site → Import an existing project** → conecte o repositório
3. Deixe o "Build command" em branco e "Publish directory" como `.`
4. Pronto — a cada alteração que você subir no GitHub, o Netlify republica sozinho

**✅ Alternativa — Netlify CLI (se tiver Node.js instalado no computador):**
```
npm install -g netlify-cli
cd aurum-track
npm install
netlify deploy --prod
```

**❌ O que NÃO funciona bem:** arrastar a pasta direto em app.netlify.com/drop
sem antes rodar `npm install` localmente. Esse método de "deploy manual" não
instala dependências, então as funções quebram (é exatamente o que aconteceu
no seu caso — o site com nome tipo `cute-llama-xxxx.netlify.app` é sinal de
deploy manual). Se quiser insistir nesse método, rode `npm install` na pasta
do projeto ANTES de arrastar, e arraste a pasta inteira incluindo a pasta
`node_modules` que for criada — mas o método com GitHub é bem mais confiável.

## 1. Conectar as fontes de anúncio pela própria tela do painel

Depois de publicado certo, abra o site e vá em **Integrações** na barra
lateral. Lá tem um cartão pra cada plataforma — clique no cabeçalho do
cartão pra abrir os campos:

### Meta Ads (Facebook)
- **Access Token**: Business Manager → Configurações do negócio → Usuários
  do sistema → gerar token com permissão `ads_read`
- **ID da conta de anúncios**: Configurações do negócio → Contas de
  anúncios (o número, sem o prefixo `act_`)

### Google Ads
- **Developer Token**: Google Ads → Ferramentas e configurações → API Center
  (precisa de aprovação da Google; para testes, o nível "Test account" já
  funciona com contas de teste)
- **Customer ID**: o número da conta, com ou sem traços
- **OAuth Client ID / Client Secret**: criados no Google Cloud Console →
  APIs e serviços → Credenciais → OAuth 2.0 Client ID (tipo "Desktop app")
- **Refresh Token**: gerado uma vez rodando o fluxo OAuth2 do Google (o
  Google tem um script de exemplo em `google-ads-api` para gerar isso; se
  precisar de ajuda com esse passo específico, me chama que eu te ajudo)
- Por enquanto essa fonte entra só no nível de **campanha** (não abre por
  conjunto/anúncio do Google ainda)

### TikTok Ads
- **Access Token**: TikTok Ads Manager → Ferramentas → Business API (ou
  business-api.tiktok.com), gerado para o seu Advertiser ID
- **Advertiser ID**: o ID da conta de anúncios do TikTok
- Também entra só no nível de **campanha** por enquanto

Não precisa mexer em variáveis de ambiente do Netlify para nada disso — os
dados ficam guardados com segurança no servidor (Netlify Blobs), nunca no
navegador. As variáveis de ambiente continuam existindo como alternativa
avançada, se preferir gerenciar por lá (útil pra times que usam CI):

| Variável | Fonte |
|---|---|
| `WEBHOOK_TOKEN` | Fixa o token do webhook em vez do gerado automaticamente |
| `FB_ACCESS_TOKEN` / `FB_AD_ACCOUNT_ID` | Meta Ads |
| `GOOGLE_ADS_DEVELOPER_TOKEN` / `GOOGLE_ADS_CUSTOMER_ID` / `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` / `GOOGLE_ADS_REFRESH_TOKEN` | Google Ads |
| `TIKTOK_ACCESS_TOKEN` / `TIKTOK_ADVERTISER_ID` | TikTok Ads |
| `HOTMART_HOTTOK` | Verificação extra opcional para Hotmart |
| `STRIPE_WEBHOOK_SECRET` | Verificação oficial opcional para Stripe |

Se preencher por variável de ambiente, sempre faça um novo deploy depois
(**Deploys → Trigger deploy**).

## 2. Cadastrar o webhook na sua plataforma de pagamento

A URL certa (já com o token) aparece pronta em **Integrações → Webhook de
vendas** — use o botão "Copiar". Formato:

```
https://SEU-SITE.netlify.app/api/webhook?token=SEU_TOKEN
```

Cole essa URL nas configurações de webhook da sua plataforma:
- **Hotmart:** Ferramentas → Webhook → cadastrar URL, marcar "Todos" os eventos (ou pelo menos compra aprovada/reembolso)
- **Kiwify:** Configurações → Webhooks → nova integração
- **Eduzz / PerfectPay:** área de integrações/webhooks do produto
- **Stripe:** Developers → Webhooks → Add endpoint, evento `checkout.session.completed`

O `webhook.js` detecta sozinho qual plataforma está chamando. Hotmart e
Stripe têm payload bem documentado (mapeamento preciso); Kiwify, Eduzz e
PerfectPay variam mais, então uso um leitor genérico que procura os campos
mais comuns em qualquer lugar do JSON. Se algum valor não vier certo, o
payload original fica salvo (campo `raw`, visível na aba **Vendas** do
painel) — me manda um exemplo real que eu ajusto o mapeamento.

## 3. Atribuição de vendas às campanhas

Para o painel saber **qual campanha gerou qual venda**, a venda precisa
chegar com um `utm_campaign` (ou o parâmetro `sck` da Hotmart) contendo o
nome da campanha (de qualquer uma das plataformas conectadas). Configure o
link do seu anúncio/checkout para levar esse parâmetro. Vendas sem esse
dado aparecem agrupadas em "Vendas não atribuídas" — nada se perde, só não
sabe de qual campanha veio.

## 4. Usar o painel

Abra `https://SEU-SITE.netlify.app`. Ele tenta sincronizar sozinho ao abrir
(busca todas as fontes conectadas de uma vez); o botão **"Atualizar"** força
uma nova busca a qualquer momento. Se nenhuma função responder, o painel
cai automaticamente para dados de demonstração — nada quebra.

## Estrutura do projeto

```
index.html                          → o painel (front-end)
netlify.toml                        → configuração do Netlify e atalhos /api/*
package.json                        → dependência do Netlify Blobs
netlify/functions/webhook.js        → recebe as vendas da plataforma de pagamento
netlify/functions/sales.js          → devolve as vendas salvas para o painel
netlify/functions/settings.js       → guarda as credenciais preenchidas em Integrações
netlify/functions/fb-insights.js    → busca dados de campanha do Facebook
netlify/functions/google-insights.js→ busca dados de campanha do Google Ads
netlify/functions/tiktok-insights.js→ busca dados de campanha do TikTok Ads
```
