import * as dotenv from 'dotenv';
dotenv.config();

export const PORT = parseInt(process.env.PORT || '3000', 10);
export const REVERSE_TARGET = process.env.REVERSE_PRX_TARGET || '';
export const UDP_TIMEOUT_MS = 30_000;

export const PATH_VLESS = process.env.PATH_VLESS || '/vless';
export const PATH_VMESS = process.env.PATH_VMESS || '/vmess';
export const PATH_TROJAN = process.env.PATH_TROJAN || '/trojan';
export const PATH_SS = process.env.PATH_SS || '/ss';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
  'Access-Control-Max-Age': '86400',
};
