import { Router } from 'express';
import { verifyToken } from '../auth/middleware.js';
import { ModelController } from '../controllers/models.controller.js';

const router = Router();

// Listar modelos da organização ativa
router.get('/', verifyToken, ModelController.list);

// Criar modelo
router.post('/', verifyToken, ModelController.create);

// Importar um modelo de arquivo local, Google Drive ou outra URL
router.post('/import', verifyToken, ModelController.importModel);

// Obter modelo com elementos e conexões
router.get('/:id', verifyToken, ModelController.get);

// Editar modelo
router.put('/:id', verifyToken, ModelController.update);

// Excluir modelo
router.delete('/:id', verifyToken, ModelController.remove);

// Adicionar um novo tipo de diagrama ao mesmo modelo
router.post('/:id/diagrams', verifyToken, ModelController.addDiagram);

// Obter DAS do modelo
router.get('/:id/das', verifyToken, ModelController.das);

// Atualizar DAS do modelo
router.put('/:id/das', verifyToken, ModelController.updateDas);

// Histórico de versões e restauração
router.get('/:id/versions', verifyToken, ModelController.versions);
router.get('/:id/versions/:versionId', verifyToken, ModelController.version);
router.post('/:id/versions/:versionId/restore', verifyToken, ModelController.restore);

export default router;
