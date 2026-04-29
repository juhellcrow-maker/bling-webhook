/**
 * routes/debug.routes.js
 *
 * Responsabilidade:
 * - Endpoints de debug e diagnóstico
 * - Consulta de pedidos e NF-e
 *
 * 👉 ESTE ARQUIVO NÃO ALTERA NADA NO SISTEMA
 */

import { Router } from "express";
import axios from "axios";

import {
  executarNaFilaBling,
  safeRequest,
  getHeaders
} from "../services/bling.service.js";

const router = Router();

/* ======================================================
   DEBUG – PEDIDO POR NÚMERO
   ====================================================== */

/**
 * Retorna os detalhes COMPLETOS de um pedido
 * a partir do número visível no Bling.
 *
 * GET /debug-pedido/:numero
 */
router.get("/debug-pedido/:numero", async (req, res) => {
  try {
    const { numero } = req.params;

    /* ---------------------------
       BUSCA ID DO PEDIDO
       --------------------------- */
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

    /* ---------------------------
       BUSCA DETALHE COMPLETO
       --------------------------- */
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
    console.error("❌ Erro no debug do pedido:", e.message);
    res.status(500).json({ erro: e.message });
  }
});

/* ======================================================
   DEBUG – NF-e POR ID
   ====================================================== */

/**
 * Retorna dados de uma NF-e específica,
 * incluindo itens e vínculo com o pedido.
 *
 * GET /debug-expedicao/nfe-id/:id
 */
router.get("/debug-expedicao/nfe-id/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const nfResp = await executarNaFilaBling(() =>
      safeRequest(() =>
        axios.get(
          `https://api.bling.com.br/Api/v3/nfe/${id}`,
          { headers: getHeaders() }
        )
      )
    );

    const nfe = nfResp.data.data;

    if (!nfe) {
      return res.status(404).json({
        erro: "NF-e não encontrada",
        id
      });
    }

    /* ---------------------------
       MONTA ITENS SIMPLIFICADOS
       --------------------------- */
    const itens = (nfe.itens || []).map(item => ({
      sku: item.codigo,
      descricao: item.descricao,
      quantidade: item.quantidade
    }));

    /* ---------------------------
       CHECKLIST BÁSICO
       --------------------------- */
    const pendencias = [];

    if (!nfe.numeroPedidoLoja)
      pendencias.push("Pedido da loja virtual ausente");

    if (!itens.length)
      pendencias.push("NF sem itens");

    res.json({
      notaFiscal: {
        id: nfe.id,
        numero: nfe.numero,
        serie: nfe.serie,
        situacao: nfe.situacao,
        dataEmissao: nfe.dataEmissao,
        chaveAcesso: nfe.chaveAcesso,
        numeroPedidoLoja: nfe.numeroPedidoLoja
      },
      pedidoBling: nfe.pedidoVenda || null,
      estoque: {
        lancado: true,
        origem: "NF-e emitida"
      },
      itens,
      checklist: {
        status: pendencias.length === 0 ? "OK" : "PENDENTE",
        pendencias
      }
    });

  } catch (e) {
    console.error("❌ Erro no debug de NF-e:", e.message);
    res.status(500).json({ erro: e.message });
  }
});

/* ======================================================
   DEBUG – LISTA NF-e POR PERÍODO
   ====================================================== */

/**
 * Lista NF-e de saída de um dia específico,
 * usando paginação obrigatória do Bling.
 *
 * GET /debug-expedicao/periodo?data=YYYY-MM-DD
 */
router.get("/debug-expedicao/periodo", async (req, res) => {
  try {
    const { data } = req.query;

    if (!data) {
      return res.status(400).json({
        erro: "Informe a data no formato YYYY-MM-DD"
      });
    }

    const dataEmissaoInicial = `${data} 00:00:00`;
    const dataEmissaoFinal = `${data} 23:59:59`;

    let pagina = 1;
    const limite = 100;
    let totalPaginas = 1;
    const todasNotas = [];

    /* ---------------------------
       PAGINAÇÃO OBRIGATÓRIA
       --------------------------- */
    do {
      const resp = await executarNaFilaBling(() =>
        safeRequest(() =>
          axios.get("https://api.bling.com.br/Api/v3/nfe", {
            headers: getHeaders(),
            params: {
              pagina,
              limite,
              tipo: 1, // Saída
              dataEmissaoInicial,
              dataEmissaoFinal
            }
          })
        )
      );

      const dataResp = resp.data?.data || [];
      const pagination = resp.data?.pagination || {};

      todasNotas.push(...dataResp);
      totalPaginas = pagination.totalPages || 1;
      pagina++;

    } while (pagina <= totalPaginas);

    /* ---------------------------
       MONTA VISÃO DE EXPEDIÇÃO
       --------------------------- */
    const notas = todasNotas.map(nf => {
      const itens = (nf.itens || []).map(i => ({
        sku: i.codigo,
        descricao: i.descricao,
        quantidade: i.quantidade
      }));

      const pendencias = [];

      if (!nf.numeroPedidoLoja)
        pendencias.push("Pedido da loja ausente");

      if (!itens.length)
        pendencias.push("NF sem itens");

      return {
        notaFiscal: {
          id: nf.id,
          numero: nf.numero,
          serie: nf.serie,
          situacao: nf.situacao,
          dataEmissao: nf.dataEmissao
        },
        pedidoBling: nf.pedidoVenda?.numero || null,
        pedidoLoja: nf.numeroPedidoLoja || null,
        estoque: {
          lancado: true,
          origem: "NF-e emitida"
        },
        itens,
        checklist: {
          status: pendencias.length === 0 ? "OK" : "PENDENTE",
          pendencias
        }
      };
    });

    res.json({
      data,
      totalNotas: notas.length,
      notas
    });

  } catch (e) {
    console.error("❌ Erro no debug por período:", e.message);
    res.status(500).json({ erro: e.message });
  }
});

export default router;
