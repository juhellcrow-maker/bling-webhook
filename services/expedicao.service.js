/**
 * services/expedicao.service.js
 *
 * Responsabilidade:
 * - Lançar informações no banco de dados assim que o pedido muda de status.
 * 
 * 👉 ESTE ARQUIVO CONECTA AO BANCO DE DADOS NA TABELA PEDIDOS EXPEDICAO
*/
import axios from "axios";
import AdmZip from "adm-zip";
import { pool } from "../db/db.js";
import { executarNaFilaBling, safeRequest, getHeaders } from "./bling.service.js";
const CANAIS_ML = ["Matriz ML", "Filial ML"];


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
  const nfRef = pedido.notaFiscal;

  if (!nfRef?.id) {
    console.warn(
      `⚠️ Pedido ${pedido.numero} no status 9, mas sem referência de NF`
    );
    return;
  }

  // ✅ BUSCA COMPLETA DA NF NO BLING
  const respNF = await executarNaFilaBling(() =>
    safeRequest(() =>
      axios.get(
        `https://api.bling.com.br/Api/v3/nfe/${nfRef.id}`,
        { headers: getHeaders() }
      )
    )
  );

  const nf = respNF.data?.data;

  if (!nf) {
    console.warn(
      `⚠️ NF ${nfRef.id} não retornou dados completos`
    );
    return;
  }

  const { rowCount } = await pool.query(
    `
    UPDATE pedidos_expedicao
    SET
      status_bling = 9,
      nota_fiscal_id = $1,
      nota_fiscal_numero = $2,
      nota_fiscal_serie = $3,
      data_atendido = NOW(),
      atualizado_em = NOW()
    WHERE pedido_numero = $4
    `,
    [
      nf.id,
      nf.numero,
      nf.serie,
      pedido.numero
    ]
  );

  if (rowCount > 0) {
    console.log(
      `📄 NF ${nf.numero}/${nf.serie} registrada no pedido ${pedido.numero}`
    );
  } else {
    console.log(
      `ℹ️ Pedido ${pedido.numero} (status 9) não estava na tabela de expedição`
    );
  }
}

/* ----- Atualiza Codigo Rastreio Banco de Dados ----- */
export async function atualizarCodigoRastreio(pedido) {
  const volumes = pedido.transporte?.volumes || [];

  const codigos = volumes
    .map(v => v.codigoRastreamento)
    .filter(Boolean);

  if (!codigos.length) {
    return; // Ainda não há etiqueta
  }

  // Usa o primeiro código (ou adapte se usar múltiplos volumes)
  const codigoRastreamento = codigos[0];

  const { rowCount } = await pool.query(
    `
    UPDATE pedidos_expedicao
    SET
      codigo_rastreamento = $1,
      atualizado_em = NOW()
    WHERE pedido_numero = $2
      AND codigo_rastreamento IS NULL
    `,
    [codigoRastreamento, pedido.numero]
  );

  if (rowCount > 0) {
    console.log(
      `📦 Código de rastreio ${codigoRastreamento} registrado no pedido ${pedido.numero}`
    );
  }
}

/* ----- BUSCA ETIQUETA ZPL BLING ----- */
export async function buscarEtiquetaZPL(idPedido, pedidoNumero, canalVenda) {
  try {
    const metaResp = await executarNaFilaBling(() =>
      axios.get(
        "https://api.bling.com.br/Api/v3/logisticas/etiquetas",
        {
          headers: getHeaders(),
          params: {
            formato: "ZPL",
            idsVendas: [idPedido]
          }
        }
      )
    );

    const item = metaResp.data?.data?.[0];
    if (!item?.link) {
      console.warn(`ℹ️ Etiqueta ainda não disponível (Pedido ${pedidoNumero})`);
      return;
    }

    const zipResp = await axios.get(item.link, {
      responseType: "arraybuffer"
    });

    const zip = new AdmZip(zipResp.data);
    const entries = zip.getEntries();

    const zplEntry = entries.find(e =>
      e.entryName.toLowerCase().endsWith(".zpl") ||
      e.entryName.toLowerCase().endsWith(".txt")
    );

    if (!zplEntry) {
      console.warn(`⚠️ ZPL não encontrado no ZIP (Pedido ${pedidoNumero})`);
      return;
    }

    const zpl = zplEntry.getData().toString("utf8");

    if (!zpl.trim().startsWith("^XA")) {
      console.warn(`⚠️ Conteúdo extraído não parece ZPL (Pedido ${pedidoNumero})`);
      return;
    }

    await pool.query(
      `
      UPDATE pedidos_expedicao
      SET
        etiqueta_zpl = $1,
        atualizado_em = NOW()
      WHERE pedido_numero = $2
      `,
      [zpl, pedidoNumero]
    );

    console.log(`🖨️ ZPL REAL salvo no banco (Pedido ${pedidoNumero})`);

    // ✅ Se for Mercado Livre, corrige o código de rastreio
if (CANAIS_ML.includes(canalVenda)) {
  const codigoEtiqueta = extrairCodigoEtiquetaDoZPL(zpl);

  if (codigoEtiqueta) {
    await pool.query(
      `
      UPDATE pedidos_expedicao
      SET
        codigo_rastreamento = $1,
        atualizado_em = NOW()
      WHERE pedido_numero = $2
      `,
      [codigoEtiqueta, pedidoNumero]
    );

    console.log(
      `📦 Código de rastreio ML corrigido via ZPL: ${codigoEtiqueta} (Pedido ${pedidoNumero})`
    );
  }
}

  } catch (err) {
    if (err.response?.status === 403) {
      console.warn(`ℹ️ Bling retornou 403 – etiqueta ainda não liberada`);
      return;
    }
    throw err;
  }
}

/* ----- EXTRAI COD RASTREIO ZPL ----- */

function extrairCodigoEtiquetaDoZPL(zpl) {
  // Extrai somente números após ^FD>:
  const match = zpl.match(/\^FD>:(\d+)\^FS/);
  return match ? match[1] : null;
}

/* ----- Buscar Etiqueta se Existir Cod Rastreio ----- */
export async function tentarBuscarEtiquetaZPLSeExistir(pedido, canalVenda) {
  // 1️⃣ só tenta se existir rastreio
  const temRastreio = pedido.transporte?.volumes?.some(
    v => v.codigoRastreamento
  );

  if (!temRastreio) return;

  // 2️⃣ garante que o pedido exista na tabela
  const { rows } = await pool.query(
    `
    SELECT etiqueta_zpl
    FROM pedidos_expedicao
    WHERE pedido_numero = $1
    `,
    [pedido.numero]
  );

  if (!rows.length) {
    // cria registro mínimo
    await pool.query(
      `
      INSERT INTO pedidos_expedicao (pedido_numero, status_bling, criado_em)
      VALUES ($1, $2, NOW())
      ON CONFLICT (pedido_numero) DO NOTHING
      `,
      [pedido.numero, pedido.situacao.id]
    );
  } else {
    // já existe e já tem ZPL → não faz nada
    if (rows[0].etiqueta_zpl) return;
  }

  // 3️⃣ agora sim busca e grava o ZPL
  await buscarEtiquetaZPL(pedido.id, pedido.numero, canalVenda);
}
