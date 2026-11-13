import { Router } from 'express';
import { verifyToken } from '../auth/middleware.js';
import { ImportController } from '../controllers/imports.controller.js';

const router = Router();

// Padrões prontos de workspace Structurizr para a criação de modelos.
router.get('/import/structurizr/templates', verifyToken, ImportController.listTemplates);

// Cria um modelo novo a partir de um workspace Structurizr.
router.post('/import/structurizr', verifyToken, ImportController.importNew);

// Importa/substitui o conteúdo de um modelo existente.
router.post('/:id/import/structurizr', verifyToken, ImportController.importIntoModel);

export default router;
