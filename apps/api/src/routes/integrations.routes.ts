import { Router } from 'express';
import { verifyToken } from '../auth/middleware.js';
import { IntegrationController } from '../controllers/integrations.controller.js';

const router = Router();

// Sistemas externos configurados na organização.
router.get('/integrations', verifyToken, IntegrationController.listSystems);
router.post('/integrations', verifyToken, IntegrationController.createSystem);
router.put('/integrations/:systemId', verifyToken, IntegrationController.updateSystem);
router.delete('/integrations/:systemId', verifyToken, IntegrationController.removeSystem);

// Vínculos de um modelo com as URLs de draw.io e DAS do sistema externo.
router.get('/models/:id/integrations', verifyToken, IntegrationController.listModelBindings);
router.post('/models/:id/integrations', verifyToken, IntegrationController.createModelBinding);
router.put(
  '/models/:id/integrations/:bindingId',
  verifyToken,
  IntegrationController.updateModelBinding
);
router.delete(
  '/models/:id/integrations/:bindingId',
  verifyToken,
  IntegrationController.removeModelBinding
);
router.post(
  '/models/:id/integrations/:bindingId/sync',
  verifyToken,
  IntegrationController.syncModelBinding
);

export default router;
