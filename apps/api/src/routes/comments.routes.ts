import { Router } from 'express';
import { verifyToken } from '../auth/middleware.js';
import { CommentsController } from '../controllers/comments.controller.js';

const router = Router();

router.get('/:id/comments', verifyToken, CommentsController.list);
router.post('/:id/comments', verifyToken, CommentsController.create);
router.patch('/:id/comments/:commentId', verifyToken, CommentsController.update);
router.delete('/:id/comments/:commentId', verifyToken, CommentsController.remove);

export default router;
