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

    // 🟡 Erro com resposta do Bling
    if (err.response) {
      const { status, data, config } = err.response;

      console.error("❌ Erro Bling");
      console.error("➡️ Status:", status);
      console.error("➡️ Endpoint:", config?.method?.toUpperCase(), config?.url);

      if (config?.data) {
        console.error("➡️ Payload enviado:", config.data);
      }

      if (data) {
        console.error("➡️ Resposta Bling:", JSON.stringify(data, null, 2));
      }

      // 🔑 Tratamento especial para 401 (token expirado)
      if (status === 401 && !retry) {
        console.warn("⚠️ 401 detectado, renovando token e tentando novamente");
        await renovarToken();
        return safeRequest(fn, true);
      }

      // 🔒 409 (conflito) — muito comum em mudança de status
      if (status === 409) {
        console.warn("⚠️ Conflito (409) — pedido pode já ter sido alterado");
        throw err;
      }

      // ⚠️ 400, 404, 422 etc → regra / payload incorreto
      throw err;
    }

    // 🔵 Erro sem resposta (timeout, rede, DNS etc)
    if (err.request) {
      console.error("❌ Erro de rede ou timeout");
      console.error("➡️ Request:", err.request);
      throw err;
    }

    // 🔴 Erro inesperado
    console.error("❌ Erro inesperado:", err.message);
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
async function alterarUnidadePedidoComItens(pedido, unidadeDestino) {
  const url = `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedido.id}`;

  console.log(
    `🔄 Alterando unidade do pedido ${pedido.numero} para ${unidadeDestino} (reenviando itens)`
  );

  // 🔁 Reenviar os itens exatamente como vieram
  const itens = pedido.itens.map(item => ({
    produto: { id: item.produto.id },
    quantidade: item.quantidade,
    valor: item.valor,
    descricao: item.descricao,
    unidade: item.unidade
  }));

  const body = {
    loja: {
      id: pedido.loja.id,
      unidadeNegocio: {
        id: unidadeDestino
      }
    },
    itens
  };

  await executarNaFilaBling(() =>
    safeRequest(() =>
      axios.put(url, body, {
        headers: {
          ...getHeaders(),
          "Content-Type": "application/json"
        }
      })
    )
  );

  console.log("✅ Unidade alterada com sucesso (com itens)");
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

    console.log(
      `📦 ${prioridade.nome} → saldo ok: ${temSaldo}`
    );

    if (temSaldo) {
      // passa unidade destino explícita
      pedido.lojaDestino = prioridade.unidadeId;

      await alterarUnidadePedido(pedido);
      await alterarUnidadePedidoComItens(pedido,prioridade.unidadeId);
      await alterarStatusPedido(pedido,prioridade.statusDestino);


      console.log(`✅ Regra aplicada com sucesso`);
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

/* ================= DEBUG PEDIDO ================= */
/**
 * Endpoint de debug para inspecionar pedidos do Bling.
 * NÃO interfere na automação.
 * Essencial para validar regras, estoque e estrutura de dados.
 */
app.get("/debug-pedido/:numero", async (req, res) => {
  try {
    const numero = req.params.numero;

    console.log(`🧪 DEBUG → Buscando pedido ${numero}`);

    // 1️⃣ Busca pedido pelo número
    const busca = await executarNaFilaBling(() =>
      safeRequest(() =>
        axios.get(
          `https://api.bling.com.br/Api/v3/pedidos/vendas?numero=${numero}`,
          { headers: getHeaders() }
        )
      )
    );

    if (!busca.data.data || busca.data.data.length === 0) {
      return res
        .status(404)
        .json({ erro: "Pedido não encontrado no Bling" });
    }

    // 2️⃣ Pega o ID do pedido
    const idPedido = busca.data.data[0].id;

    // 3️⃣ Busca detalhes completos do pedido
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
    console.error("❌ Erro no debug-pedido:", e.message);
    res.status(500).json({ erro: e.message });
  }
});

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
