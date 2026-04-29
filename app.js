// app.js
import express from "express";

import depositosRoutes from "./routes/depositos.routes.js";
import debugRoutes from "./routes/debug.routes.js";
import webhookRoutes from "./routes/webhook.routes.js";
import whatsappRoutes from "./routes/whatsapp.routes.js";
import healthRoutes from "./routes/health.routes.js";
import oauthRoutes from "./routes/oauth.routes.js";


const app = express();
app.use(express.json());

// Rotas
app.use(depositosRoutes);
app.use(debugRoutes);
app.use(webhookRoutes);
app.use(whatsappRoutes);
app.use(healthRoutes);
app.use(oauthRoutes);

export default app;
