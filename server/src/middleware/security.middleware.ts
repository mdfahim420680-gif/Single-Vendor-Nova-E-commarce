import crypto from 'node:crypto';
import mongoose from 'mongoose';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { AppError } from './error.middleware';

export interface CorrelatedRequest extends Request {
  requestId?: string;
}

const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively strips MongoDB `$` operator keys, dotted keys, and prototype-pollution keys
 * from untrusted request bodies and query parameters.
 */
export function sanitizeUntrustedValue(value: unknown, depth = 0): unknown {
  if (depth > 16 || value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUntrustedValue(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (DANGEROUS_OBJECT_KEYS.has(key) || key.startsWith('$') || key.includes('.')) {
      continue;
    }
    out[key] = sanitizeUntrustedValue(val, depth + 1);
  }
  return out;
}

export function sanitizeInputMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeUntrustedValue(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeUntrustedValue(req.query) as Request['query'];
  }
  next();
}

export function requireTrustedStateChangeOrigin(req: Request, _res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
    next();
    return;
  }

  const originHeader = req.get('origin');
  const refererHeader = req.get('referer');
  let requestOrigin: string | undefined;
  try {
    requestOrigin = originHeader
      ? new URL(originHeader).origin
      : refererHeader
        ? new URL(refererHeader).origin
        : undefined;
  } catch {
    next(new AppError(403, 'UNTRUSTED_ORIGIN', 'Request origin is not allowed.'));
    return;
  }

  const trustedOrigins = new Set<string>();
  for (const candidate of [env.CLIENT_URL, env.APP_URL]) {
    try {
      trustedOrigins.add(new URL(candidate).origin);
    } catch {
      continue;
    }
  }
  if (!requestOrigin || !trustedOrigins.has(requestOrigin)) {
    next(new AppError(403, 'UNTRUSTED_ORIGIN', 'Request origin is not allowed.'));
    return;
  }

  if (!req.is('application/json') && !req.is('application/*+json')) {
    next(new AppError(415, 'UNSUPPORTED_CONTENT_TYPE', 'State-changing requests must use JSON.'));
    return;
  }

  next();
}

export function requestCorrelationMiddleware(req: CorrelatedRequest, res: Response, next: NextFunction): void {
  const incomingId = req.get('x-request-id');
  const requestId =
    incomingId && /^[a-zA-Z0-9._-]{8,64}$/.test(incomingId)
      ? incomingId
      : crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    if (process.env.NODE_ENV === 'test') return;
    if (req.path === '/api/health') return;
    const durationMs = Date.now() - startedAt;
    if (res.statusCode >= 500) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'http_request',
          requestId,
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs,
        }),
      );
    } else if (res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 429) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'http_security_response',
          requestId,
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs,
        }),
      );
    }
  });

  next();
}

export function assertValidObjectId(id: string | undefined | null, label = 'resource'): string {
  const clean = String(id || '').trim();
  if (!mongoose.isValidObjectId(clean)) {
    throw new AppError(400, 'INVALID_ID', `Invalid ${label} identifier format.`);
  }
  return clean;
}

/**
 * Escapes CSV fields and neutralizes Excel/Sheets formula injection (`=`, `+`, `-`, `@`, `\t`, `\r`).
 */
export function escapeCsvCell(val: unknown): string {
  let str = String(val ?? '');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}
