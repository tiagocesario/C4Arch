import { Router } from 'express';
import { verifyToken } from '../auth/middleware.js';
import { ModelController } from '../controllers/models.controller.js';

const router = Router();

// Listar modelos da organização ativa
router.get('/', verifyToken, ModelController.list);

// Criar modelo
router.post('/', verifyToken, ModelController.create);

// Obter modelo com elementos e conexões
router.get('/:id', verifyToken, ModelController.get);

// Editar títulos de elementos
router.put('/:modelId/elements/:id', verifyToken, ModelController.updateElement);
router.delete('/:modelId/elements/:id', verifyToken, ModelController.deleteElement);
router.post('/:modelId/elements', verifyToken, ModelController.createElement);

// Edge
router.put('/:modelId/edges/:id', verifyToken, ModelController.updateEdge);
router.delete('/:modelId/edges/:id', verifyToken, ModelController.deleteEdge);
router.post('/:modelId/edges', verifyToken, ModelController.createEdge);

// Excluir modelo
router.delete('/:id', verifyToken, ModelController.remove);

export default router;
