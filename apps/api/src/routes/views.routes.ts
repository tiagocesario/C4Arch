import { Router } from 'express';
import { verifyToken } from '../auth/middleware.js';
import { ViewsController } from '../controllers/views.controller.js';

const router = Router();

router.get('/:id/views', verifyToken, ViewsController.list);
router.get('/:id/views/:key/layout', verifyToken, ViewsController.layout);
router.put('/:id/views/:key/layout', verifyToken, ViewsController.saveLayout);
router.post('/:id/views/:key/autolayout', verifyToken, ViewsController.autoLayout);

export default router;
