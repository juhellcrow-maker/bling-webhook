export const MAPA_CANAL_VENDA = {
  204560827: "Matriz ML",
  204782103: "Matriz AMZ",
  204964661: "Filial ML",
  205415213: "Filial AMZ"
};

export function BuscarCanalVenda(lojaId) {
  return MAPA_CANAL_VENDA[lojaId] || "Canal desconhecido";
}
