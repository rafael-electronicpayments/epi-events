import { createClient } from '@supabase/supabase-js';
import { createTestLoginHandler } from '../server/test-logins.js';

const handler = createTestLoginHandler({ createClient, env: process.env });
export const POST = handler;
export const OPTIONS = handler;
