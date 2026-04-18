export default [
  /* ================= ML MATRIZ ================= */
  {
    nome: "ML MATRIZ - PASSALACQUA RIBEIRÃO",
    lojaId: 204560827,
    statusOrigem: 6,
    tipo: "SIMPLES",
    condicaoUnidade: 2557723,
    statusDestino: 462966
  },
  {
    nome: "ML MATRIZ - SERV-SEG RIO PRETO",
    lojaId: 204560827,
    statusOrigem: 6,
    tipo: "SIMPLES",
    condicaoUnidade: 2532043,
    statusDestino: 462097
  },

  /* ================= AMAZON MATRIZ ================= */
  {
    nome: "AMZ MATRIZ - decisão por estoque",
    lojaId: 204782103,
    statusOrigem: 6,
    tipo: "ESTOQUE",
    prioridades: [
      {
        nome: "SS Rio Preto",
        unidadeId: 2721311,
        depositoId: 14888665295,
        statusDestino: 462097
      },
      {
        nome: "PS Ribeirão",
        unidadeId: 2721312,
        depositoId: 14888631397,
        statusDestino: 462966
      }
    ]
  },

  /* ================= ML FILIAL ================= */
  {
    nome: "ML FILIAL - decisão por estoque",
    lojaId: 205415213,
    statusOrigem: 6,
    tipo: "ESTOQUE",
    prioridades: [
      {
        nome: "PS Ribeirão",
        unidadeId: 2721312,
        depositoId: 14888631397,
        statusDestino: 462966
      }
    ]
  }
];
