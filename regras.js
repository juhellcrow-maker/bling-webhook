/**
 * Regras unificadas de automação de pedidos
 *
 * Tipos:
 * - SIMPLES → apenas altera status (pode usar condicaoUnidade)
 * - ESTOQUE → verifica saldo, pode lançar estoque, depois altera status
 */

export default [

  /* =========================================================
   * MERCADO LIVRE – MATRIZ (REGRAS EXISTENTES)
   * ========================================================= */

  {
    nome: "ML MATRIZ - PASSALACQUA RIBEIRÃO",
    lojaId: 204560827,
    statusOrigem: 6,
    tipo: "SIMPLES",
    condicaoUnidade: 2557723, // Passalacqua Ribeirão
    statusDestino: 462966
  },

  {
    nome: "ML MATRIZ - SERV-SEG RIO PRETO",
    lojaId: 204560827,
    statusOrigem: 6,
    tipo: "SIMPLES",
    condicaoUnidade: 2532043, // Serv-Seg Rio Preto
    statusDestino: 462097
  },

  /* =========================================================
   * AMAZON – MATRIZ
   * Decisão por estoque (Rio Preto → Ribeirão)
   * ========================================================= */

  {
    nome: "AMZ MATRIZ - decisão por estoque",
    lojaId: 204782103,
    statusOrigem: 6,
    tipo: "ESTOQUE",
    prioridades: [
      {
        nome: "SS Rio Preto",
        depositoId: 14888665295,
        statusDestino: 462097,
        lancarEstoque: false
      },
      {
        nome: "PS Ribeirão",
        depositoId: 14888631397,
        statusDestino: 462966,
        lancarEstoque: true
      }
    ]
  },

  /* =========================================================
   * MERCADO LIVRE – FILIAL
   * Decisão por estoque
   * ========================================================= */

  {
    nome: "ML FILIAL - decisão por estoque",
    lojaId: 204964661,
    statusOrigem: 6,
    tipo: "ESTOQUE",
    prioridades: [
      {
        nome: "SS Rio Preto",
        depositoId: 14888665295,
        statusDestino: 462097,
        lancarEstoque: false
      },
      {
        nome: "PS Ribeirão",
        depositoId: 14888631397,
        statusDestino: 462966,
        lancarEstoque: true
      }
    ]
  },

  /* =========================================================
   * AMAZON – FILIAL
   * Decisão por estoque
   * ========================================================= */

  {
    nome: "AMZ FILIAL - decisão por estoque",
    lojaId: 205415213,
    statusOrigem: 6,
    tipo: "ESTOQUE",
     prioridades: [
      {
        nome: "SS Rio Preto",
        depositoId: 14888665295,
        statusDestino: 462097,
        lancarEstoque: false
      },
      {
        nome: "PS Ribeirão",
        depositoId: 14888631397,
        statusDestino: 462966,
        lancarEstoque: true
      }
    ]
  },
