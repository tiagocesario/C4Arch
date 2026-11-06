import { Router } from 'express';
import { verifyToken } from '../auth/middleware.js';
import { ServiceController } from '../controllers/services.controller.js';

const router = Router();

router.get('/', verifyToken, ServiceController.list);
router.post('/', verifyToken, ServiceController.create);
router.get('/:id/dependencies', verifyToken, ServiceController.dependencies);
router.put('/:id', verifyToken, ServiceController.update);
router.delete('/:id', verifyToken, ServiceController.remove);

export default router;
