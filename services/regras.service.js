/**
 * services/regras.service.js
 *
 * Responsabilidade:
 * - Motor de regras do pedido
 * - Avaliar saldo por depósito
 * - Alterar status do pedido
 * - Coordenar lançamento de estoque
 *
 * 👉 ESTE ARQUIVO É O FLUXO CENTRAL DO PEDIDO
 */

import axios from "axios";
import REGRAS from "../rules/regras.js";

import {
  executarNaFilaBling,
  safeRequest,
  getHeaders
} from "./bling.service.js";

import {
  pedidoTemSaldoCompletoNoDeposito,
  lancarEstoqueUmaVez
} from "./estoque.service.js";

import { registrarPedidoConfirmacao } from "./confirmacao.service.js";

/* ======================================================
   LOCALIZA A REGRA APLICÁVEL AO PEDIDO
   ====================================================== */

/**
 * Encontra a regra correta considerando:
 * - loja
 * - status atual
 * - unidade de negócio (quando aplicável)
 */
function encontrarRegraUnificada(pedido) {
  return REGRAS.find(r =>
    r.lojaId === pedido.loja.id &&
    r.statusOrigem === pedido.situacao.id &&
    (
      // Regra sem condição de unidade
      !r.condicaoUnidade ||
      // Regra com condição de unidade
      r.condicaoUnidade === pedido.loja.unidadeNegocio?.id
    )
  );
}

/* ======================================================
   PROCESSA REGRA DO TIPO "ESTOQUE"
   ====================================================== */

/**
 * Avalia prioridades de estoque
 * e escolhe o primeiro depósito com saldo completo.
 */
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

    if (!temSaldo) continue;

    // 1️⃣ Lança estoque se a prioridade exigir
    if (prioridade.lancarEstoque) {
      await  lancarEstoqueUmaVez(
        pedido.id,
        prioridade.depositoId,
        pedido.numero
      );
    }

    // 2️⃣ Altera status do pedido
    await alterarStatusPedido(
      pedido,
      prioridade.statusDestino
    );

    // 3️⃣ Garantia final de estoque por status
    await lancarEstoqueUmaVez(pedido, depositoId, canalVenda);

    console.log("✅ Regra aplicada com sucesso");
    return;
  }

  console.log("⚠️ Nenhuma prioridade com saldo — ação manual");
}

/* ======================================================
   ALTERAÇÃO DE STATUS DO PEDIDO
   ====================================================== */

/**
 * Altera o status do pedido no Bling
 * de forma segura.
 */
async function alterarStatusPedido(pedido, statusDestino) {
  if (pedido.situacao.id === statusDestino) {
    console.log(
      `ℹ️ Pedido ${pedido.numero} já está no status ${statusDestino}`
    );
    return;
  }

  const url =
    `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedido.id}/situacoes/${statusDestino}`;

  try {
    console.log(
      `🚦 Alterando status do pedido ${pedido.numero} → ${statusDestino}`
    );

    const r = await executarNaFilaBling(() =>
      safeRequest(() =>
        axios.patch(url, null, { headers: getHeaders() })
      )
    );

    console.log(`✅ Status alterado HTTP ${r.status}`);
  } catch (err) {
    const fields = err.response?.data?.error?.fields || [];
    const mesmaSituacao = (statusHttp === 400 && fields.some(f => f.code === 50));

    if (mesmaSituacao) {
      console.log(
        `ℹ️ Status do pedido ${pedido.numero} já estava em ${statusDestino}`
      );
      return;
    }

    throw err;
  }
}

/* ======================================================
   PROCESSO PRINCIPAL (ENTRADA DO WEBHOOK)
   ====================================================== */

/**
 * Orquestra todo o fluxo do pedido:
 * - Busca pedido
 * - Registra confirmação (WhatsApp)
 * - Aplica regras
 */
export async function processarPedidoPorId(idPedido) {
  const resp = await executarNaFilaBling(() =>
    safeRequest(() =>
      axios.get(
        `https://api.bling.com.br/Api/v3/pedidos/vendas/${idPedido}`,
        { headers: getHeaders() }
      )
    )
  );

  const pedido = resp.data.data;

  /* ---------------------------
     ETAPA 1 – CONFIRMAÇÃO
     --------------------------- */
  // Funciona para status 462097 (ex: confirmação ML)
  await registrarPedidoConfirmacao(pedido);

  /* ---------------------------
     ETAPA 2 – MOTOR DE REGRAS
     --------------------------- */
  const regra = encontrarRegraUnificada(pedido);

  if (!regra) return;

  /* ---------------------------
     REGRA SIMPLES
     --------------------------- */
  if (regra.tipo === "SIMPLES") {
    await alterarStatusPedido(
      pedido,
      regra.statusDestino
    );

    await lancarEstoqueUmaVez(pedido, depositoId, canalVenda);

    return;
  }

  /* ---------------------------
     REGRA POR ESTOQUE
     --------------------------- */
  if (regra.tipo === "ESTOQUE") {
    await processarRegraPorEstoque(pedido, regra);
    return;
  }

  console.log(
    `📦 Pedido ${pedido.numero} | Status ${pedido.situacao.id}`
  );
}
