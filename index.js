import express from "express";
import axios from "axios";
import { pool } from "./db.js";
import REGRAS from "./regras.js";
import { randomUUID } from "crypto";
import { loadTokens, saveTokens } from "./tokenStore.js";
import { enviarWhatsAppTeste, enviarWhatsAppConfirmacaoComBotoes } from "./notificacoes/whatsapp.js";
const app = express();
app.use(express.json());

/* ================= Envio Mensagem
app.get("/teste-whatsapp", async (req, res) => {
  try {
    // Coloque SEU número pessoal (somente números, com DDI)
    const telefone = "5516993105050";

    const mensagem =
      "📦 Teste WhatsApp Cloud API\n\nSe você recebeu isso, a integração está funcionando ✅";

    await enviarWhatsAppTeste(telefone, mensagem);

    res.json({ status: "ok", mensagem: "WhatsApp enviado" });
  } catch (e) {
    console.error("❌ Erro WhatsApp:", e.response?.data || e.message);
    res.status(500).json({ error: "Erro ao enviar WhatsApp" });
  }
});
 ================= */

/* ================= OAUTH ================= */
let ACCESS_TOKEN = process.env.ACCESS_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;
let ultimoRefreshToken = 0;
let ultimoRefreshStatus = "unknown";
let refreshEmAndamento = false;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const stored = loadTokens();
if (stored) {
  ACCESS_TOKEN = stored.access_token;
  REFRESH_TOKEN = stored.refresh_token;
  console.log("🔐 Tokens restaurados do storage");
}
// Após carregar tokens persistidos
if (REFRESH_TOKEN) {
  console.log("🔁 Executando refresh inicial no startup");
  renovarToken();
}



/* ================= CONFIG ================= */
const WEBHOOK_ATIVO = true;



/* ================= UTIL ================= */
const delay = ms => new Promise(r => setTimeout(r, ms));

const getHeaders = () => ({
  Authorization: `Bearer ${ACCESS_TOKEN}`,
  Accept: "application/json"
});

/* ================= FILA BLING ================= */
const filaBling = [];
let processandoFila = false;

async function executarNaFilaBling(fn) {
  return new Promise((resolve, reject) => {
    filaBling.push({ fn, resolve, reject });
    processarFila();
  });
}

async function processarFila() {
  if (processandoFila || filaBling.length === 0) return;

  processandoFila = true;
  const { fn, resolve, reject } = filaBling.shift();

  try {
    const r = await fn();
    resolve(r);
  } catch (e) {
    reject(e);
  } finally {
    await delay(400); // limite Bling
    processandoFila = false;
    processarFila();
  }
}

/* ================= TOKEN (REATIVO + ESTADO + PERSISTÊNCIA) ================= */

async function renovarToken() {
  if (refreshEmAndamento) return;
  refreshEmAndamento = true;

  try {
    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", REFRESH_TOKEN);
    params.append("client_id", CLIENT_ID);
    params.append("client_secret", CLIENT_SECRET);

    const r = await axios.post(
      "https://developer.bling.com.br/api/bling/oauth/token",
      params,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    // ✅ 1️⃣ Atualiza os tokens em memória
    ACCESS_TOKEN = r.data.access_token;
    REFRESH_TOKEN = r.data.refresh_token;

    // ✅ 2️⃣ PERSISTE OS TOKENS (PONTO CRÍTICO)
    saveTokens({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN
    });

    // ✅ 3️⃣ Atualiza estado do OAuth (health / monitor)
    ultimoRefreshToken = Date.now();
    ultimoRefreshStatus = "ok";

    console.log("🔁 Token renovado automaticamente");

  } catch (e) {
    ultimoRefreshStatus = "error";
    console.error(
      "❌ Falha ao renovar token:",
      e.response?.data || e.message
    );
  } finally {
    refreshEmAndamento = false;
  }
}

/* ================= SafeRequest ================= */
async function safeRequest(fn, retry = false) {
  try {
    return await fn();
  } catch (err) {
    if (err.response) {
      const { status, data, config } = err.response;
      console.error("❌ Erro Bling", status, config?.method, config?.url);
      if (config?.data) console.error("➡️ Payload:", config.data);
      if (data) console.error("➡️ Resposta:", JSON.stringify(data, null, 2));

      if (status === 401 && !retry) {
        await renovarToken();
        return safeRequest(fn, true);
      }
    }
    throw err;
  }
}

/* ================= ESTOQUE ================= */
async function consultarSaldoProdutoNoDeposito(idProduto, idDeposito) {
  const r = await executarNaFilaBling(() =>
    safeRequest(() =>
      axios.get(
        `https://api.bling.com.br/Api/v3/estoques/saldos/${idDeposito}`,
        {
          headers: getHeaders(),
          params: { "idsProdutos[]": idProduto }
        }
      )
    )
  );

  const itens = r.data?.data || [];
  return itens.length
    ? itens[0].saldoFisicoTotal ?? itens[0].saldo ?? 0
    : 0;
}

async function pedidoTemSaldoCompletoNoDeposito(pedido, idDeposito) {
  for (const item of pedido.itens) {
    const saldo = await consultarSaldoProdutoNoDeposito(
      item.produto.id,
      idDeposito
    );
    if (saldo < item.quantidade) return false;
  }
  return true;
}

/* ================= LANÇAR ESTOQUE ================= */
async function lancarEstoquePedido(pedidoId, idDeposito) {
  const url = `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedidoId}/lancar-estoque/${idDeposito}`;
  console.log(`📦 Lançando estoque do pedido ${pedidoId} no depósito ${idDeposito}`);

  await executarNaFilaBling(() =>
    safeRequest(() =>
      axios.post(url, null, { headers: getHeaders() })
    )
  );

  console.log("✅ Estoque lançado com sucesso");
}

/* ================= MOTOR DE REGRAS ================= */
function encontrarRegraUnificada(pedido) {
  return REGRAS.find(r =>
    r.lojaId === pedido.loja.id &&
    r.statusOrigem === pedido.situacao.id &&
    (
      // 👇 se a regra NÃO tiver condicaoUnidade, passa direto
      !r.condicaoUnidade ||

      // 👇 se tiver, compara com a unidade REAL do pedido
      r.condicaoUnidade === pedido.loja.unidadeNegocio?.id
    )
  );
}

async function processarRegraPorEstoque(pedido, regra) {
  console.log(`🧠 Avaliando regra por estoque: ${regra.nome}`);

  for (const prioridade of regra.prioridades) {
    const temSaldo = await pedidoTemSaldoCompletoNoDeposito(
      pedido,
      prioridade.depositoId
    );

    console.log(`📦 ${prioridade.nome} → saldo ok: ${temSaldo}`);

    if (temSaldo) {
      if (prioridade.lancarEstoque) {
        await lancarEstoquePedido(pedido.id, prioridade.depositoId);
      }

      await alterarStatusPedido(pedido, prioridade.statusDestino);
      console.log("✅ Regra aplicada com sucesso");
      return;
    }
  }

  console.log("⚠️ Nenhuma prioridade com saldo — ação manual");
}

/* ================= STATUS ================= */
async function alterarStatusPedido(pedido, statusDestino) {
  const url = `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedido.id}/situacoes/${statusDestino}`;
  console.log(`🚦 Alterando status do pedido ${pedido.numero} → ${statusDestino}`);

  const r = await executarNaFilaBling(() =>
    safeRequest(() =>
      axios.patch(url, null, { headers: getHeaders() })
    )
  );

  console.log(`✅ Status alterado | HTTP ${r.status}`);
}

/* ================= PROCESSO ================= */
async function processarPedidoPorId(id) {
  const r = await executarNaFilaBling(() =>
    safeRequest(() =>
      axios.get(
        `https://api.bling.com.br/Api/v3/pedidos/vendas/${id}`,
        { headers: getHeaders() }
      )
    )
  );

  const pedido = r.data.data;

  // ✅ PRIMEIRO: tentar confirmação (funciona no webhook do 462097)
  await registrarPedidoConfirmacao(pedido);

  // ✅ DEPOIS: aplicar regra (funciona no webhook do status 6)
  const regra = encontrarRegraUnificada(pedido);
  if (!regra) return;

  if (regra.tipo === "SIMPLES") {
    await alterarStatusPedido(pedido, regra.statusDestino);
    return;
  }

  if (regra.tipo === "ESTOQUE") {
    await processarRegraPorEstoque(pedido, regra);
    return;
  }
  console.log(`📦 Pedido ${pedido.numero} | Status ${pedido.situacao.id}`);
}

/* ================= DEBUG PEDIDO ================= */
app.get("/debug-pedido/:numero", async (req, res) => {
  try {
    const numero = req.params.numero;
    const busca = await executarNaFilaBling(() =>
      safeRequest(() =>
        axios.get(
          `https://api.bling.com.br/Api/v3/pedidos/vendas?numero=${numero}`,
          { headers: getHeaders() }
        )
      )
    );

    if (!busca.data.data?.length) {
      return res.status(404).json({ erro: "Pedido não encontrado" });
    }

    const idPedido = busca.data.data[0].id;

    const detalhe = await executarNaFilaBling(() =>
      safeRequest(() =>
        axios.get(
          `https://api.bling.com.br/Api/v3/pedidos/vendas/${idPedido}`,
          { headers: getHeaders() }
        )
      )
    );

    res.json(detalhe.data.data);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

/* ================= WEBHOOK BLING ================= */
app.post("/webhook", async (req, res) => {
  if (!WEBHOOK_ATIVO) return res.status(200).send("Webhook desligado");

  try {
    const idPedido = req.body?.data?.id;
    if (idPedido) {
      console.log("🔔 Webhook recebido");
      await processarPedidoPorId(idPedido);
    }
  } catch (e) {
    console.error("❌ Erro no webhook:", e.message);
  }

  res.status(200).send("OK");
});

/* ================= WEBHOOK WHATSAPP ================= */
app.post("/webhook/whatsapp", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    if (message.type !== "interactive") return res.sendStatus(200);

    const buttonId = message.interactive?.button_reply?.id;
    if (!buttonId) return res.sendStatus(200);

    console.log("📲 Clique no WhatsApp:", buttonId);

    await tratarRespostaPedido(buttonId);

    res.sendStatus(200);
  } catch (e) {
    console.error("❌ Erro webhook WhatsApp:", e.message);
    res.sendStatus(500);
  }
});

/*==================ENDPOINT WHATSAPP=================*/
app.get("/webhook/whatsapp", (req, res) => {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook WhatsApp verificado com sucesso");
    return res.status(200).send(challenge);
  }

  console.warn("❌ Falha na verificação do webhook WhatsApp");
  return res.sendStatus(403);
});
/* ================= PROCESSA CONFIRMACOES ================= */

async function tratarRespostaPedido(buttonId) {
  const partes = buttonId.split("_");

  if (partes.length < 3) {
    console.warn("⚠️ Botão inválido recebido:", buttonId);
    return;
  }

  const numeroPedido = partes[1];
  const acao = partes.slice(2).join("_");

  console.log("📲 ===========================");
  console.log("📲 RESPOSTA WHATSAPP RECEBIDA");
  console.log("📦 Pedido:", numeroPedido);
  console.log("🧠 Ação informada:", acao);
  console.log("⏰ Data:", new Date().toISOString());
  console.log("📲 ===========================");

  // 🚫 Nenhuma ação de negócio ainda
}


/* ================= SAÚDE ================= */
app.get("/health", (req, res) => {
  console.log(JSON.stringify({
    type: "health",
    status: "ok",
    time: new Date().toISOString()
  }));
  res.status(200).json({ status: "ok" });
});

/* ================= HEALTH CHECK OAUTH ================= */
app.get("/health/oauth", (req, res) => {
  const agora = Date.now();
  const MAX_DELAY = 30 * 60 * 1000; // 30 minutos

  // ✅ Caso especial: acabou de subir
  if (ultimoRefreshToken === 0 && REFRESH_TOKEN) {
    return res.status(200).json({
      status: "ok",
      oauth: "starting",
      message: "Servidor recém-iniciado, aguardando primeiro refresh"
    });
  }

  if (
    ultimoRefreshStatus === "ok" &&
    agora - ultimoRefreshToken < MAX_DELAY
  ) {
    return res.status(200).json({
      status: "ok",
      oauth: "active"
    });
  }

  console.warn("⚠️ OAuth possível problema — refresh antigo ou falhou");

  return res.status(500).json({
    status: "error",
    oauth: "stale"
  });
});

/* ================= CALLBACK ================= */
app.get("/callback", async (req, res) => {
  try {
    const code = req.query.code;

    if (!code) {
      return res.status(400).send("Código de autorização não informado");
    }

    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("client_id", CLIENT_ID);
    params.append("client_secret", CLIENT_SECRET);
    params.append("redirect_uri", process.env.REDIRECT_URI);

    const r = await axios.post(
      "https://developer.bling.com.br/api/bling/oauth/token",
      params,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    ACCESS_TOKEN = r.data.access_token;
    REFRESH_TOKEN = r.data.refresh_token;
    
    saveTokens({
    access_token: ACCESS_TOKEN,
    refresh_token: REFRESH_TOKEN
    });


    console.log("✅ OAuth concluído com sucesso");
    res.send("✅ Autorização concluída com sucesso. Pode fechar esta página.");
  } catch (e) {
    console.error("❌ Erro no callback OAuth:", e.response?.data || e.message);
    res.status(500).send("Erro ao processar callback OAuth");
  }
});

/* ================= Registra pedido no BD ================= */

/**
 * Registra pedido Mercado Livre na tabela pedido_confirmacao
 * quando entra no status 462966
 */
async function registrarPedidoConfirmacao(pedido) {
  console.log("📲 Cheguei na confirmação | Pedido", pedido.numero,"Status", pedido.situacao.id);
  console.log("📌 Verificando envio de confirmação");

  // ✅ CONDIÇÃO 1: Loja correta
  if (pedido.loja.id !== 204560827) {
    console.log("⛔ Loja diferente, não envia WhatsApp");
    return;
  }

  // ✅ CONDIÇÃO 2: Status correto
  if (pedido.situacao.id !== 462097) {
    console.log("⛔ Status diferente de 462097, não envia WhatsApp");
    return;
  }

  console.log(
    `✅ Pedido elegível para confirmação (Pedido ${pedido.numero})`
  );

const existe = await pool.query(
  "SELECT 1 FROM pedido_confirmacao WHERE pedido_id = $1",
  [pedido.id]
);

const permitirReenvio = process.env.WHATSAPP_REENVIAR === "true";

if (existe.rowCount > 0 && !permitirReenvio) {
  console.log("ℹ️ Pedido já registrado, não reenviar mensagem");
  return;
}

if (existe.rowCount > 0 && permitirReenvio) {
  console.log("🔁 Reenvio forçado de WhatsApp habilitado");
}

  // ✅ Gera token
  const tokenConfirmacao = randomUUID();

  // ✅ Grava no banco
  await pool.query(
    `
    INSERT INTO pedido_confirmacao
    (
      pedido_id,
      numero_pedido,
      marketplace,
      deposito_codigo,
      status_bling,
      token_confirmacao
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      pedido.id,
      pedido.numero,
      "ML",
      "SERVSEG_RP",
      462097,
      tokenConfirmacao
    ]
  );

  const textoItens = montarTextoItensSimples(pedido);

await enviarWhatsAppConfirmacaoComBotoes({
  telefone: telefoneDeposito,
  pedidoNumero: pedido.numero,
  textoItens
});
  
  // ✅ Marca envio no banco
  await pool.query(
    `
    UPDATE pedido_confirmacao
    SET notificacao_enviada = true
    WHERE pedido_id = $1
    `,
    [pedido.id]
  );

  console.log("📲 WhatsApp de confirmação enviado com sucesso");
}

function montarTextoItensSimples(pedido) {
  return pedido.itens
    .map(item =>
      `• ${item.codigo} - ${item.descricao}\nQuantidade: ${item.quantidade}`
    )
    .join("\n\n");
}

function montarMensagemConfirmacao(pedido) {
  const itensTexto = pedido.itens
    .map(item => {
      return `• Código: ${item.codigo}
  ${item.descricao}
  Quantidade: ${item.quantidade}`;
    })
    .join("\n\n");

  return (
`📦 *CONFIRMAÇÃO DE PEDIDO – MUNDOSEG ML MATRIZ*

Pedido Nº: *${pedido.numero}*

Itens do pedido:
${itensTexto}

⏳ *Por favor, confirme se todos os itens estão disponíveis para envio.*
Após a confirmação, o pedido será faturado automaticamente.`
  );
}

/* ================= TOKEN AUTO-RENEW ================= */

// 10 minutos
const TOKEN_REFRESH_INTERVAL = 10 * 60 * 1000;

setInterval(async () => {
  if (!REFRESH_TOKEN) {
    console.warn("⚠️ Refresh token ausente, não foi possível renovar");
    return;
  }

  console.log("⏳ Renovação automática de token em execução");
  await renovarToken();

}, TOKEN_REFRESH_INTERVAL);

/* ================= START ================= */
app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Servidor iniciado");
});
