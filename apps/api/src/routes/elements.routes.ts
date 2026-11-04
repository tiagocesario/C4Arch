import { Router } from 'express';
import { ElementController } from '../controllers/elements.controller.js';

const router = Router();

// Listar elementos de um modelo
router.get('/:modelId/elements', ElementController.list);

// Criar elemento
router.post('/:modelId/elements', ElementController.create);

// Obter elemento
router.get('/:modelId/elements/:elementId', ElementController.get);

// Atualizar elemento
router.put('/:modelId/elements/:elementId', ElementController.update);

// Excluir elemento
router.delete('/:modelId/elements/:elementId', ElementController.remove);

export default router;
