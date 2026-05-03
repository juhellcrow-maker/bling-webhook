/**
 * routes/debug.routes.js
 *
 * Responsabilidade:
 * - Endpoints de debug e diagnóstico
 * - Consulta de pedidos e NF-e
 *
 * 👉 ESTE ARQUIVO NÃO ALTERA NADA NO SISTEMA
 */
//import { MAPA_LANCAMENTO_POR_STATUS } from "../services/estoque.service.js";
import { Router } from "express";
import axios from "axios";

import {
  executarNaFilaBling,
  safeRequest,
  getHeaders
} from "../services/bling.service.js";

const router = Router();

/* ======================================================
       2️⃣ CANAL DE VENDA (REGRA INTERNA)
       ====================================================== */
    const MAPA_CANAL = {
      205415213: "Filial AMZ",
      204782103: "Matriz AMZ",
      204964661: "Filial ML",
      204560827: "Matriz ML"
    };

    const canalVenda = MAPA_CANAL[pedido.loja.id] || "Desconhecido";}

/* ======================================================
   DEBUG – PEDIDO POR NÚMERO
   ====================================================== */

/**
 * DEBUG AVANÇADO DE PEDIDO (ALINHADO AO SCHEMA OFICIAL BLING)
 * Fonte rica para auditoria, expedição e persistência futura
 */

router.get("/debug-pedido/:numero", async (req, res) => {
  try {
    const { numero } = req.params;

    const normalizeArray = (value) =>
      !value ? [] : Array.isArray(value) ? value : [value];

    /* ======================================================
       1️⃣ BUSCA ID DO PEDIDO PELO NÚMERO
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
       2️⃣ BUSCA DETALHE COMPLETO
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

    const itens = normalizeArray(pedido.itens).map(item => ({
      sku: item.codigo,
      descricao: item.descricao,
      quantidade: item.quantidade,
      valorUnitario: item.valor,
      valorTotal: item.quantidade * item.valor
    }));

    const taxas = normalizeArray(pedido.taxas).map(t => ({
      taxaComissao: t.taxaComissao || null,
      custoFrete: t.custoFrete || null,
      valorBase: t.valorBase || null
    }));

    const volumes = normalizeArray(pedido.transporte?.volumes);

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
        descricao: pedido.situacao?.valor,
        atendido: pedido.situacao?.id === 9
      },

      loja: {
        id: pedido.loja?.id,
        unidadeNegocio: pedido.loja?.unidadeNegocio?.id || null,
        canal: canalVenda || pedido.loja?.descricao || null
      },

      cliente: pedido.contato ? {
        nome: pedido.contato.nome,
        documento: pedido.contato.numeroDocumento || null,
        telefone: pedido.contato.telefone || null,
        email: pedido.contato.email || null
      } : null,

      valores: {
        produtos: pedido.totalProdutos,
        total: pedido.total,
        outrasDespesas: pedido.outrasDespesas || 0,
        desconto: pedido.desconto?.valor || 0,
        taxas
      },

      itens,

      notaFiscal: pedido.notaFiscal ? {
        id: pedido.notaFiscal.id
      } : null,

      tributacao: pedido.tributacao ? {
        icms: pedido.tributacao.totalICMS || null,
        ipi: pedido.tributacao.totalIPI || null
      } : null,

      transporte: pedido.transporte ? {
        fretePorConta: pedido.transporte.fretePorConta || null,
        valorFrete: pedido.transporte.frete || null,
        quantidadeVolumes: pedido.transporte.quantidadeVolumes || null,
        pesoBruto: pedido.transporte.pesoBruto || null,
        prazoEntrega: pedido.transporte.prazoEntrega || null,
        transportadora: pedido.transporte.contato?.nome || null,
        etiqueta: pedido.transporte.etiqueta || null,
        volumes
      } : null,

      comercial: {
        vendedorId: pedido.vendedor?.id || null,
        intermediador: pedido.intermediador ? {
          nomeUsuario: pedido.intermediador.nomeUsuario || null,
          cnpj: pedido.intermediador.cnpj || null
        } : null
      },

      observacoes: {
        cliente: pedido.observacoes || null,
        internas: pedido.observacoesInternas || null
      },

      auditoria: {
        statusAtendido: pedido.situacao?.id === 9,
        possuiNF: !!pedido.notaFiscal,
        prontoParaExpedicao: pedido.situacao?.id === 9 && !!pedido.notaFiscal
      }
    };

    
    /* ======================================================
       4️⃣ LOG OPERACIONAL LIMPO
       ====================================================== */
    console.log("🧾 DEBUG PEDIDO");
    console.log(`📦 Pedido: ${debug.pedido.numero}`);
    console.log(`🏬 Canal: ${canalVenda}`);
    console.log(`🚦 Status: ${debug.status.descricao}`);
    console.log(`📦 Itens: ${debug.itens.length}`);
    console.log(`📄 Possui NF: ${!!debug.notaFiscal}`);
    console.log(`✅ Pronto expedição: ${debug.auditoria.prontoParaExpedicao}`);

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
   DEBUG – EXPEDIÇÃO
   ====================================================== */

/**
 * DEBUG OPERACIONAL – EXPEDIÇÃO
 * Valida todos os campos antes de persistir no banco
 */

router.get("/debug-pedido-expedicao/:numero", async (req, res) => {
  try {
    const { numero } = req.params;

    const normalizeArray = (v) => !v ? [] : Array.isArray(v) ? v : [v];

    /* ======================================================
       1️⃣ BUSCA PEDIDO
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
       2️⃣ CANAL DE VENDA (REGRA INTERNA)
       
    const MAPA_CANAL = {
      205415213: "Filial AMZ",
      204782103: "Matriz AMZ",
      204964661: "Filial ML",
      204560827: "Matriz ML"
    };

    const canalVenda = MAPA_CANAL[pedido.loja.id] || "Desconhecido";
    ====================================================== */

    /* ======================================================
       3️⃣ DEPÓSITO (REGRA INTERNA)
       ====================================================== */
    const depositoLancado = MAPA_LANCAMENTO_POR_STATUS[pedido.situacao.id] || null;

    /* ======================================================
       4️⃣ ITENS
       ====================================================== */
    const itens = normalizeArray(pedido.itens).map(i => ({
      sku: i.codigo,
      descricao: i.descricao,
      quantidade: i.quantidade
    }));

    /* ======================================================
       5️⃣ NF – BUSCA NÚMERO
       ====================================================== */
    let notaFiscal = null;

    if (pedido.notaFiscal?.id) {
      const nfResp = await executarNaFilaBling(() =>
        safeRequest(() =>
          axios.get(
            `https://api.bling.com.br/Api/v3/nfe/${pedido.notaFiscal.id}`,
            { headers: getHeaders() }
          )
        )
      );

      const nf = nfResp.data.data;
      notaFiscal = {
        id: nf.id,
        numero: nf.numero,
        serie: nf.serie
      };
    }

    /* ======================================================
       6️⃣ RASTREAMENTO
       ====================================================== */
    const rastreamentos = normalizeArray(pedido.transporte?.volumes)
      .map(v => v.codigoRastreamento)
      .filter(Boolean);

    /* ======================================================
       7️⃣ OBJETO FINAL (PRONTO PARA BANCO)
       ====================================================== */
    const debugExpedicao = {
      pedido: {
        numero: pedido.numero,
        numeroLoja: pedido.numeroLoja
      },
      canalVenda,
      lojaId: pedido.loja.id,
      depositoLancado,
      itens,
      notaFiscal,
      rastreamentos
    };

    /* ======================================================
       8️⃣ LOG OPERACIONAL
       ====================================================== */
    console.log("📦 DEBUG EXPEDIÇÃO");
    console.log(`Pedido: ${pedido.numero}`);
    console.log(`Canal: ${canalVenda}`);
    console.log(`Depósito: ${depositoLancado}`);
    console.log(`Itens: ${itens.length}`);
    console.log(`NF: ${notaFiscal?.numero || "N/A"}`);
    console.log(`Rastreio: ${rastreamentos.join(", ") || "N/A"}`);

    res.json(debugExpedicao);

  } catch (e) {
    console.error("❌ Erro no debug de expedição:", e.message);
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
