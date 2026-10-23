import { createBrandingHandlers } from '../server/branding.js';

export const GET = createBrandingHandlers({ env: process.env }).manifest;
