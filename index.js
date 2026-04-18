import express from "express";
import axios from "axios";
import REGRAS_ML_MATRIZ from "./regras_ml_matriz.js";

const app = express();
app.use(express.json());

/* ================= CONFIG ================= */
const ML_MATRIZ = 204560827;
const WEBHOOK_ATIVO = true;

/* ================= VARIAVEIS AMZ MATRIZ ================= */
const AMZ_MATRIZ = 204782103;

const UNIDADE_RIO_PRETO = 2721311;
const UNIDADE_RIBEIRAO = 2721312;

const STATUS_RIO_PRETO = 462097;
const STATUS_RIBEIRAO = 462966;

/* ================= DEPÓSITOS (MAPEAMENTO FIXO) ================= */

// Depósito prioridade – Serv‑Seg Rio Preto
const DEPOSITO_RIO_PRETO = 14888665295;

// Depósito alternativo – Passalacqua Ribeirão Preto
const DEPOSITO_RIBEIRAO = 14888631397;

/* ================= INTERNO: DEPÓSITOS ================= */
app.get("/interno/depositos", async (req, res) => {
  try {
    const r = await executarNaFilaBling(() =>
      safeRequest(() =>
        axios.get(
          "https://api.bling.com.br/Api/v3/depositos",
          { headers: getHeaders() }
        )
      )
    );

    res.json(r.data.data);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

/* ================= INTERNO: ESTOQUE POR DEPÓSITO ================= */
app.get("/interno/estoque/:idDeposito", async (req, res) => {
  try {
    const { idDeposito } = req.params;

    const r = await executarNaFilaBling(() =>
      safeRequest(() =>
        axios.get(
          `https://api.bling.com.br/Api/v3/estoques/saldos/${idDeposito}`,
          { headers: getHeaders() }
        )
      )
    );

    res.json(r.data.data);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

/* ================= ESTOQUE ================= */

/**
 * Consulta o saldo de um produto específico em um depósito.
 * Usa a API oficial do Bling e passa pela fila + safeRequest.
 * 
 * @param {number} idProduto - ID do produto no Bling
 * @param {number} idDeposito - ID do depósito
 * @returns {number} saldo disponível no depósito
 */
async function consultarSaldoProdutoNoDeposito(idProduto, idDeposito) {
  const r = await executarNaFilaBling(() =>
    safeRequest(() =>
      axios.get(
        `https://api.bling.com.br/Api/v3/estoques/saldos/${idDeposito}`,
        { headers: getHeaders() }
      )
    )
  );

  const itens = r.data?.data || [];

  const produto = itens.find(
    item => item.produto && item.produto.id === idProduto
  );

  // Se o produto não existir no depósito, saldo é considerado zero
  return produto ? produto.saldo : 0;
}

/**
 * Verifica se todos os itens do pedido possuem saldo suficiente
 * no mesmo depósito.
 * 
 * @param {object} pedido - Pedido retornado pelo Bling
 * @param {number} idDeposito - ID do depósito
 * @returns {boolean} true se todos os itens tiverem saldo suficiente
 */
async function pedidoTemSaldoCompletoNoDeposito(pedido, idDeposito) {
  for (const item of pedido.itens) {
    const idProduto = item.produto.id;
    const quantidadeNecessaria = item.quantidade;

    const saldo = await consultarSaldoProdutoNoDeposito(
      idProduto,
      idDeposito
    );

    if (saldo < quantidadeNecessaria) {
      console.log(
        `❌ Sem saldo | Produto ${idProduto} | Depósito ${idDeposito} | Saldo ${saldo} | Necessário ${quantidadeNecessaria}`
      );
      return false;
    }
  }

  console.log(
    `✅ Pedido ${pedido.numero} possui saldo completo no depósito ${idDeposito}`
  );
  return true;
}

/* ================= INTERNO: CONSULTA DE ESTOQUE POR PRODUTO ================= */

/**
 * Endpoint interno para consulta manual de saldo de um produto em um depósito.
 * Ideal para testes, validação e criação de regras novas.
 * 
 * Query params:
 *  - idProduto
 *  - idDeposito
 */
app.get("/interno/estoque-produto", async (req, res) => {
  try {
    const idProduto = Number(req.query.idProduto);
    const idDeposito = Number(req.query.idDeposito);

    if (!idProduto || !idDeposito) {
      return res.status(400).json({
        erro: "Informe idProduto e idDeposito"
      });
    }

    const saldo = await consultarSaldoProdutoNoDeposito(
      idProduto,
      idDeposito
    );

    res.json({
      idProduto,
      idDeposito,
      saldo
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

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
    const result = await fn();
    resolve(result);
  } catch (e) {
    reject(e);
  } finally {
    await delay(400); // respeita 3 req/s
    processandoFila = false;
    processarFila();
  }
}

/* ================= TOKEN (SOMENTE REATIVO) ================= */
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

    console.log("✅ Token renovado após 401");
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
      console.warn("⚠️ 401 detectado, renovando token...");
      await renovarToken();
      return safeRequest(fn, true);
    }
    throw err;
  }
}

/* ================= REGRAS ================= */
function encontrarRegra(pedido) {
  return REGRAS_ML_MATRIZ.find(r =>
    r.lojaId === pedido.loja.id &&
    r.unidadeNegocioId === pedido.loja.unidadeNegocio.id &&
    r.statusOrigem === pedido.situacao.id
  );
}

/* ================= STATUS ================= */
async function alterarStatusPedido(pedido, statusDestino) {
  const url = `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedido.id}/situacoes/${statusDestino}`;

  console.log(
    `🚦 ALTERAR STATUS → Pedido ${pedido.numero} | ${pedido.situacao.id} → ${statusDestino}`
  );

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
  console.log(`🔍 Pedido ${pedido.numero} | Status ${pedido.situacao.id}`);

  if (pedido.loja.id !== ML_MATRIZ) return;
  if (pedido.situacao.id !== 6) return;

  const regra = encontrarRegra(pedido);
  if (!regra) return;

  await alterarStatusPedido(pedido, regra.statusDestino);
}

/* ================= WEBHOOK ================= */
app.post("/webhook", async (req, res) => {
  if (!WEBHOOK_ATIVO) return res.status(200).send("Webhook desativado");

  try {
    const idPedido = req.body?.data?.id;
    if (!idPedido) return res.status(200).send("Evento inválido");

    console.log("🔔 Webhook recebido");
    console.log(`📦 Pedido recebido | ID ${idPedido}`);

    await processarPedidoPorId(idPedido);
    res.status(200).send("OK");
  } catch (e) {
    console.error("❌ Erro no webhook:", e.message);
    res.status(200).send("Erro tratado");
  }
});

/* ================= DEBUG ================= */
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

    if (!busca.data.data?.length)
      return res.status(404).json({ erro: "Pedido não encontrado" });

    const id = busca.data.data[0].id;

    const detalhe = await executarNaFilaBling(() =>
      safeRequest(() =>
        axios.get(
          `https://api.bling.com.br/Api/v3/pedidos/vendas/${id}`,
          { headers: getHeaders() }
        )
      )
    );

    res.json(detalhe.data.data);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

/* ================= START ================= */
app.get("/health", (req, res) => {
  console.log("🏓 Ping automático recebido");
  res.send("OK");
});
app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Servidor iniciado");
});
