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
 * Debug avançado de pedido
 * Fonte rica para análise, auditoria e base futura de expedição
 */

router.get("/debug-pedido/:numero", async (req, res) => {
  try {
    const { numero } = req.params;

    /* ======================================================
       1️⃣ BUSCA PEDIDO PELO NÚMERO
       ====================================================== */
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

    const pedidoId = busca.data.data[0].id;

    /* ======================================================
       2️⃣ BUSCA DETALHE COMPLETO DO PEDIDO
       ====================================================== */
    const detalhe = await executarNaFilaBling(() =>
      safeRequest(() =>
        axios.get(
          `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedidoId}`,
          { headers: getHeaders() }
        )
      )
    );

    const pedido = detalhe.data.data;

    /* ======================================================
       3️⃣ MONTA DEBUG ENRIQUECIDO
       ====================================================== */
    const debug = {
      pedido: {
        id: pedido.id,
        numero: pedido.numero,
        numeroLoja: pedido.numeroLoja,
        dataPedido: pedido.data,
        dataSaida: pedido.dataSaida,
        dataPrevista: pedido.dataPrevista
      },

      status: {
        id: pedido.situacao?.id,
        nome: pedido.situacao?.nome,
        atendido: pedido.situacao?.id === 9
      },

      loja: {
        id: pedido.loja?.id,
        nome: pedido.loja?.nome,
        canal: pedido.loja?.descricao || pedido.loja?.nome,
        unidadeNegocio: pedido.loja?.unidadeNegocio?.id || null
      },

      cliente: pedido.contato
        ? {
            nome: pedido.contato.nome,
            documento: pedido.contato.numeroDocumento || null,
            telefone: pedido.contato.telefone || null,
            email: pedido.contato.email || null
          }
        : null,

      valores: {
        produtos: pedido.totalProdutos,
        outrasDespesas: pedido.outrasDespesas,
        desconto: pedido.desconto?.valor || 0,
        taxas: pedido.taxas?.map(t => ({
          tipo: t.tipo,
          valor: t.valor
        })) || [],
        total: pedido.total
      },

      itens: pedido.itens.map(item => ({
        sku: item.codigo,
        descricao: item.descricao,
        quantidade: item.quantidade,
        valorUnitario: item.valor,
        valorTotal: item.quantidade * item.valor
      })),

      notaFiscal: pedido.notaFiscal
        ? {
            id: pedido.notaFiscal.id,
            numero: pedido.notaFiscal.numero,
            serie: pedido.notaFiscal.serie,
            chaveAcesso: pedido.notaFiscal.chaveAcesso,
            situacao: pedido.notaFiscal.situacao
          }
        : null,

      transporte: pedido.transporte
        ? {
            transportadora:
              pedido.transporte.transportador?.nome || null,
            valorFrete: pedido.transporte.valorFrete || null,
            volumes: pedido.transporte.volumes || []
          }
        : null,

      comercial: {
        vendedor: pedido.vendedor?.nome || null,
        intermediador: pedido.intermediador?.nome || null,
        cnpjIntermediador: pedido.intermediador?.cnpj || null
      },

      observacoes: {
        cliente: pedido.observacoes || null,
        internas: pedido.observacoesInternas || null
      },

      auditoria: {
        statusAtendido: pedido.situacao?.id === 9,
        prontoParaExpedicao:
          pedido.situacao?.id === 9 && !!pedido.notaFiscal
      }
    };

    /* ======================================================
       4️⃣ LOG OPERACIONAL LIMPO
       ====================================================== */
    console.log("🧾 DEBUG PEDIDO");
    console.log(`📦 Pedido: ${debug.pedido.numero}`);
    console.log(`🏬 Canal: ${debug.loja.canal}`);
    console.log(`🚦 Status: ${debug.status.nome}`);
    console.log(`📦 Itens: ${debug.itens.length}`);
    if (debug.notaFiscal) {
      console.log(
        `📄 NF-e: ${debug.notaFiscal.numero}/${debug.notaFiscal.serie}`
      );
    }
    console.log(
      `✅ Pronto para expedição: ${debug.auditoria.prontoParaExpedicao}`
    );

    /* ======================================================
       5️⃣ RESPOSTA
       ====================================================== */
    res.json(debug);

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
