/**
 * services/estoque.service.js
 *
 * Responsabilidade:
 * - Consultar saldo de produtos no depósito
 * - Validar se pedido tem saldo completo
 * - Lançar estoque no Bling de forma segura (idempotente)
 * - Mapear status do pedido → depósito
 *
 * 👉 ESTE ARQUIVO É O CORAÇÃO DO CONTROLE DE ESTOQUE
 */

import axios from "axios";
import { pool } from "../db/db.js";
import { executarNaFilaBling, safeRequest, getHeaders} from "./bling.service.js";

/* ======================================================
   MAPA STATUS → DEPÓSITO
   ====================================================== */

/**
 * Define qual depósito deve ser usado
 * quando o pedido entra em determinado status.
 *
 * ⚠️ Regra de negócio explícita (crítica)
 */
export const MAPA_LANCAMENTO_POR_STATUS = {
  462966: 14888631397, // PS Ribeirão
  462097: 14888665295, // SS Rio Preto
  462099: 14888906921  // SS Catanduva
};

/* ======================================================
   CONSULTA DE SALDO
   ====================================================== */

/**
 * Consulta o saldo físico de UM produto em UM depósito.
 *
 * @param {number} idProduto
 * @param {number} idDeposito
 * @returns {number} saldo disponível
 */
export async function consultarSaldoProdutoNoDeposito(
  idProduto,
  idDeposito
) {
  const resp = await executarNaFilaBling(() =>
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

  const itens = resp.data?.data || [];

  // Prioriza saldo físico total, se não existir usa saldo comum
  return itens.length
    ? itens[0].saldoFisicoTotal ?? itens[0].saldo ?? 0
    : 0;
}

/* ======================================================
   VALIDAÇÃO DE SALDO COMPLETO DO PEDIDO
   ====================================================== */

/**
 * Verifica se TODOS os itens do pedido
 * possuem saldo suficiente no depósito informado.
 *
 * @param {object} pedido (pedido completo do Bling)
 * @param {number} idDeposito
 * @returns {boolean}
 */
export async function pedidoTemSaldoCompletoNoDeposito(
  pedido,
  idDeposito
) {
  for (const item of pedido.itens) {
    const saldo = await consultarSaldoProdutoNoDeposito(
      item.produto.id,
      idDeposito
    );

    if (saldo < item.quantidade) {
      return false;
    }
  }

  return true;
}

/* ======================================================
   LANÇAMENTO DE ESTOQUE (SEGURO / IDEMPOTENTE)
   ====================================================== */

/**
 * Lança o estoque de um pedido no depósito informado.
 *
 * ✅ Idempotente:
 * - Se o estoque já foi lançado, não gera erro
 * - Se a NF já foi gerada, ignora
 *
 * @param {number} pedidoId
 * @param {number} idDeposito
 * @param {string} pedidoNumero
 */

export async function lancarEstoquePedidoSeguro(
  pedido,
  idDeposito,
  canalVenda
) {
  const pedidoId = pedido.id;
  const pedidoNumero = pedido.numero;

  const url = `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedidoId}/lancar-estoque/${idDeposito}`;

  let estoqueLancadoOuJaExistente = false;

  try {
    console.log(
      `📦 Tentando lançar estoque do pedido ${pedidoNumero} ` +
      `(ID ${pedidoId}) no depósito ${idDeposito}`
    );

    await executarNaFilaBling(() =>
      safeRequest(() =>
        axios.post(url, null, { headers: getHeaders() })
      )
    );

    console.log(`✅ Estoque lançado com sucesso (Pedido ${pedidoNumero})`);
    estoqueLancadoOuJaExistente = true;

  } catch (err) {
    const status = err.response?.status;
    const fields = err.response?.data?.error?.fields || [];

    const jaLancado = fields.some(f => f.code === 61 || f.code === 66);

    if (status === 504 || jaLancado) {
      console.log(
        `ℹ️ Estoque do pedido ${pedidoNumero} já estava lançado`
      );
      estoqueLancadoOuJaExistente = true;
    } else {
      throw err;
    }
  }

  /* ======================================================
     ✅ UPSERT ETAPA 1 — SEMPRE EXECUTA SE DEPÓSITO EXISTE
     ====================================================== */

  if (estoqueLancadoOuJaExistente) {
    await pool.query(
      `
      INSERT INTO pedidos_expedicao (
        pedido_numero,
        pedido_numero_loja,
        loja_id,
        canal_venda,
        deposito_lancado,
        data_lancamento_estoque,
        status_bling
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), $6)
      ON CONFLICT (pedido_numero)
      DO UPDATE SET
        pedido_numero_loja = EXCLUDED.pedido_numero_loja,
        loja_id = EXCLUDED.loja_id,
        canal_venda = EXCLUDED.canal_venda,
        status_bling = EXCLUDED.status_bling,
        atualizado_em = NOW()
      `,
      [
        pedido.numero,
        pedido.numeroLoja,
        pedido.loja.id,
        canalVenda,
        idDeposito,
        pedido.situacao.id
      ]
    );

    console.log(`🗄️ Pedido ${pedidoNumero} registrado no banco (Etapa 1)`);
  }
}
/* ======================================================
   LANÇAMENTO AUTOMÁTICO VIA STATUS
   ====================================================== */

/**
 * Caso um status possua depósito mapeado,
 * garante que o estoque esteja lançado.
 *
 * @param {object} pedido
 * @param {number} statusDestino
 */
export async function lancarEstoqueSeNecessarioPorStatus(
  pedido,
  statusDestino
) {
  const depositoId = MAPA_LANCAMENTO_POR_STATUS[statusDestino];

  // Status sem depósito associado → nada a fazer
  if (!depositoId) return;

  console.log(
    `📦 Garantindo lançamento de estoque ` +
    `(Pedido ${pedido.numero}, status ${statusDestino}, depósito ${depositoId})`
  );

  await lancarEstoquePedidoSeguro(
    pedido.id,
    depositoId,
    pedido.numero
  );
}
