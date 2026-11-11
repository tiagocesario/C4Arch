import { Router } from 'express';
import { verifyToken } from '../auth/middleware.js';
import { AuditController } from '../controllers/audit.controller.js';

const router = Router();
router.get('/', verifyToken, AuditController.list);
export default router;
