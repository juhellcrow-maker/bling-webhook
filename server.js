/**
 * server.js
 *
 * Responsabilidade:
 * - Subir o servidor Express
 *
 * 👉 ESTE ARQUIVO NÃO TEM LÓGICA DE NEGÓCIO
 * 👉 NÃO TEM ROTAS
 * 👉 NÃO TEM INTEGRAÇÃO
 */

import app from "./app.js";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Servidor iniciado na porta ${PORT}`);
});
