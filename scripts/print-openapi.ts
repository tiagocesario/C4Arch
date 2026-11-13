/* eslint-disable no-console */
import { buildOpenApiDocument } from '../apps/api/src/openapi.js';

process.stdout.write(JSON.stringify(buildOpenApiDocument(), null, 2));
