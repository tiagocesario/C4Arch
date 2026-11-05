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

// Editar modelo
router.put('/:id', verifyToken, ModelController.update);

// Excluir modelo
router.delete('/:id', verifyToken, ModelController.remove);

export default router;
