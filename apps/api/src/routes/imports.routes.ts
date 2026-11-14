import { Router } from 'express';
import { verifyToken } from '../auth/middleware.js';
import { ImportController } from '../controllers/imports.controller.js';

const router = Router();

// Padrões prontos de diagramas C4-PlantUML para a criação de modelos.
router.get('/import/plantuml/templates', verifyToken, ImportController.listTemplates);

// Cria um modelo novo a partir de um diagrama C4-PlantUML.
router.post('/import/plantuml', verifyToken, ImportController.importNew);

// Importa/substitui o conteúdo de um modelo existente.
router.post('/:id/import/plantuml', verifyToken, ImportController.importIntoModel);

export default router;
