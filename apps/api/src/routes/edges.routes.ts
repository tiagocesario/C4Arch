import { Router } from 'express';
import { verifyToken } from '../auth/middleware.js';
import { EdgeController } from '../controllers/edges.controller.js';

const router = Router();

// Listar conexões de um modelo
router.get('/:modelId/edges', verifyToken, EdgeController.list);

// Criar conexão
router.post('/:modelId/edges', verifyToken, EdgeController.create);

// Obter conexão
router.get('/:modelId/edges/:edgeId', verifyToken, EdgeController.get);

// Atualizar conexão
router.put('/:modelId/edges/:edgeId', verifyToken, EdgeController.update);

// Excluir conexão
router.delete('/:modelId/edges/:edgeId', verifyToken, EdgeController.remove);

export default router;
