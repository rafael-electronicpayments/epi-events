import { createClient } from '@supabase/supabase-js';
import { createLoginHandler } from '../server/logins.js';

const handler = createLoginHandler({ createClient, env: process.env });
export const POST = handler;
export const GET = handler;
