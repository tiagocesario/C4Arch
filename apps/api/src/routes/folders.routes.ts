import { Router } from 'express';
import { verifyToken } from '../auth/middleware.js';
import { FolderController } from '../controllers/folders.controller.js';

const router = Router();

router.get('/', verifyToken, FolderController.list);
router.post('/', verifyToken, FolderController.create);
router.put('/:id', verifyToken, FolderController.update);
router.delete('/:id', verifyToken, FolderController.remove);

export default router;
