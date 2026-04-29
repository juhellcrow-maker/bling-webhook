/**
 * app.js
 *
 * Responsabilidade:
 * - Criar a instância do Express
 * - Registrar middlewares globais
 * - Registrar todas as rotas da aplicação
 *
 * 👉 ESTE ARQUIVO NÃO SOBE O SERVIDOR
 * 👉 app.listen FICA SOMENTE EM server.js
 */

import express from "express";

/* ======================================================
   IMPORTAÇÃO DAS ROTAS
   ====================================================== */

// Rotas de debug e diagnóstico
import debugRoutes from "./routes/debug.routes.js";

// Rotas de webhook (Bling)
import webhookRoutes from "./routes/webhook.routes.js";

// Rotas de WhatsApp (Meta)
import whatsappRoutes from "./routes/whatsapp.routes.js";

// Rotas de saúde / monitoramento
import healthRoutes from "./routes/health.routes.js";

// Rotas de OAuth (callback Bling)
import oauthRoutes from "./routes/oauth.routes.js";

// Rotas administrativas / utilitárias
import depositosRoutes from "./routes/depositos.routes.js";

/* ======================================================
   CRIAÇÃO DO APP
   ====================================================== */

const app = express();

/* ======================================================
   MIDDLEWARES GLOBAIS
   ====================================================== */

// Permite receber JSON em webhooks e APIs
app.use(express.json());

// (Opcional)
// Aqui futuramente pode entrar:
// - CORS
// - rate limit global
// - headers de segurança
// - logs HTTP

/* ======================================================
   REGISTRO DAS ROTAS
   ====================================================== */

// Ordem não é crítica aqui, pois as rotas
// não colidem entre si

app.use(debugRoutes);
app.use(webhookRoutes);
app.use(whatsappRoutes);
app.use(healthRoutes);
app.use(oauthRoutes);
app.use(depositosRoutes);

/* ======================================================
   EXPORTAÇÃO DO APP
   ====================================================== */

export default app;
