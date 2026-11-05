import { Router } from 'express';
import { verifyDrawioAccess, verifyToken } from '../auth/middleware.js';
import { DrawioController } from '../controllers/drawio.controller.js';

const router = Router();

// Token escopado (5 min) usado apenas para abrir o editor no navegador.
router.post('/:id/drawio/token', verifyToken, DrawioController.token);

// O editor aceita Bearer (API) ou o token escopado na query string.
router.get('/:id/drawio', verifyDrawioAccess, DrawioController.editor);
router.get('/:id/drawio/xml', verifyDrawioAccess, DrawioController.export);
router.get('/:id/drawio/library', verifyDrawioAccess, DrawioController.library);
router.post('/:id/drawio/import', verifyDrawioAccess, DrawioController.import);

export default router;
