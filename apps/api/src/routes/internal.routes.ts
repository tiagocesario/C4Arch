import { Router } from 'express';
import { verifyInternalToken, InternalController } from '../controllers/internal.controller.js';

const router = Router();

router.use(verifyInternalToken);

// Estado colaborativo durável (Yjs) usado pelo realtime.
router.put('/models/:id/state', InternalController.putState);
router.get('/models/:id/state', InternalController.getState);

export default router;
