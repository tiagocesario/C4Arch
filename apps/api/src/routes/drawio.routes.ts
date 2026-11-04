import { Router } from 'express';
import { verifyToken } from '../auth/middleware.js';
import { DrawioController } from '../controllers/drawio.controller.js';

const router = Router();

router.get('/:id/drawio', verifyToken, DrawioController.editor);
router.get('/:id/drawio/xml', verifyToken, DrawioController.export);
router.post('/:id/drawio/import', verifyToken, DrawioController.import);

export default router;
