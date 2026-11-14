import { Router } from 'express';
import { verifyToken } from '../auth/middleware.js';
import { PlantumlController } from '../controllers/plantuml.controller.js';

const router = Router();

// Renderização server-side de diagramas PlantUML para pré-visualização.
router.post('/render', verifyToken, PlantumlController.render);

export default router;
