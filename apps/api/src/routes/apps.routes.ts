import { Router } from 'express';
import { verifyToken } from '../auth/middleware.js';
import { AppController } from '../controllers/apps.controller.js';

const router = Router();

router.get('/', verifyToken, AppController.list);
router.post('/', verifyToken, AppController.create);
router.get('/:id/dependencies', verifyToken, AppController.dependencies);
router.put('/:id', verifyToken, AppController.update);
router.delete('/:id', verifyToken, AppController.remove);

export default router;
