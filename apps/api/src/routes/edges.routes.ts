import { Router } from 'express';
import { EdgeController } from '../controllers/edges.controller.js';

const router = Router();

// Listar conexões de um modelo
router.get('/:modelId/edges', EdgeController.list);

// Criar conexão
router.post('/:modelId/edges', EdgeController.create);

// Obter conexão
router.get('/:modelId/edges/:edgeId', EdgeController.get);

// Atualizar conexão
router.put('/:modelId/edges/:edgeId', EdgeController.update);

// Excluir conexão
router.delete('/:modelId/edges/:edgeId', EdgeController.remove);

export default router;
