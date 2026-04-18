import express from "express";
import axios from "axios";
import REGRAS from "./regras.js";

const app = express();
app.use(express.json());

/* ================= CONFIG ================= */
const WEBHOOK_ATIVO = true;

/* ================= OAUTH ================= */
let ACCESS_TOKEN = process.env.ACCESS_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

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
    await delay(400); // 3 req/s
    processandoFila = false;
    processarFila();
  }
}

/* ================= TOKEN (REATIVO) ================= */
let refreshEmAndamento = false;

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

    ACCESS_TOKEN = r.data.access_token;
    REFRESH_TOKEN = r.data.refresh_token;

    console.log("🔑 Token renovado");
  } finally {
    refreshEmAndamento = false;
  }
}

/* ================= SafeRequest ================= */
async function safeRequest(fn, retry = false) {
  try {
    return await fn();
  } catch (err) {
    if (err.response?.status === 401 && !retry) {
      console.warn("⚠️ 401 detectado, renovando token");
      await renovarToken();
      return safeRequest(fn, true);
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

    if (saldo < item.quantidade) {
      console.log(`❌ Sem saldo do produto ${item.produto.id}`);
      return false;
    }
  }
  console.log(`✅ Pedido ${pedido.numero} possui saldo no depósito ${idDeposito}`);
  return true;
}

/* ================= ALTERAÇÕES ================= */
async function alterarUnidadePedido(pedidoId, unidadeDestino) {
  const url = `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedidoId}`;

  await executarNaFilaBling(() =>
    safeRequest(() =>
      axios.put(
        url,
        { loja: { unidadeNegocio: { id: unidadeDestino } } },
        { headers: getHeaders() }
      )
    )
  );

  console.log(`✅ Unidade alterada para ${unidadeDestino}`);
}

async function alterarStatusPedido(pedido, statusDestino) {
  const url = `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedido.id}/situacoes/${statusDestino}`;

  await executarNaFilaBling(() =>
    safeRequest(() =>
      axios.patch(url, null, { headers: getHeaders() })
    )
  );

  console.log(`✅ Status alterado para ${statusDestino}`);
}

/* ================= MOTOR DE REGRAS ================= */
function encontrarRegraUnificada(pedido) {
  return REGRAS.find(r =>
    r.lojaId === pedido.loja.id &&
    r.statusOrigem === pedido.situacao.id &&
    (!r.condicaoUnidade ||
      r.condicaoUnidade === pedido.loja?.unidadeNegocio?.id)
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
      await alterarUnidadePedido(pedido.id, prioridade.unidadeId);
      await alterarStatusPedido(pedido, prioridade.statusDestino);
      console.log(`✅ Regra aplicada: ${regra.nome}`);
      return;
    }
  }

  console.log("⚠️ Nenhuma prioridade com saldo — ação manual");
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
  console.log(`📦 Pedido ${pedido.numero} | Status ${pedido.situacao.id}`);

  const regra = encontrarRegraUnificada(pedido);
  if (!regra) {
    console.log("ℹ️ Nenhuma regra aplicável");
    return;
  }

  console.log(`🧠 Aplicando regra: ${regra.nome}`);

  if (regra.tipo === "SIMPLES") {
    await alterarStatusPedido(pedido, regra.statusDestino);
    return;
  }

  if (regra.tipo === "ESTOQUE") {
    await processarRegraPorEstoque(pedido, regra);
  }
}

/* ================= WEBHOOK ================= */
app.post("/webhook", async (req, res) => {
  if (!WEBHOOK_ATIVO) return res.status(200).send("Webhook desligado");

  try {
    const idPedido = req.body?.data?.id;
    if (!idPedido) return res.status(200).send("Evento inválido");

    console.log("🔔 Webhook recebido");
    await processarPedidoPorId(idPedido);
  } catch (e) {
    console.error("❌ Erro no webhook:", e.message);
  }

  res.status(200).send("OK");
});

/* ================= SAÚDE ================= */
app.get("/health", (req, res) => {
  res.send("OK");
});

/* ================= START ================= */
app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Servidor iniciado");
});
