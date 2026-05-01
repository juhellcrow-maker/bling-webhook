/**
 * services/estoque.service.js
 *
 * Responsabilidade:
 * - Consultar saldo de produtos
 * - Validar se pedido tem saldo completo
 * - Lançar estoque UMA ÚNICA VEZ
 * - Registrar o lançamento no banco (Etapa 1)
 *
 * ⚠️ NÃO reage a status
 * ⚠️ NÃO tenta lançar estoque novamente
 */

import axios from "axios";
import { pool } from "../db/db.js";
import {
  executarNaFilaBling,
  safeRequest,
  getHeaders
} from "./bling.service.js";

/* ======================================================
   CONSULTA DE SALDO
   ====================================================== */

export async function consultarSaldoProdutoNoDeposito(idProduto, idDeposito) {
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

  return itens.length
    ? itens[0].saldoFisicoTotal ?? itens[0].saldo ?? 0
    : 0;
}

/* ======================================================
   VALIDAÇÃO DE SALDO DO PEDIDO
   ====================================================== */

export async function pedidoTemSaldoCompletoNoDeposito(pedido, idDeposito) {
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
   LANÇAMENTO ÚNICO DE ESTOQUE
   ====================================================== */

/**
 * Lança o estoque UMA VEZ e registra no banco.
 * O banco é a trava lógica que impede duplicidade.
 */
export async function lancarEstoqueUmaVez(
  pedido,
  depositoId,
  canalVenda
) {
  const pedidoNumero = pedido.numero;
  const pedidoId = pedido.id;

  /* ---------------------------
     1️⃣ VERIFICA SE JÁ EXISTE NO BANCO
     --------------------------- */
  const jaExiste = await pool.query(
    `SELECT 1 FROM pedidos_expedicao WHERE pedido_numero = $1`,
    [pedidoNumero]
  );

  if (jaExiste.rowCount > 0) {
    console.log(
      `ℹ️ Estoque do pedido ${pedidoNumero} já registrado no banco`
    );
    return;
  }

  /* ---------------------------
     2️⃣ LANÇA ESTOQUE NO BLING
     --------------------------- */
  const url =
    `https://api.bling.com.br/Api/v3/pedidos/vendas/` +
    `${pedidoId}/lancar-estoque/${depositoId}`;

  try {
    console.log(
      `📦 Lançando estoque UMA VEZ ` +
      `(Pedido ${pedidoNumero}, Depósito ${depositoId})`
    );

    await executarNaFilaBling(() =>
      safeRequest(() =>
        axios.post(url, null, { headers: getHeaders() })
      )
    );

    console.log(`✅ Estoque lançado no Bling`);

  } catch (err) {
    const fields = err.response?.data?.error?.fields || [];
    const jaLancado = fields.some(f => f.code === 61 || f.code === 66);

    if (!jaLancado) throw err;

    console.log(`ℹ️ Estoque já estava lançado no Bling`);
  }

  /* ---------------------------
     3️⃣ REGISTRA NO BANCO (ETAPA 1)
     --------------------------- */
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
    `,
    [
      pedido.numero,
      pedido.numeroLoja,
      pedido.loja.id,
      canalVenda,
      depositoId,
      pedido.situacao.id
    ]
  );

  console.log(
    `🗄️ Pedido ${pedidoNumero} registrado no banco (Etapa 1)`
  );
}
