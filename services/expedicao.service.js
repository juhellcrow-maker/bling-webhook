/**
 * services/expedicao.service.js
 *
 * Responsabilidade:
 * - Lançar informações no banco de dados assim que o pedido muda de status.
 * 
 * 👉 ESTE ARQUIVO CONECTA AO BANCO DE DADOS NA TABELA PEDIDOS EXPEDICAO
*/
import { pool } from "../db/db.js";

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
