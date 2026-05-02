/**
 * services/expedicao.service.js
 *
 * Responsabilidade:
 * - Lançar informações no banco de dados assim que o pedido muda de status.
 * 
 * 👉 ESTE ARQUIVO CONECTA AO BANCO DE DADOS NA TABELA PEDIDOS EXPEDICAO
*/
import { pool } from "../db/db.js";

/* ----- Insere registro no BD tabela Pedidos_Espedicao ----- */
export async function registrarLancamentoEstoque({
  pedido,
  depositoId,
  canalVenda
}) {
  const itens = pedido.itens.map(item => ({
    sku: item.codigo || item.produto?.codigo,
    descricao: item.descricao,
    quantidade: item.quantidade,
    valor_unitario: item.valor,
    valor_total: item.valor * item.quantidade
  }));

  const valorTotalPedido = itens.reduce(
    (acc, item) => acc + item.valor_total,
    0
  );

  await pool.query(
    `
    INSERT INTO pedidos_expedicao (
      pedido_numero,
      pedido_numero_loja,
      loja_id,
      canal_venda,
      deposito_lancado,
      data_lancamento_estoque,
      status_bling,
      itens,
      valor_total_pedido,
      criado_em,
      atualizado_em
    )
    VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7,$8,NOW(),NOW())
    ON CONFLICT (pedido_numero)
    DO UPDATE SET
      deposito_lancado = EXCLUDED.deposito_lancado,
      data_lancamento_estoque = NOW(),
      status_bling = EXCLUDED.status_bling,
      itens = EXCLUDED.itens,
      valor_total_pedido = EXCLUDED.valor_total_pedido,
      atualizado_em = NOW();
    `,
    [
      pedido.numero,
      pedido.numeroLoja,
      pedido.loja.id,
      canalVenda,
      depositoId,
      pedido.situacao.id,
      JSON.stringify(itens),
      valorTotalPedido
    ]
  );
}

/* ----- Exclui registro no BD tabela Pedidos_Espedicao ----- */

export async function removerPedidoExpedicao(pedidoNumero) {
  const { rowCount } = await pool.query(
    `
    DELETE FROM pedidos_expedicao
    WHERE pedido_numero = $1
    `,
    [pedidoNumero]
  );

  return rowCount > 0;
}

/* ----- Atualiza registro no BD Quando Status Muda para 9 - Atendido tabela Pedidos_Espedicao ----- */

export async function atualizarPedidoComNotaFiscal(pedido) {
  const nf = pedido.notaFiscal;

  if (!nf) {
    console.warn(`⚠️ Pedido ${pedido.numero} no status 9 mas sem NF vinculada`);
    return;
  }

  const { rowCount } = await pool.query(
    `
    UPDATE pedidos_expedicao
    SET
      status_bling = $1,
      nota_fiscal_id = $2,
      nota_fiscal_numero = $3,
      nota_fiscal_serie = $4,
      data_atendido = NOW(),
      atualizado_em = NOW()
    WHERE pedido_numero = $5
    `,
    [
      9,
      nf.id,
      nf.numero,
      nf.serie,
      pedido.numero
    ]
  );

  if (rowCount > 0) {
    console.log(`📄 NF registrada para o pedido ${pedido.numero}`);
  } else {
    console.log(
      `ℹ️ Pedido ${pedido.numero} chegou ao status 9, mas não estava na expedição`
    );
  }
}

