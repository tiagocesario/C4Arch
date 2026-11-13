import { Router } from 'express';
import { verifyToken } from '../auth/middleware.js';
import { ExportController } from '../controllers/exports.controller.js';

const router = Router();

router.get('/:id/exports', verifyToken, ExportController.formats);
router.get('/:id/export/:format', verifyToken, ExportController.export);
router.get('/:id/preview', verifyToken, ExportController.preview);

export default router;
