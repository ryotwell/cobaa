import * as dotenv from 'dotenv';
dotenv.config();

export const PORT = parseInt(process.env.PORT || '3000', 10);
export const REVERSE_TARGET = process.env.REVERSE_PRX_TARGET || '';
export const UDP_TIMEOUT_MS = 30_000;

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
  'Access-Control-Max-Age': '86400',
};
