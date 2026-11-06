import { Router } from 'express';
import { verifyToken } from '../auth/middleware.js';
import { GroupController } from '../controllers/groups.controller.js';

const router = Router();

router.get('/', verifyToken, GroupController.list);
router.post('/', verifyToken, GroupController.create);
router.put('/:id', verifyToken, GroupController.update);
router.delete('/:id', verifyToken, GroupController.remove);
router.get('/:id/members', verifyToken, GroupController.members);
router.post('/:id/members', verifyToken, GroupController.addMember);
router.delete('/:id/members/:userId', verifyToken, GroupController.removeMember);

export default router;
