import type { Response, Request } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';

export type Handler = (req: AuthenticatedRequest, res: Response) => Promise<void>;

export type { Request as AuthenticatedRequestType };
