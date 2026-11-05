import { Router } from 'express';
import { verifyToken } from '../auth/middleware.js';
import { ElementController } from '../controllers/elements.controller.js';

const router = Router();

// Listar elementos de um modelo
router.get('/:modelId/elements', verifyToken, ElementController.list);

// Criar elemento
router.post('/:modelId/elements', verifyToken, ElementController.create);

// Obter elemento
router.get('/:modelId/elements/:elementId', verifyToken, ElementController.get);

// Atualizar elemento
router.put('/:modelId/elements/:elementId', verifyToken, ElementController.update);

// Excluir elemento
router.delete('/:modelId/elements/:elementId', verifyToken, ElementController.remove);

export default router;
