import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { createPushDispatchHandler } from '../server/push-dispatch.js';

const handler = createPushDispatchHandler({ createClient, webpush, env: process.env });
export const POST = handler;
export const GET = handler;
